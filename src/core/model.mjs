import { createHash } from 'node:crypto';
import { invariant } from './errors.mjs';

export const MODEL_VERSION = 1;
export const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');

export function validateSourceArtifact(value) {
  invariant(value?.version === MODEL_VERSION, 'MODEL_VERSION', 'Conversation version must be 1.');
  invariant(typeof value.kind === 'string' && value.kind.length > 0, 'MODEL_KIND', 'Source artifact kind is required.');
  invariant(typeof value.id === 'string' && value.id.length > 0, 'MODEL_ID', 'Conversation id is required.');
  invariant(typeof value.title === 'string' && value.title.trim().length > 0, 'MODEL_TITLE', 'Conversation title is required.');
  invariant(typeof value.source?.channel === 'string', 'MODEL_SOURCE', 'Conversation source.channel is required.');
  return value;
}

export function validateConversation(value) {
  validateSourceArtifact(value);
  invariant(value.kind === 'conversation', 'MODEL_KIND', 'Expected a conversation artifact.');
  invariant(Array.isArray(value.messages) && value.messages.length > 0, 'EMPTY_CONVERSATION', 'No supported user or assistant messages were found.');
  const ids = new Set();
  for (const message of value.messages) {
    invariant(typeof message.id === 'string' && !ids.has(message.id), 'MESSAGE_ID', 'Message ids must be unique strings.');
    ids.add(message.id);
    for (const key of ['turnId', 'model']) if (message[key] !== undefined) invariant(typeof message[key] === 'string' && message[key].trim(), 'MESSAGE_METADATA', `${key} must be a nonempty string.`);
    if (message.modelSource !== undefined) invariant(['message', 'turn_context'].includes(message.modelSource), 'MESSAGE_METADATA', 'Unknown modelSource.');
    if (message.phase !== undefined) invariant(['commentary', 'final'].includes(message.phase), 'MESSAGE_METADATA', 'Unknown message phase.');
    invariant(['user', 'assistant', 'tool'].includes(message.role), 'MESSAGE_ROLE', `Unsupported message role: ${message.role}`);
    invariant(Array.isArray(message.content) && message.content.length > 0, 'MESSAGE_CONTENT', 'Message content must be a nonempty array.');
    for (const part of message.content) {
      invariant(['text', 'code', 'image', 'tool', 'unsupported'].includes(part.type), 'CONTENT_TYPE', `Unsupported content part: ${part.type}`);
      if (['text', 'code', 'tool'].includes(part.type)) invariant(typeof part.text === 'string', 'CONTENT_TEXT', 'Content text must be a string.');
      if (part.type === 'text') invariant(['plain', 'markdown'].includes(part.format), 'TEXT_FORMAT', 'Text format must be plain or markdown.');
      if (part.type === 'image') invariant(typeof part.src === 'string', 'IMAGE_SOURCE', 'Image src must be a string.');
      if (part.type === 'unsupported') invariant(typeof part.label === 'string', 'CONTENT_LABEL', 'Unsupported content needs a label.');
    }
  }
  return value;
}

export function conversation({ channel, id, title, messages, warnings = [], uri, completeness = 'complete' }) {
  const first = messages.find(m => m.role === 'user')?.content.find(p => p.type === 'text')?.text;
  return validateConversation({
    version: MODEL_VERSION, kind: 'conversation', id: id || hash(messages).slice(0, 24),
    title: title || first?.replace(/\s+/g, ' ').slice(0, 80) || `${channel} conversation`,
    source: { channel, ...(uri ? { uri } : {}), completeness }, messages, warnings,
  });
}

export function timestamp(value) {
  if (value == null) return undefined;
  const date = new Date(typeof value === 'number' ? value * 1000 : value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
