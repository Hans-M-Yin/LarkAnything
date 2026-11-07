import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hash, validateSourceArtifact } from './model.mjs';
import { resolveOptions } from './config.mjs';
import { invariant, LarkAnythingError } from './errors.mjs';
import { prepareSync, sessionReceipt, validateExportKey } from './sync.mjs';

export class ExportEngine {
  constructor({ adapters, protocols, renderers, backends, config, store }) {
    Object.assign(this, { adapters, protocols, renderers, backends, config, store });
  }
  async plan(request) {
    validateExportKey(request.key);
    const options = resolveOptions(this.config, request.channel, request.profile, request.overrides);
    const adapter = this.adapters.get(request.channel);
    const model = validateSourceArtifact(await adapter.load(request));
    const protocol = this.protocols.get(options.protocol), renderer = this.renderers.get(options.renderer);
    invariant(protocol.inputKinds.includes(model.kind), 'PROTOCOL_INPUT', `Protocol ${protocol.id} does not accept ${model.kind}.`);
    let document = protocol.format(model, options.format), artifact = renderer.render(document);
    const backend = this.backends.get(options.target.backend);
    let target = { namespace: 'default', ...options.target, identityScope: backend.scope || 'default' }, sync;
    invariant(!request.repair || target.operation === 'sync', 'SYNC_REPAIR_OPERATION', 'Repair requires the sync operation.');
    if (target.operation === 'sync') {
      invariant(['create', 'append'].every(operation => backend.capabilities.operations.includes(operation)), 'BACKEND_CAPABILITY', 'Conversation sync requires a backend supporting create and append.');
      ({ target, document, artifact, sync } = await prepareSync({ store: this.store, model, protocol, renderer, options, target, document, artifact, channel: request.channel, repair: request.repair }));
    }
    backend.validateTarget?.(target);
    invariant(/^[a-z0-9]+$/.test(artifact.extension), 'ARTIFACT_EXTENSION', 'Renderer must declare a safe file extension.');
    invariant(backend.capabilities.formats.includes(artifact.format), 'BACKEND_FORMAT', `Backend ${backend.id} does not accept ${artifact.format}.`);
    invariant(backend.capabilities.operations.includes(target.operation) && backend.capabilities.kinds.includes(document.kind), 'BACKEND_CAPABILITY', 'Backend does not support the selected operation/document kind.');
    const plan = {
      version: 1, source: { channel: request.channel, artifactId: model.id, completeness: model.source.completeness || 'unknown', ...(model.source.manifest ? { manifest: model.source.manifest } : {}) },
      protocol: { id: protocol.id, version: protocol.version, options: options.format },
      renderer: { id: renderer.id, version: renderer.version },
      target,
      document: { title: document.title, kind: document.kind, coverage: document.coverage }, artifact,
      ...(sync ? { sync } : {}),
    };
    plan.fingerprint = hash(plan);
    plan.exportKey = request.key || plan.fingerprint;
    return plan;
  }
  async preview(plan, directory) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const renderer = this.renderers.get(plan.renderer.id);
    const html = renderer.preview?.(plan.document.title, plan.artifact);
    await Promise.all([
      writeFile(join(directory, `document.${plan.artifact.extension}`), plan.artifact.body, { mode: 0o600 }),
      ...(html ? [writeFile(join(directory, 'preview.html'), html, { mode: 0o600 })] : []),
      writeFile(join(directory, 'plan.json'), JSON.stringify(plan, null, 2) + '\n', { mode: 0o600 }),
    ]);
    return { directory, artifact: join(directory, `document.${plan.artifact.extension}`), ...(html ? { html: join(directory, 'preview.html') } : {}), plan: join(directory, 'plan.json') };
  }
  async recover(plan) {
    const { fingerprint, exportKey, ...payload } = plan;
    invariant(plan.version === 1 && fingerprint === hash(payload), 'PLAN_MODIFIED', 'Regenerate a modified plan.');
    invariant(plan.sync && plan.target.documentId && (plan.target.operation === 'append' || (plan.sync.repair && plan.target.operation === 'overwrite')),
      'SYNC_RECOVER_OPERATION', 'Read-only recovery requires a sync append or explicit in-place repair with a known document.');
    const backend = this.backends.get(plan.target.backend);
    invariant(plan.target.identityScope === (backend.scope || 'default'), 'PLAN_IDENTITY', 'Use the original backend identity.');
    return this.store.withLock(plan.sync.key, () => this.store.withLock(exportKey, async () => {
      const receipt = await this.store.get(exportKey);
      const binding = await sessionReceipt(this.store, plan.sync.key);
      invariant(receipt?.fingerprint === fingerprint && binding?.exportKey === exportKey,
        'SYNC_STALE_PLAN', 'Recovery requires the current repair receipt.');
      if (receipt.status === 'verified') return { ...receipt, reused: true };
      invariant(receipt.status === 'uncertain', 'SYNC_RECOVER_STATE', 'Recovery requires an uncertain repair write.');
      const previous = await this.store.get(plan.sync.previousExportKey);
      const remote = { documentId: plan.target.documentId, url: binding.remote?.url || previous?.remote?.url };
      const verification = await backend.verify(remote, plan);
      invariant(verification.passed, 'READBACK_MISMATCH', 'Repair recovery did not pass readback; no state was changed.', { verification });
      Object.assign(receipt, { remote, verification, status: 'verified' });
      delete receipt.errorCode;
      await this.store.put(exportKey, receipt);
      await this.store.put(plan.sync.key, receipt);
      return receipt;
    }));
  }
  async publish(plan) {
    const { fingerprint, exportKey, ...payload } = plan;
    invariant(plan.version === 1 && fingerprint === hash(payload) && typeof exportKey === 'string' && exportKey.length, 'PLAN_MODIFIED', 'The plan was modified after preparation. Regenerate it before publishing.');
    const backend = this.backends.get(plan.target.backend);
    invariant(plan.target.identityScope === (backend.scope || 'default'), 'PLAN_IDENTITY', 'The saved plan uses a different backend identity. Select its original configuration before publishing.');
    validateExportKey(exportKey);
    backend.validateTarget?.(plan.target);
    const publish = () => this.store.withLock(exportKey, async () => {
      let receipt = await this.store.get(exportKey);
      if (receipt) {
        invariant(receipt.fingerprint === fingerprint, 'KEY_CONFLICT', 'This export key already represents different content or a different destination. Use a new key.');
        if (receipt.status === 'verified') return { ...receipt, reused: true };
        if (!receipt.remote?.documentId) throw new LarkAnythingError('WRITE_UNCERTAIN', 'A previous write has an uncertain result. It will not be replayed automatically. Inspect Feishu and the saved receipt before starting a new export.', { exportKey, causeCode: receipt.errorCode, diagnostic: receipt.diagnostic });
        // A known successful write is only read back again, never written twice.
      }
      const binding = plan.sync ? await sessionReceipt(this.store, plan.sync.key) : undefined;
      if (plan.sync) {
        invariant((binding?.exportKey || null) === plan.sync.previousExportKey || (receipt && binding?.exportKey === exportKey),
          'SYNC_STALE_PLAN', 'This conversation was published after the plan was prepared. Prepare a new plan to append only the remaining messages.');
        if (plan.sync.repair && !receipt) invariant(binding?.status === 'verification_failed' && binding.remote?.documentId === plan.target.documentId,
          'SYNC_REPAIR_STATE', 'The failed document changed after repair was prepared.');
      }
      const save = async () => {
        await this.store.put(exportKey, receipt);
        if (plan.sync) await this.store.put(plan.sync.key, receipt);
      };
      if (!receipt && plan.sync?.unchanged) {
        invariant(binding?.status === 'verified' && binding.remote?.documentId === plan.target.documentId, 'SYNC_STATE', 'The unchanged export has no verified document.');
        receipt = { ...binding, exportKey, fingerprint, operation: plan.target.operation, sync: plan.sync, reused: true };
        // Keep the session revision fixed when there is no remote write, so
        // repeated no-op plans have a stable fingerprint and export key.
        await this.store.put(exportKey, receipt);
        return receipt;
      }
      if (!receipt) {
        receipt = { version: 1, exportKey, fingerprint, status: 'publishing', backend: backend.id, operation: plan.target.operation, createdAt: new Date().toISOString(), warnings: plan.artifact.warnings,
          ...(plan.sync ? { sync: plan.sync } : {}) };
        await save();
        try {
          const remote = await backend.publish(plan);
          if (plan.sync && ['append', 'overwrite'].includes(plan.target.operation)) invariant(remote.documentId === plan.target.documentId, 'SYNC_DOCUMENT', 'The backend returned a different document. Inspect the write before retrying.');
          receipt.remote = remote;
          receipt.status = 'written';
          receipt.warnings = [...receipt.warnings, ...(receipt.remote.warnings || [])];
          await save();
        } catch (error) {
          receipt.status = 'uncertain'; receipt.errorCode = error.code || 'WRITE_ERROR';
          if (backend.id === 'lark-cli') receipt.diagnostic = Object.fromEntries(
            ['exitCode', 'signal', 'interrupted', 'cliCode', 'type', 'subtype', 'missingScopes'].filter(key => error.details?.[key] !== undefined).map(key => [key, error.details[key]]));
          await save();
          throw new LarkAnythingError('WRITE_UNCERTAIN', 'Publishing did not produce a confirmed receipt. The write may have completed; automatic replay is disabled.', { exportKey, causeCode: receipt.errorCode, diagnostic: receipt.diagnostic });
        }
      }
      try {
        receipt.verification = await backend.verify(receipt.remote, plan);
        receipt.status = receipt.verification.passed ? 'verified' : 'verification_failed';
        delete receipt.errorCode;
        await save();
      } catch (error) {
        receipt.status = 'verification_failed'; receipt.errorCode = error.code || 'READBACK_ERROR';
        await save();
        throw new LarkAnythingError('READBACK_ERROR', 'The document was written, but readback failed. Rerun the same export to retry only verification.', { exportKey, documentId: receipt.remote.documentId, url: receipt.remote.url });
      }
      if (!receipt.verification.passed) throw new LarkAnythingError('READBACK_MISMATCH', 'The document exists, but verification did not pass. Retry the saved plan to repeat only verification; do not reconstruct the transcript or override the result.', { exportKey, documentId: receipt.remote.documentId, url: receipt.remote.url, verification: receipt.verification });
      return receipt;
    });
    return plan.sync ? this.store.withLock(plan.sync.key, publish) : publish();
  }
}
