import { conversation, timestamp } from '../core/model.mjs';
import { contentParts, readJsonLines, textPart, toolPart, visibleContext } from './shared.mjs';
import { resolveSession } from './discovery.mjs';

export const codexAdapter = {
  id: 'codex', version: 1,
  async load({ input, title, session }) {
    input ||= await resolveSession(this.id, session);
    const records = await readJsonLines(input);
    let metadata = {}, candidates = [], mirrors = [], warnings = [], context = {};
    const itemMetadata = new Map();
    const seen = new Set();
    for (const { value: record, line } of records) {
      const p = record.payload || {};
      if (record.type === 'session_meta') metadata = p;
      if (record.type === 'event_msg' && p.type === 'task_started') context = { turnId: p.turn_id };
      if (record.type === 'turn_context') context = { turnId: p.turn_id || context.turnId, model: p.model };
      if (record.type === 'event_msg' && p.type === 'item_completed' && p.item?.id) {
        itemMetadata.set(p.item.id, { turnId: p.turn_id, phase: p.item.phase });
      }
      const details = role => ({
        ...(p.turn_id || context.turnId ? { turnId: p.turn_id || context.turnId } : {}),
        ...(role !== 'user' && (p.model || context.model) ? { model: p.model || context.model, modelSource: p.model ? 'message' : 'turn_context' } : {}),
        ...(['commentary', 'final', 'final_answer'].includes(p.phase || p.channel) ? { phase: (p.phase || p.channel) === 'commentary' ? 'commentary' : 'final' } : {}),
      });
      if (record.type === 'response_item' && p.type === 'message' && ['user', 'assistant'].includes(p.role)) {
        if (['analysis', 'summary'].includes(p.phase) || ['analysis', 'summary'].includes(p.channel)) continue;
        if (p.id && seen.has(p.id)) continue;
        if (p.id) seen.add(p.id);
        const content = contentParts(p.content).filter(part => part.type !== 'text' || visibleContext(part.text));
        if (content.length) candidates.push({ id: p.id || `codex-${line}`, role: p.role, content, timestamp: timestamp(record.timestamp), ...details(p.role), line });
      } else if (record.type === 'response_item' && ['function_call', 'custom_tool_call', 'function_call_output', 'custom_tool_call_output'].includes(p.type)) {
        candidates.push({ id: `codex-tool-${line}`, role: 'tool', content: [toolPart(p.name || p.call_id, p.arguments ?? p.input ?? p.output ?? '')], timestamp: timestamp(record.timestamp), ...details('tool'), line });
      } else if (record.type === 'event_msg' && ['user_message', 'agent_message'].includes(p.type) && p.message && visibleContext(p.message)) {
        mirrors.push({ id: `codex-event-${line}`, role: p.type === 'user_message' ? 'user' : 'assistant', content: [textPart(p.message)], timestamp: timestamp(record.timestamp), ...details(p.type === 'user_message' ? 'user' : 'assistant'), line });
      }
      if (record.type === 'event_msg' && ['task_complete', 'turn_aborted'].includes(p.type) && (!p.turn_id || p.turn_id === context.turnId)) context = {};
    }
    for (const message of candidates) {
      const item = itemMetadata.get(message.id);
      if (!message.turnId && item?.turnId) message.turnId = item.turnId;
      if (!message.phase && ['commentary', 'final', 'final_answer'].includes(item?.phase)) message.phase = item.phase === 'commentary' ? 'commentary' : 'final';
    }
    // Codex often writes the same message in event_msg and response_item.
    // Match counts, rather than globally deduplicating text (repeated questions are valid).
    const signature = m => JSON.stringify([m.turnId || '', m.role, m.content.filter(p => p.type === 'text').map(p => p.text).join('\n')]);
    const counts = new Map();
    for (const m of candidates.filter(m => m.role !== 'tool')) counts.set(signature(m), (counts.get(signature(m)) || 0) + 1);
    for (const m of mirrors) {
      const key = signature(m);
      if (counts.get(key)) counts.set(key, counts.get(key) - 1);
      else candidates.push(m);
    }
    if (metadata.forked_from_id) warnings.push({ code: 'FORK_PREFIX_NOT_LOADED', message: 'This is a fork. Only records present in this file were loaded; the parent session was not merged.' });
    if (session && metadata.id && session !== metadata.id) throw new Error('The selected file belongs to a different Codex session.');
    return conversation({ channel: this.id, id: metadata.id || session, title, messages: candidates.sort((a, b) => a.line - b.line).map(({ line, ...m }) => m), warnings, completeness: metadata.forked_from_id ? 'partial' : 'complete' });
  },
};
