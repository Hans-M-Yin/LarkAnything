import { execFile } from 'node:child_process';
import { invariant, LarkAnythingError } from '../core/errors.mjs';
import { markdownReadbackText } from '../renderers/markdown.mjs';

export function runLarkCli(executable, args, { input, timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(executable, args, { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8', windowsHide: true }, (error, stdout) => {
      if (error) {
        reject(new LarkAnythingError('LARK_CLI_ERROR', error.code === 'ENOENT'
          ? 'lark-cli is not installed. Install @larksuite/cli and complete user authorization.'
          : 'lark-cli failed or timed out. Check authorization/scopes with lark-cli. A write may have completed; it will not be retried automatically.', { exitCode: error.code }));
        return;
      }
      try {
        const result = JSON.parse(stdout);
        invariant(result.ok === true, 'LARK_RESPONSE', 'lark-cli did not report ok=true. Check authorization/scopes and inspect the document before retrying.');
        resolve(result);
      } catch (error) { reject(error instanceof LarkAnythingError ? error : new LarkAnythingError('LARK_RESPONSE', 'lark-cli returned an unrecognized response. A write may have completed; inspect it before retrying.')); }
    });
    // No shell is involved; conversation text and arguments are never executable.
    child.stdin.on('error', () => {});
    child.stdin.end(input || '');
  });
}

export class LarkCliBackend {
  id = 'lark-cli'; version = 1;
  capabilities = { formats: ['markdown'], operations: ['create', 'append'], kinds: ['document'] };
  constructor(options = {}, runner = runLarkCli) {
    for (const key of Object.keys(options)) invariant(['executable', 'identity', 'timeoutMs'].includes(key), 'BACKEND_OPTION', `Unknown lark-cli option: ${key}`);
    invariant(!options.identity || ['user', 'bot'].includes(options.identity), 'LARK_IDENTITY', 'identity must be user or bot.');
    invariant(options.executable === undefined || (typeof options.executable === 'string' && options.executable.length > 0), 'LARK_EXECUTABLE', 'executable must be a nonempty string.');
    invariant(options.timeoutMs === undefined || (Number.isInteger(options.timeoutMs) && options.timeoutMs >= 1000), 'LARK_TIMEOUT', 'timeoutMs must be an integer >= 1000.');
    this.options = { executable: 'lark-cli', identity: 'user', timeoutMs: 120000, ...options };
    this.runner = runner;
    this.scope = this.options.identity;
  }
  async call(args, input) {
    return this.runner(this.options.executable, [...args, '--as', this.options.identity], { input, timeoutMs: this.options.timeoutMs });
  }
  validateTarget(target) {
    invariant(!target.params || Object.keys(target.params).length === 0, 'LARK_TARGET_PARAMS', 'lark-cli v0.1 does not accept extra target.params.');
    if (target.operation === 'append') invariant(typeof target.documentId === 'string' && target.documentId.trim(), 'TARGET_DOCUMENT', 'Append requires target.documentId.');
    if (target.operation === 'create') invariant(!target.documentId, 'TARGET_CONFLICT', 'Create does not accept documentId.');
    if (target.operation === 'append') invariant(!target.parentToken, 'TARGET_CONFLICT', 'Append does not accept parentToken.');
  }
  async publish(plan) {
    const { target, artifact } = plan;
    const args = target.operation === 'create'
      ? ['docs', '+create', '--title', plan.document.title, ...(target.parentToken ? ['--parent-token', target.parentToken] : [])]
      : ['docs', '+update', '--command', 'append', '--doc', target.documentId];
    const result = await this.call([...args, '--doc-format', 'markdown', '--content', '-'], artifact.body);
    const doc = result.data?.document;
    invariant(typeof doc?.document_id === 'string' && doc.document_id, 'LARK_RECEIPT', 'The response has no document_id. The write may have completed; inspect Feishu before retrying.');
    const warnings = (result.data.warnings || []).map(w => ({ code: 'LARK_WARNING', message: typeof w === 'string' ? w : JSON.stringify(w) }));
    if (result.data.permission_grant && result.data.permission_grant.status !== 'granted') warnings.push({ code: 'PERMISSION_GRANT_INCOMPLETE', message: 'The document was created, but the CLI did not confirm granting user access.' });
    return {
      documentId: doc.document_id,
      ...(doc.url ? { url: doc.url } : {}),
      warnings,
    };
  }
  async verify(receipt, plan) {
    const result = await this.call(['docs', '+fetch', '--doc', receipt.documentId, '--doc-format', 'markdown', '--detail', 'simple']);
    const document = result.data?.document;
    invariant(document?.document_id === receipt.documentId && typeof document.content === 'string', 'READBACK_RESPONSE', 'Readback returned an unexpected document.');
    const actual = markdownReadbackText(document.content);
    const expected = markdownReadbackText(plan.artifact.body);
    return { passed: expected.length > 0 && actual.includes(expected), method: 'normalized-markdown-text', expectedCharacters: expected.length, visualVerified: false };
  }
}
