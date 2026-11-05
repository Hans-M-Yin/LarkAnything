import { createLarkAnything, type Adapter, type Backend, type ConversationV1, type FormatProtocol, type Renderer, type ReceiptStore } from 'larkanything';

const conversation: ConversationV1 = {
  version: 1, kind: 'conversation', id: 'typed', title: 'Typed SDK', source: { channel: 'custom' },
  messages: [{ id: '1', role: 'user', content: [{ type: 'text', format: 'markdown', text: 'Hello' }] }],
};
const adapter: Adapter = { id: 'custom', version: 1, async load() { return conversation; } };
const protocol: FormatProtocol = {
  id: 'custom-protocol', version: 1, inputKinds: ['conversation'],
  format(source) {
    return { version: 1, kind: 'document', title: source.title, source: source.source, nodes: [{ type: 'paragraph', text: 'Body' }], warnings: [], coverage: { sourceMessages: 1, publishedMessages: 1, excludedToolItems: 0 }, unsupported: 'warn' };
  },
};
const renderer: Renderer = {
  id: 'custom-renderer', version: 1, outputFormat: 'markdown',
  render() { return { format: 'markdown', extension: 'md', body: 'Body', verificationText: 'Body', warnings: [] }; },
};
const backend: Backend = {
  id: 'custom-backend', version: 1, capabilities: { formats: ['markdown'], operations: ['create'], kinds: ['document'] },
  async publish() { return { documentId: 'typed-doc' }; },
  async verify() { return { passed: true, method: 'example', visualVerified: false }; },
};
const engine = createLarkAnything({ adapters: [adapter], protocols: [protocol], renderers: [renderer], backends: [backend] });
const store: ReceiptStore = engine.store;
void store;
void engine.plan({ channel: 'custom', input: 'file', overrides: { protocol: protocol.id, renderer: renderer.id, target: { backend: backend.id, operation: 'create' } } });
