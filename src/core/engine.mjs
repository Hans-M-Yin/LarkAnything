import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hash, validateSourceArtifact } from './model.mjs';
import { resolveOptions } from './config.mjs';
import { invariant, LarkAnythingError } from './errors.mjs';

export class ExportEngine {
  constructor({ adapters, protocols, renderers, backends, config, store }) {
    Object.assign(this, { adapters, protocols, renderers, backends, config, store });
  }
  async plan(request) {
    const options = resolveOptions(this.config, request.channel, request.profile, request.overrides);
    const adapter = this.adapters.get(request.channel);
    const model = validateSourceArtifact(await adapter.load(request));
    const protocol = this.protocols.get(options.protocol), renderer = this.renderers.get(options.renderer);
    invariant(protocol.inputKinds.includes(model.kind), 'PROTOCOL_INPUT', `Protocol ${protocol.id} does not accept ${model.kind}.`);
    const document = protocol.format(model, options.format), artifact = renderer.render(document);
    const backend = this.backends.get(options.target.backend);
    backend.validateTarget?.(options.target);
    invariant(/^[a-z0-9]+$/.test(artifact.extension), 'ARTIFACT_EXTENSION', 'Renderer must declare a safe file extension.');
    invariant(backend.capabilities.formats.includes(artifact.format), 'BACKEND_FORMAT', `Backend ${backend.id} does not accept ${artifact.format}.`);
    invariant(backend.capabilities.operations.includes(options.target.operation) && backend.capabilities.kinds.includes(document.kind), 'BACKEND_CAPABILITY', 'Backend does not support the selected operation/document kind.');
    const plan = {
      version: 1, source: { channel: request.channel, artifactId: model.id, completeness: model.source.completeness || 'unknown' },
      protocol: { id: protocol.id, version: protocol.version, options: options.format },
      renderer: { id: renderer.id, version: renderer.version },
      target: { namespace: 'default', ...options.target, identityScope: backend.scope || 'default' },
      document: { title: document.title, kind: document.kind, coverage: document.coverage }, artifact,
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
  async publish(plan) {
    const { fingerprint, exportKey, ...payload } = plan;
    invariant(plan.version === 1 && fingerprint === hash(payload) && typeof exportKey === 'string' && exportKey.length, 'PLAN_MODIFIED', 'The plan was modified after preparation. Regenerate it before publishing.');
    const backend = this.backends.get(plan.target.backend);
    return this.store.withLock(exportKey, async () => {
      let receipt = await this.store.get(exportKey);
      if (receipt) {
        invariant(receipt.fingerprint === fingerprint, 'KEY_CONFLICT', 'This export key already represents different content or a different destination. Use a new key.');
        if (receipt.status === 'verified') return { ...receipt, reused: true };
        invariant(receipt.remote?.documentId, 'WRITE_UNCERTAIN', 'A previous write has an uncertain result. It will not be replayed automatically. Inspect Feishu and the saved receipt before starting a new export.');
        // A known successful write is only read back again, never written twice.
      } else {
        receipt = { version: 1, exportKey, fingerprint, status: 'publishing', backend: backend.id, operation: plan.target.operation, createdAt: new Date().toISOString(), warnings: plan.artifact.warnings };
        await this.store.put(exportKey, receipt);
        try {
          receipt.remote = await backend.publish(plan);
          receipt.status = 'written';
          receipt.warnings = [...receipt.warnings, ...(receipt.remote.warnings || [])];
          await this.store.put(exportKey, receipt);
        } catch (error) {
          receipt.status = 'uncertain'; receipt.errorCode = error.code || 'WRITE_ERROR';
          await this.store.put(exportKey, receipt);
          throw new LarkAnythingError('WRITE_UNCERTAIN', 'Publishing did not produce a confirmed receipt. The write may have completed; automatic replay is disabled.', { exportKey, causeCode: receipt.errorCode });
        }
      }
      try {
        receipt.verification = await backend.verify(receipt.remote, plan);
        receipt.status = receipt.verification.passed ? 'verified' : 'verification_failed';
        await this.store.put(exportKey, receipt);
      } catch (error) {
        receipt.status = 'verification_failed'; receipt.errorCode = error.code || 'READBACK_ERROR';
        await this.store.put(exportKey, receipt);
        throw new LarkAnythingError('READBACK_ERROR', 'The document was written, but readback failed. Rerun the same export to retry only verification.', { exportKey, documentId: receipt.remote.documentId, url: receipt.remote.url });
      }
      invariant(receipt.verification.passed, 'READBACK_MISMATCH', `The document exists, but text verification did not pass. Export key: ${exportKey}. Inspect the saved receipt; no write will be repeated.`);
      return receipt;
    });
  }
}
