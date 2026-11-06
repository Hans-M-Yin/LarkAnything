import { execFile } from 'node:child_process';
import { invariant, LarkAnythingError } from '../core/errors.mjs';
import { verifyMarkdownReadback } from './readback.mjs';
import { larkMarkdown } from '../renderers/math.mjs';

export function runLarkCli(executable, args, { input, timeoutMs = 120000, configDir } = {}) {
  return runCli(executable, args, { input, timeoutMs, configDir }, false);
}

// Auth commands have their own JSON contract (no ok envelope). Keep the device
// code in the main process; callers must project the result before IPC/logging.
export function runLarkAuth(executable, args, { timeoutMs = 30000, configDir } = {}) {
  return runCli(executable, ['auth', ...args], { timeoutMs, configDir }, true);
}

export function larkCliEnv(configDir) {
  return configDir ? { ...process.env, LARKSUITE_CLI_CONFIG_DIR: configDir } : process.env;
}
function runCli(executable, args, { input, timeoutMs, configDir }, auth) {
  return new Promise((resolve, reject) => {
    const child = execFile(executable, args, { env: larkCliEnv(configDir), timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8', windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        const details = cliFailureDetails(error, stderr || stdout);
        reject(new LarkAnythingError('LARK_CLI_ERROR', error.code === 'ENOENT'
          ? 'lark-cli is not installed. Install @larksuite/cli and complete user authorization.'
          : auth ? details.appSecretMissing
            ? '当前 App 读取不到飞书应用密钥（client_secret），尚未发起用户授权。请先修复应用凭证，再连接飞书。'
            : `飞书授权失败，未上传文档。${[details.type, details.subtype, details.interrupted ? '请求超时' : '', details.exitCode !== undefined ? `退出码 ${details.exitCode}` : ''].filter(Boolean).join(' / ')}`
          : 'lark-cli failed or timed out. Check authorization/scopes with lark-cli. A write may have completed; it will not be retried automatically.', details));
        return;
      }
      try {
        const result = JSON.parse(stdout);
        invariant(auth ? result && typeof result === 'object' && !result.error && result.ok !== false : result.ok === true, 'LARK_RESPONSE', 'lark-cli did not report a successful response.', cliFailureDetails(null, stdout));
        resolve(result);
      } catch (error) { reject(error instanceof LarkAnythingError ? error : new LarkAnythingError('LARK_RESPONSE', 'lark-cli returned an unrecognized response. A write may have completed; inspect it before retrying.')); }
    });
    // No shell is involved; conversation text and arguments are never executable.
    child.stdin.on('error', () => {});
    child.stdin.end(input || '');
  });
}

