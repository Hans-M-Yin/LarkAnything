import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { conversation, hash, timestamp } from '../core/model.mjs';
import { invariant, LarkAnythingError } from '../core/errors.mjs';
import { contentParts, injectedSkill, readJsonLines, textPart, toolPart, visibleContext } from './shared.mjs';
import { resolveSessionSources } from './discovery.mjs';

const publicText = text => visibleContext(text) && !injectedSkill(text);
const textSignature = m => JSON.stringify([m.role, m.content.filter(p => p.type === 'text').map(p => p.text).join('\n')]);
const signature = m => JSON.stringify([m.turnId || '', textSignature(m)]);

async function loadSegment(input, session) {
  input = resolve(input);
  // Parse and fingerprint the same read, even when the active log is still growing.
  const bytes = await readFile(input), text = bytes.toString('utf8');
  const records = await readJsonLines(input, text);
  const headers = records.filter(r => r.value.type === 'session_meta').map(r => r.value.payload || {});
  const metadata = headers[0] || {};
  invariant(headers.every(p => p.id === metadata.id), 'SOURCE_SESSION_CONFLICT', 'A source file contains different session identities.');
  invariant(!session || !metadata.id || session === metadata.id, 'SOURCE_SESSION_CONFLICT', 'The selected file belongs to a different Codex session.');
  let context = {}, excludedContextRecords = 0;
  let orderTime = timestamp(metadata.timestamp) || records.map(r => timestamp(r.value.timestamp)).find(Boolean);
  const candidates = [], mirrors = [], itemMetadata = new Map(), recordCounts = new Map();
  for (const { value: record, line } of records) {
    const p = record.payload || {};
    const recordHash = hash(record), occurrence = recordCounts.get(recordHash) || 0;
    recordCounts.set(recordHash, occurrence + 1);
    const recorded = timestamp(record.timestamp);
    if (recorded && (!orderTime || recorded > orderTime)) orderTime = recorded;
    if (record.type === 'event_msg' && p.type === 'task_started') context = { turnId: p.turn_id };
    if (record.type === 'turn_context') context = { turnId: p.turn_id || context.turnId, model: p.model };
    if (record.type === 'event_msg' && p.type === 'item_completed' && p.item?.id) itemMetadata.set(p.item.id, { turnId: p.turn_id, phase: p.item.phase || p.item.channel });
    const details = role => ({
      ...(p.turn_id || context.turnId ? { turnId: p.turn_id || context.turnId } : {}),
      ...(role !== 'user' && (p.model || context.model) ? { model: p.model || context.model, modelSource: p.model ? 'message' : 'turn_context' } : {}),
      ...(['commentary', 'final', 'final_answer'].includes(p.phase || p.channel) ? { phase: (p.phase || p.channel) === 'commentary' ? 'commentary' : 'final' } : {}),
    });
    const origin = { sourceRefs: [{ uri: input, line }], _time: recorded || orderTime, _line: line,
      _identity: p.id ? `item:${p.type}:${p.id}` : record.timestamp ? `record:${recordHash}` : undefined };
    // Recorded identities survive renamed/moved logs and newly discovered copies.
    const segmentKey = hash([metadata.id, metadata.timestamp || input]).slice(0, 16);
    const fallback = `codex-${record.timestamp ? 'record' : segmentKey}-${recordHash}-${occurrence}`;
    if (record.type === 'response_item' && p.type === 'message' && ['user', 'assistant'].includes(p.role)) {
      const parts = contentParts(p.content);
      const content = parts.filter(part => p.role !== 'user' || part.type !== 'text' || publicText(part.text));
      if (content.length !== parts.length) excludedContextRecords++;
      if (content.length) candidates.push({ id: p.id || fallback, role: p.role, content, timestamp: recorded, ...details(p.role), ...origin,
        ...(['analysis', 'summary'].includes(p.phase) || ['analysis', 'summary'].includes(p.channel) ? { _private: true } : {}) });
    } else if (record.type === 'response_item' && ['function_call', 'custom_tool_call', 'function_call_output', 'custom_tool_call_output'].includes(p.type)) {
      candidates.push({ id: fallback, role: 'tool', content: [toolPart(p.name || p.call_id, p.arguments ?? p.input ?? p.output ?? '')], timestamp: recorded, ...details('tool'), ...origin });
    } else if (record.type === 'event_msg' && ['user_message', 'agent_message'].includes(p.type) && p.message) {
      if (p.type === 'user_message' && !publicText(p.message)) { excludedContextRecords++; continue; }
      if (['analysis', 'summary'].includes(p.phase) || ['analysis', 'summary'].includes(p.channel)) continue;
      mirrors.push({ id: fallback, role: p.type === 'user_message' ? 'user' : 'assistant', content: [textPart(p.message)], timestamp: recorded, ...details(p.type === 'user_message' ? 'user' : 'assistant'), ...origin, _mirror: true });
    }
    if (record.type === 'event_msg' && ['task_complete', 'turn_aborted'].includes(p.type) && (!p.turn_id || p.turn_id === context.turnId)) context = {};
  }
  for (const message of candidates) {
    const item = itemMetadata.get(message.id);
    if (!message.turnId && item?.turnId) message.turnId = item.turnId;
    if (['analysis', 'summary'].includes(item?.phase)) message._private = true;
    if (!message.phase && ['commentary', 'final', 'final_answer'].includes(item?.phase)) message.phase = item.phase === 'commentary' ? 'commentary' : 'final';
  }
  const counts = new Map(), hiddenCounts = new Map();
  const visible = candidates.filter(m => !m._private), hiddenMessages = candidates.filter(m => m._private);
  for (const m of candidates.filter(m => m.role !== 'tool')) {
    const map = m._private ? hiddenCounts : counts;
    map.set(signature(m), (map.get(signature(m)) || 0) + 1);
  }
  for (const m of mirrors) {
    const key = signature(m);
    if (counts.get(key)) counts.set(key, counts.get(key) - 1);
    else if (hiddenCounts.get(key)) hiddenCounts.set(key, hiddenCounts.get(key) - 1);
    else {
      // Completion events can supply a turn id missing from an older mirror.
      const hidden = hiddenMessages.find(item => hiddenCounts.get(signature(item))
        && (!m.turnId || !item.turnId) && textSignature(item) === textSignature(m));
      if (hidden) hiddenCounts.set(signature(hidden), hiddenCounts.get(signature(hidden)) - 1);
      else visible.push(m);
    }
  }
  return { metadata, messages: visible.sort((a, b) => a._line - b._line), hiddenMessages, itemMetadata, excludedContextRecords,
    file: { uri: input, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, records: records.length },
    startedAt: timestamp(metadata.timestamp) || records.map(r => timestamp(r.value.timestamp)).find(Boolean) };
}

