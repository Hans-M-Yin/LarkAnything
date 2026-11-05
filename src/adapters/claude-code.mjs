import { conversation, timestamp } from '../core/model.mjs';
import { contentParts, readJsonLines } from './shared.mjs';
import { resolveSession } from './discovery.mjs';

export const claudeCodeAdapter = {
  id: 'claude-code', version: 1,
  async load({ input, title, session }) {
    input ||= await resolveSession(this.id, session);
    const rows = (await readJsonLines(input)).map(r => r.value).filter(r => !r.isSidechain);
    const byId = new Map(rows.filter(r => r.uuid).map(r => [r.uuid, r]));
    const leaf = rows.findLast(r => r.uuid && ['user', 'assistant'].includes(r.type));
    const selected = [], visited = new Set(), warnings = [];
    if (leaf) {
      let cursor = leaf;
      while (cursor) {
        if (visited.has(cursor.uuid)) throw new Error('Cycle in Claude Code parentUuid chain.');
        visited.add(cursor.uuid);
        selected.unshift(cursor);
        if (cursor.parentUuid && !byId.has(cursor.parentUuid)) {
          warnings.push({ code: 'MISSING_PARENT', message: 'A parent message is missing. Only the available conversation branch was loaded.' });
          break;
        }
        cursor = byId.get(cursor.parentUuid);
      }
    } else selected.push(...rows);
    const messages = selected.flatMap((r, index) => {
      if (!['user', 'assistant'].includes(r.type) || !r.message) return [];
      const parts = contentParts(r.message.content);
      if (!parts.length) return [];
      return [{ id: r.uuid || `claude-${index}`, role: parts.every(p => p.type === 'tool') ? 'tool' : r.type, content: parts, timestamp: timestamp(r.timestamp), ...(r.type === 'assistant' && r.message.model ? { model: r.message.model, modelSource: 'message' } : {}) }];
    });
    const id = leaf?.sessionId || rows.find(r => r.sessionId)?.sessionId;
    if (session && id && session !== id) throw new Error('The selected file belongs to a different Claude Code session.');
    return conversation({ channel: this.id, id: id || session, title, messages, warnings, completeness: warnings.length ? 'partial' : 'complete' });
  },
};