// Persist only bounded machine codes, never raw CLI output: it can contain
// credentials, document contents, or private command arguments.
function cliFailureDetails(error, stdout) {
  let result; try { result = JSON.parse(stdout); } catch {}
  const code = result?.error?.code ?? result?.code;
  const typed = result?.error || {};
  return {
    ...(typeof error?.code === 'number' || /^[A-Z0-9_]+$/.test(error?.code || '') ? { exitCode: error.code } : {}),
    ...(error?.signal ? { signal: error.signal } : {}),
    ...(error?.killed ? { interrupted: true } : {}),
    ...(typeof code === 'number' || (typeof code === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(code)) ? { cliCode: code } : {}),
    ...Object.fromEntries(['type', 'subtype'].filter(key => typeof typed[key] === 'string' && /^[a-z_]{1,80}$/.test(typed[key])).map(key => [key, typed[key]])),
    ...(Array.isArray(typed.missing_scopes) ? { missingScopes: typed.missing_scopes.filter(s => typeof s === 'string' && /^[a-zA-Z0-9_:.-]{1,150}$/.test(s)).slice(0,50) } : {}),
    ...(typeof typed.message === 'string' && /missing a required parameter:\s*client_secret\b/i.test(typed.message) ? { appSecretMissing: true } : {}),
    ...(typed.subtype === 'token_missing' && typeof typed.message === 'string' ? { authReason: typed.message.slice(0, 500).replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').replace(/(access_token|refresh_token|client_secret)\s*[:=]\s*\S+/gi, '$1=[redacted]') } : {}),
  };
}

export function inspectLarkAuth(executable, configDir) {
  return new Promise(resolve => execFile(executable, ['auth', 'status'], { env: larkCliEnv(configDir), timeout: 15000, encoding: 'utf8', windowsHide: true }, (error, stdout, stderr) => {
    try {
      const s = JSON.parse(stdout);
      resolve({ appId: s.appId, brand: s.brand, credentialSource: s.credentialSource, identity: s.identity, botAvailable: s.identities?.bot?.available, userAvailable: s.identities?.user?.available, userStatus: s.identities?.user?.status, tokenStatus: s.identities?.user?.tokenStatus, exitCode: error?.code });
    } catch { resolve({ status: 'unavailable', ...cliFailureDetails(error, stderr || stdout) }); }
  }));
}

export class LarkCliBackend {
  id = 'lark-cli'; version = 1;
  capabilities = { formats: ['markdown'], operations: ['create', 'append', 'overwrite'], kinds: ['document'] };
  constructor(options = {}, runner = runLarkCli) {
    for (const key of Object.keys(options)) invariant(['executable', 'identity', 'timeoutMs', 'configDir'].includes(key), 'BACKEND_OPTION', `Unknown lark-cli option: ${key}`);
    invariant(options.configDir === undefined || (typeof options.configDir === 'string' && options.configDir.length > 0), 'LARK_CONFIG_DIR', 'configDir must be a nonempty string.');
    invariant(!options.identity || ['user', 'bot'].includes(options.identity), 'LARK_IDENTITY', 'identity must be user or bot.');
    invariant(options.executable === undefined || (typeof options.executable === 'string' && options.executable.length > 0), 'LARK_EXECUTABLE', 'executable must be a nonempty string.');
    invariant(options.timeoutMs === undefined || (Number.isInteger(options.timeoutMs) && options.timeoutMs >= 1000), 'LARK_TIMEOUT', 'timeoutMs must be an integer >= 1000.');
    this.options = { executable: 'lark-cli', identity: 'user', timeoutMs: 120000, ...options };
    this.runner = runner;
    this.scope = this.options.identity;
  }
  async call(args, input) {
    return this.runner(this.options.executable, [...args, '--as', this.options.identity], { input, timeoutMs: this.options.timeoutMs, ...(this.options.configDir ? { configDir: this.options.configDir } : {}) });
  }
  validateTarget(target) {
    invariant(!target.params || Object.keys(target.params).length === 0, 'LARK_TARGET_PARAMS', 'lark-cli v0.1 does not accept extra target.params.');
    if (['append', 'overwrite'].includes(target.operation)) invariant(typeof target.documentId === 'string' && target.documentId.trim(), 'TARGET_DOCUMENT', 'Append/overwrite requires target.documentId.');
    if (target.operation === 'create') invariant(!target.documentId, 'TARGET_CONFLICT', 'Create does not accept documentId.');
    if (['append', 'overwrite'].includes(target.operation)) invariant(!target.parentToken, 'TARGET_CONFLICT', 'Append/overwrite does not accept parentToken.');
  }
  async publish(plan) {
    const { target, artifact } = plan;
    const args = target.operation === 'create'
      ? ['docs', '+create', '--title', plan.document.title, ...(target.parentToken ? ['--parent-token', target.parentToken] : [])]
      : ['docs', '+update', '--command', target.operation, '--doc', target.documentId];
    const result = await this.call([...args, '--doc-format', 'markdown', '--content', '-'], larkMarkdown(artifact.body));
    // Update responses need not repeat the destination document object.
    // A successful update already identifies it through --doc.
    const doc = { ...result.data?.document, document_id: result.data?.document?.document_id
      || (target.operation !== 'create' ? result.data?.document_id || target.documentId : undefined) };
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
    return verifyMarkdownReadback(plan.artifact.body, document.content, {
      legacyMath: plan.artifact.warnings?.some(warning => warning.code === 'MATH_NOT_VERIFIED') === true,
    });
  }
}