function completeItemMetadata(segments) {
  const items = new Map(), hidden = segments.flatMap(s => s.hiddenMessages);
  for (const segment of segments) for (const [id, item] of segment.itemMetadata) {
    const previous = items.get(id);
    if (previous?.turnId && item.turnId && previous.turnId !== item.turnId) {
      throw new LarkAnythingError('SOURCE_MESSAGE_CONFLICT', 'Completion records assign one message to different turns.', { messageId: id });
    }
    items.set(id, { ...previous, ...Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined)),
      private: previous?.private || ['analysis', 'summary'].includes(item.phase) });
  }
  for (const segment of segments) for (const message of segment.messages) {
    const item = items.get(message.id);
    if (!message.turnId && item?.turnId) message.turnId = item.turnId;
    if (!message.phase && ['commentary', 'final', 'final_answer'].includes(item?.phase)) message.phase = item.phase === 'commentary' ? 'commentary' : 'final';
    if (item?.private) { message._private = true; hidden.push(message); }
  }
  for (const segment of segments) segment.messages = segment.messages.filter(message => !message._private
    && !(message._mirror && hidden.some(item => (!message.turnId || !item.turnId || message.turnId === item.turnId) && textSignature(message) === textSignature(item))));
}

function assemble(segments) {
  const messages = [], identities = new Map(), ambiguous = new Map();
  let deduplicatedMessages = 0, retainedAmbiguousMessages = 0;
  for (const [segment, data] of segments.entries()) {
    const occurrences = new Map();
    for (const message of data.messages) {
      let identity = message._identity;
      if (identity?.startsWith('record:')) {
        const count = occurrences.get(identity) || 0;
        occurrences.set(identity, count + 1); identity += `:${count}`;
      }
      const previous = identity && identities.get(identity);
      if (previous) {
        const conflict = previous.role !== message.role || JSON.stringify(previous.content) !== JSON.stringify(message.content)
          || ['turnId', 'model', 'phase'].some(key => previous[key] && message[key] && previous[key] !== message[key]);
        if (conflict) throw new LarkAnythingError('SOURCE_MESSAGE_CONFLICT', 'The same recorded message has conflicting content or metadata. No content was published.', { messageId: message.id, sources: [...previous.sourceRefs, ...message.sourceRefs] });
        for (const key of ['turnId', 'model', 'modelSource', 'phase', 'timestamp']) previous[key] ??= message[key];
        previous.sourceRefs.push(...message.sourceRefs); deduplicatedMessages++; continue;
      }
      if (identity) identities.set(identity, message);
      // Similar text alone does not prove duplication or replacement of a draft.
      const key = signature(message), priorSegment = ambiguous.get(key);
      if (priorSegment !== undefined && priorSegment !== segment) retainedAmbiguousMessages++;
      ambiguous.set(key, segment);
      message._segment = segment; messages.push(message);
    }
  }
  messages.sort((a, b) => (a._time || '').localeCompare(b._time || '') || a._segment - b._segment || a._line - b._line);
  const publicMessages = messages.filter(m => m.role !== 'tool');
  for (let i = 1; i < publicMessages.length; i++) {
    const a = publicMessages[i - 1], b = publicMessages[i];
    if (a.role !== 'user' || b.role !== 'user' || a._segment === b._segment) continue;
    const left = a.content.filter(p => p.type === 'text').map(p => p.text).join('\n').trim();
    const right = b.content.filter(p => p.type === 'text').map(p => p.text).join('\n').trim();
    if (left && right && left !== right && (left.startsWith(right) || right.startsWith(left))) retainedAmbiguousMessages++;
  }
  return { messages: messages.map(({ _time, _line, _identity, _segment, _mirror, ...m }) => m), deduplicatedMessages, retainedAmbiguousMessages };
}

