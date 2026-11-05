import { hash, validateConversation } from './model.mjs';
import { invariant, LarkAnythingError } from './errors.mjs';

const prefix = 'larkanything:session:';

// Paths and source manifests can change when logs are assembled or moved.
// Compare the exported message itself, without retaining its private text.
function checkpoint(message) {
  const { id, role, content, timestamp, turnId, model, modelSource, phase } = message;
  return { id, hash: hash({ role, content, timestamp, turnId, model, modelSource, phase }) };
}

export async function sessionReceipt(store, key) {
  const binding = await store.get(key);
  return binding ? await store.get(binding.exportKey) || binding : undefined;
}

export async function prepareSync({ store, model, protocol, renderer, options, target, document, artifact, channel }) {
  invariant(model.kind === 'conversation' && typeof protocol.selectMessages === 'function', 'SYNC_PROTOCOL', 'This protocol does not support message synchronization. Select an explicit backend operation such as create.');
  validateConversation(model);
  invariant(!target.documentId, 'TARGET_CONFLICT', 'Sync finds the document by conversation id. Use append with documentId to select a document manually.');
  const key = prefix + hash({ channel, artifactId: model.id, backend: target.backend,
    namespace: target.namespace, identityScope: target.identityScope, parentToken: target.parentToken || null });
  const previous = await sessionReceipt(store, key);
  if (previous && previous.status !== 'verified') {
    throw new LarkAnythingError(['publishing', 'uncertain'].includes(previous.status) ? 'WRITE_UNCERTAIN' : 'SYNC_PENDING',
      'This conversation has an unfinished publish. Retry its saved plan before exporting more messages; an uncertain write must be inspected first.',
      { exportKey: previous.exportKey, documentId: previous.remote?.documentId, url: previous.remote?.url });
  }
  const messages = protocol.selectMessages(model, options.format).map(checkpoint);
  const old = previous?.sync?.messages || [];
  invariant(old.length <= messages.length && old.every((entry, i) => entry.id === messages[i].id && entry.hash === messages[i].hash),
    'SYNC_HISTORY_CHANGED', 'Previously published messages changed, disappeared, or moved to another branch. Restore the original history or use a new namespace / explicit create; no content was written.');
  const unchanged = !!previous && old.length === messages.length;
  if (previous) {
    invariant(previous.remote?.documentId && previous.sync, 'SYNC_STATE', 'The conversation binding has no document or message checkpoint.');
    target = { ...target, operation: 'append', documentId: previous.remote.documentId };
    delete target.parentToken;
    if (unchanged) {
      document = { ...document, coverage: { sourceMessages: 0, publishedMessages: 0, displayGroups: 0, mergedAssistantMessages: 0, excludedToolItems: 0 } };
      artifact = { ...artifact, body: '', verificationText: '' };
    } else {
      const offset = old.length ? model.messages.findIndex(message => message.id === old.at(-1).id) + 1 : 0;
      document = protocol.format({ ...model, messages: model.messages.slice(offset) }, options.format,
        { append: true, groupOffset: previous.sync.displayGroups });
      artifact = renderer.render(document);
    }
  } else target = { ...target, operation: 'create' };
  const sync = { key, previousExportKey: previous?.exportKey || null, messages,
    displayGroups: (previous?.sync.displayGroups || 0) + (document.coverage.displayGroups || 0), unchanged };
  return { target, document, artifact, sync };
}

export function validateExportKey(key) {
  invariant(!key?.startsWith(prefix), 'EXPORT_KEY', 'Export keys may not use the reserved session-state prefix.');
}
