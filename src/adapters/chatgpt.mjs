import { readFile } from 'node:fs/promises';
import { conversation, timestamp } from '../core/model.mjs';
import { invariant } from '../core/errors.mjs';
import { contentParts } from './shared.mjs';

export const chatgptAdapter = {
  id: 'chatgpt', version: 1,
  async load({ input, session, title }) {
    const json = JSON.parse(await readFile(input, 'utf8'));
    const all = Array.isArray(json) ? json : [json];
    const selected = session ? all.find(c => (c.id || c.conversation_id) === session) : all.length === 1 ? all[0] : null;
    invariant(selected, 'SELECT_CONVERSATION', 'Specify --session when the ChatGPT export contains multiple conversations.');
    invariant(selected.mapping && selected.current_node, 'CHATGPT_FORMAT', 'Expected a ChatGPT conversation with mapping and current_node.');
    let node = selected.current_node;
    const chain = [], visited = new Set();
    while (node) {
      invariant(!visited.has(node), 'BRANCH_CYCLE', 'Cycle in the ChatGPT conversation branch.');
      visited.add(node);
      const record = selected.mapping[node];
      invariant(record, 'MISSING_PARENT', `Missing node in ChatGPT branch: ${node}`);
      if (record.message) chain.unshift(record.message);
      node = record.parent;
    }
    const messages = chain.flatMap((m, index) => {
      let role = m.author?.role;
      if (!['user', 'assistant', 'tool'].includes(role)) return [];
      if (m.metadata?.is_visually_hidden_from_conversation || m.channel === 'analysis') return [];
      if (role === 'assistant' && m.recipient && m.recipient !== 'all') role = 'tool';
      const content = contentParts(m.content?.parts || (typeof m.content?.text === 'string' ? [m.content.text] : m.content ? [{ ...m.content, type: m.content.content_type || 'unknown' }] : []));
      if (!content.length) return [];
      return [{ id: m.id || `chatgpt-${index}`, role, content, timestamp: timestamp(m.create_time), ...(role === 'assistant' && m.metadata?.model_slug ? { model: m.metadata.model_slug, modelSource: 'message' } : {}) }];
    });
    return conversation({ channel: this.id, id: selected.id || selected.conversation_id, title: title || selected.title, messages });
  },
};