export const codexAdapter = {
  id: 'codex', version: 1,
  async load({ input, title, session, sourceOptions }) {
    const scope = input ? 'file' : 'local-session';
    const inputs = input ? [input] : await resolveSessionSources(this.id, session, sourceOptions);
    const segments = [];
    for (const path of inputs) segments.push(await loadSegment(path, session));
    segments.sort((a, b) => (a.startedAt || '').localeCompare(b.startedAt || '') || a.file.uri.localeCompare(b.file.uri));
    const id = session || segments[0].metadata.id;
    invariant(segments.every(s => !s.metadata.id || s.metadata.id === id), 'SOURCE_SESSION_CONFLICT', 'Source segments belong to different sessions.');
    completeItemMetadata(segments);
    const assembled = assemble(segments), warnings = [];
    const fork = segments.some(s => s.metadata.forked_from_id);
    const uncertain = scope === 'file' || segments.some(s => !s.metadata.id || !s.startedAt);
    const completeness = fork ? 'partial' : uncertain ? 'unknown' : 'complete';
    if (fork) warnings.push({ code: 'FORK_PREFIX_NOT_LOADED', message: 'This is a fork. Parent history was not merged; only this session’s local records were loaded.' });
    if (uncertain) warnings.push({ code: 'SOURCE_COMPLETENESS_UNKNOWN', message: scope === 'file' ? 'Only the specified file was loaded. Use --session to discover all local segments; full conversation completeness is unknown.' : 'Some records lack session or ordering metadata; complete local history cannot be confirmed.' });
    if (segments.length > 1) warnings.push({ code: 'SOURCE_SEGMENTS_MERGED', message: `${segments.length} local segments with the same session identity were assembled automatically.` });
    if (assembled.retainedAmbiguousMessages) warnings.push({ code: 'AMBIGUOUS_MESSAGES_RETAINED', message: `${assembled.retainedAmbiguousMessages} similar message(s) across segments were retained because their identities do not prove duplication. Text prefixes are never used to delete messages.` });
    const messageCounts = { user: 0, assistant: 0, tool: 0 };
    for (const m of assembled.messages) messageCounts[m.role]++;
    const manifest = { version: 1, scope, files: segments.map(s => s.file), messageCounts,
      excludedContextRecords: segments.reduce((n, s) => n + s.excludedContextRecords, 0),
      deduplicatedMessages: assembled.deduplicatedMessages, retainedAmbiguousMessages: assembled.retainedAmbiguousMessages };
    const model = conversation({ channel: this.id, id, title, messages: assembled.messages, warnings, completeness });
    model.source.manifest = manifest;
    return model;
  },
};
