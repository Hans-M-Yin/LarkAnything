import { readFile, writeFile, mkdir, rename, readdir, stat } from 'node:fs/promises';
import { join, basename, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createLarkAnything, discoverSessions, loadConfig, resolveOptions, markdownRenderer } from '../src/index.mjs';
import { markdownFileAdapter, markdownFileProtocol } from '../src/adapters/markdown-file.mjs';
import { inspectLarkAuth, runLarkAuth } from '../src/backends/lark-cli.mjs';
import { AppSetupProcess } from './setup.mjs';
import { snapshotAdapters } from '../src/adapters/desktop-sources.mjs';

const json = async (path, fallback) => { try { return JSON.parse(await readFile(path, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; } };
const atomic = async (path, value) => { await mkdir(dirname(path), { recursive: true }); const temp = `${path}.${randomUUID()}.tmp`; await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); await rename(temp, path); };
export class DesktopService {
  constructor({ root = join(homedir(), '.larkanything'), engineFactory = createLarkAnything, authRunner = runLarkAuth, authInspector = inspectLarkAuth, bundledExecutable, setupProcess = new AppSetupProcess() } = {}) {
    this.root = root; this.engineFactory = engineFactory; this.items = new Map(); this.plans = new Map();
    this.authRunner = authRunner;
    this.authInspector = authInspector; this.bundledExecutable = bundledExecutable; this.setupProcess = setupProcess;
  }
  async settings() {
    const config = await json(join(this.root, 'config.json'), { version: 1 });
    const desktop = await json(join(this.root, 'desktop.json'), {});
    return { parentToken: config.defaults?.target?.parentToken || '', includeTools: config.defaults?.format?.includeTools || false,
      executable: config.backends?.['lark-cli']?.executable || 'lark-cli', ...desktop };
  }
  async saveSettings(value) {
    if (this.authStarting || this.authFinishing || this.appSetupStarting || this.setupBusy()) throw new Error('正在连接飞书，请完成后再保存设置。');
    for (const key of ['parentToken', 'executable', 'vault', 'codexHome', 'claudeHome', 'opencodeExecutable']) if (value[key] !== undefined && typeof value[key] !== 'string') throw new Error('配置字段必须为文本。');
    if (typeof value.includeTools !== 'boolean') throw new Error('工具日志设置无效。');
    let parentToken = value.parentToken.trim();
    if (parentToken.startsWith('https://')) {
      const url = new URL(parentToken);
      if (!/(^|\.)(feishu\.cn|larksuite\.com)$/.test(url.hostname)) throw new Error('请输入飞书或 Lark 文件夹链接。');
      const match = url.pathname.match(/\/(?:folder|wiki)\/([\w-]+)/);
      if (!match) throw new Error('无法识别文件夹或知识库链接。');
      parentToken = match[1];
    }
    if (parentToken && !/^[\w-]+$/.test(parentToken)) throw new Error('保存位置 Token 无效。');
    const path = join(this.root, 'config.json');
    const config = await json(path, { version: 1, stateDir: 'state' });
    config.defaults ||= {}; config.defaults.target ||= {}; config.defaults.format ||= {};
    if (parentToken) config.defaults.target.parentToken = parentToken; else delete config.defaults.target.parentToken;
    config.defaults.format.includeTools = value.includeTools;
    config.defaults.format.timeZone ||= Intl.DateTimeFormat().resolvedOptions().timeZone;
    config.backends ||= {}; config.backends['lark-cli'] = { ...config.backends['lark-cli'], executable: value.executable.trim() || 'lark-cli' };
    resolveOptions(config, 'codex');
    await this.markDesktopInstallation();
    await atomic(path, config);
    await atomic(join(this.root, 'desktop.json'), Object.fromEntries(['vault', 'codexHome', 'claudeHome', 'opencodeExecutable'].map(k => [k, value[k] || ''])));
    this.items.clear(); this.plans.clear();
    this.pendingAuth = undefined;
    return this.settings();
  }
  async engine() {
    const path = join(this.root, 'config.json');
    const exists = await json(path, null);
    const config = exists ? await loadConfig(path) : { version: 1, stateDir: join(this.root, 'state') };
    if (this.bundledExecutable && (!config.backends?.['lark-cli']?.executable || config.backends['lark-cli'].executable === 'lark-cli')) {
      config.backends = { ...config.backends, 'lark-cli': { ...config.backends?.['lark-cli'], executable: this.bundledExecutable } };
    }
    return this.engineFactory({ config, adapters: [markdownFileAdapter, ...snapshotAdapters], protocols: [markdownFileProtocol] });
  }
  setupBusy() { return ['starting', 'browser', 'saving'].includes(this.setupProcess.phase); }
  markDesktopInstallation() { return atomic(join(this.root, '.larkanything-desktop.json'), { managedBy: 'larkanything', prefix: resolve(this.root) }); }
  async setupStatus() {
    const engine = await this.engine(), options = engine.backends.get('lark-cli').options;
    const auth = await this.authInspector(options.executable, options.configDir);
    const base = { appId: auth.appId || '', brand: auth.brand || 'feishu', bundled: !!this.bundledExecutable };
    if (auth.exitCode === 'ENOENT') return { ...base, stage: 'cli', message: '未找到飞书 CLI，请在高级设置中选择已安装的 CLI。轻量版不捆绑飞书 CLI。' };
    if (auth.userAvailable) return { ...base, stage: 'ready', message: '当前 App 已读取到登录凭证，可检查连接或开始整理内容。' };
    if (auth.botAvailable) return { ...base, stage: 'login', message: '飞书应用已就绪，请授权你的账号。' };
    if (auth.status === 'unavailable' && auth.type !== 'config') return { ...base, stage: 'error', message: `暂时无法检查连接${auth.subtype ? `（${auth.subtype}）` : ''}，请检查 CLI 和系统凭证存储后重试。` };
    return { ...base, stage: 'app', message: auth.appId ? '已有飞书应用配置，但此 App 读取不到应用凭证。请填写同一应用的密钥以重新配置。' : '先创建或连接一个飞书应用，再授权你的账号。' };
  }
  async useBundledCli() {
    if (!this.bundledExecutable) throw new Error('此构建没有内置 CLI，请使用完整安装包。');
    if (this.setupBusy() || this.appSetupStarting || this.authStarting || this.authFinishing) throw new Error('请先完成当前连接步骤。');
    const path = join(this.root, 'config.json'), config = await json(path, { version: 1, stateDir: 'state' });
    config.backends ||= {}; config.backends['lark-cli'] = { ...config.backends['lark-cli'], executable: 'lark-cli' };
    await this.markDesktopInstallation();
    await atomic(path, config); this.pendingAuth = undefined; this.plans.clear();
    return this.setupStatus();
  }
  async startAppSetup(value) {
    if (this.appSetupStarting || this.setupBusy() || this.authStarting || this.authFinishing) throw new Error('连接步骤正在进行，请稍候。');
    this.appSetupStarting = true;
    try {
      if (!value || !['create', 'existing'].includes(value.mode) || !['feishu', 'lark'].includes(value.brand)) throw new Error('配置选项无效。');
      const current = await this.setupStatus();
      if (current.stage === 'ready' || current.stage === 'login') throw new Error('已有可用飞书应用，请直接授权或检查连接。');
      if (current.appId && (value.mode !== 'existing' || value.appId !== current.appId)) throw new Error('请修复当前应用的凭证，避免改变已有文档的账号归属。');
      const engine = await this.engine(), executable = engine.backends.get('lark-cli').options.executable;
      // Stage a separate CLI profile. Never replace unrelated CLI profiles, or
      // activate a half-finished setup. The CLI alone owns secret storage.
      const configDir = join(this.root, 'connections', randomUUID());
      await this.markDesktopInstallation();
      await mkdir(configDir, { recursive: true, mode: 0o700 });
      this.pendingAuth = undefined;
      return this.setupProcess.start({ ...value, executable, configDir, onComplete: async () => {
        const auth = await this.authInspector(executable, configDir);
        if (!auth.appId || !auth.botAvailable) throw new Error('Application credential unavailable');
        const path = join(this.root, 'config.json'), config = await json(path, { version: 1, stateDir: 'state' });
        config.backends ||= {}; config.backends['lark-cli'] = { ...config.backends['lark-cli'], configDir, identity: 'user' };
        await atomic(path, config);
        this.plans.clear();
      } });
    } finally { this.appSetupStarting = false; }
  }
  async list(channel) {
    if (['opencode','notion','markdown','docx'].includes(channel)) {
      if (!this.sources) throw new Error('这些来源需要使用 Tauri 桌面版。');
      const records = await this.sources.list(channel);
      for (const item of records) this.items.set(item.id, {channel, sourceItem:item});
      return records;
    }
    if (!['codex', 'claude-code', 'obsidian'].includes(channel)) throw new Error('未知来源。');
    const settings = await this.settings();
    let entries;
    if (channel === 'obsidian') {
      entries = [];
      const walk = async path => { for (const e of await readdir(path, { withFileTypes: true })) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        const input = join(path, e.name);
        if (e.isDirectory()) await walk(input);
        else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) entries.push({ input });
      } };
      if (settings.vault) await walk(resolve(settings.vault));
    } else entries = await discoverSessions(channel, { ...(settings.codexHome ? { codexHome: settings.codexHome } : {}), ...(settings.claudeHome ? { claudeHome: settings.claudeHome } : {}) });
    const engine = await this.engine();
    const records = [];
    // Cache metadata by file size and mtime. Read content only on first discovery or change.
    const cachePath = join(this.root, `index-${channel}.json`);
    const cache = await json(cachePath, {}), next = {};
    for (const entry of entries) {
      const paths = entry.inputs || [entry.input];
      try {
        const stats = await Promise.all(paths.map(p => stat(p)));
        const signature = JSON.stringify(stats.map((s, i) => [paths[i], s.size, s.mtimeMs]));
        const id = `${channel}:${entry.session || entry.input}`;
        let metadata = cache[id]?.signature === signature ? cache[id].metadata : null;
        const request = { channel, input: entry.input, ...(channel === 'codex' && entry.session ? { input: undefined, session: entry.session } : {}), sourceOptions: { codexHome: settings.codexHome || undefined, claudeHome: settings.claudeHome || undefined } };
        if (!metadata) {
          const model = await engine.adapters.get(channel).load({ ...request, input: entry.input, session: undefined });
          const excerpt = model.body || model.messages?.find(m => m.role === 'user')?.content.find(p => p.type === 'text')?.text || '';
          metadata = { title: model.title, excerpt: excerpt.replace(/\s+/g, ' ').slice(0, 140), location: dirname(entry.input), count: model.messages?.length,
            modified: Math.max(...stats.map(s => s.mtimeMs)) };
        }
        next[id] = { signature, metadata }; this.items.set(id, request); records.push({ id, ...metadata });
      } catch (e) { records.push({ id: `${channel}:${entry.input}`, title: basename(entry.input), error: e.message, modified: 0 }); }
    }
    await atomic(cachePath, next);
    return records.sort((a, b) => b.modified - a.modified);
  }
  async preview(id) {
    const request = this.items.get(id); if (!request) throw new Error('请刷新列表后重新选择。');
    if (request.sourceItem) request.sourceOptions = {snapshot:await this.sources.load(request.channel, request.sourceItem)};
    const engine = await this.engine();
    const overrides = ['obsidian','markdown','docx','notion'].includes(request.channel) ? { protocol: 'markdown-file', target: { operation: 'create' } } : { target: { operation: 'sync' } };
    let plan;
    try { plan = await engine.plan({ ...request, overrides }); }
    catch (error) {
      // After restart, recover the exact frozen plan for a known pending export.
      // Core decides whether retry means readback only or an uncertain-write stop.
      if (!['SYNC_PENDING', 'WRITE_UNCERTAIN'].includes(error.code) || !error.details?.exportKey) throw error;
      const folders = await readdir(join(this.root, 'desktop-previews'), { withFileTypes: true }).catch(() => []);
      for (const folder of folders) {
        if (!folder.isDirectory()) continue;
        const saved = await json(join(this.root, 'desktop-previews', folder.name, 'plan.json'), null);
        if (saved?.exportKey === error.details.exportKey) { plan = saved; break; }
      }
      if (!plan) throw error;
    }
    const token = randomUUID();
    this.plans.clear(); this.plans.set(token, { engine, plan });
    await engine.preview(plan, join(this.root, 'desktop-previews', plan.fingerprint));
    const html = markdownRenderer.preview(plan.document.title, plan.artifact).replace('</style>', 'body{margin:20px auto;padding:0 20px;background:#fdfefa}header{margin-bottom:18px}header small{font-size:10px;color:#87917e}header h1{font-size:21px}article{padding:24px;border-radius:10px;border-color:#e3e8dd}article>h1{font-size:21px}pre{background:#f4f6f0} :root{color:#26382f}</style>');
    return { token, title: plan.document.title, html,
      operation: plan.sync?.unchanged ? 'unchanged' : plan.target.operation, target: plan.target.parentToken || '默认位置', warnings: plan.artifact.warnings };
  }
  async publish(token) {
    const value = this.plans.get(token); if (!value) throw new Error('预览已过期，请重新选择内容。');
    // Preflight runs before Core records a write attempt. Never replay a pending
    // write here; existing receipts still go through Core's normal safeguards.
    if (value.plan.target.backend === 'lark-cli' && !(await value.engine.store.get(value.plan.exportKey))) {
      const check = await this.checkConnection(value);
      if (!check.ok) throw Object.assign(new Error(`上传前检查失败，尚未提交文档。${check.message}`), { code: 'CONNECTION_CHECK_FAILED' });
    }
    try { return await value.engine.publish(value.plan); }
    catch (error) {
      if (error.code === 'WRITE_UNCERTAIN') {
        const d = error.details?.diagnostic;
        const reason = d?.exitCode === 'ENOENT' ? '找不到飞书 CLI，请检查设置中的可执行文件路径。'
          : d?.interrupted ? '飞书 CLI 超时或被中断。'
          : d?.missingScopes?.length ? `飞书授权缺少权限：${d.missingScopes.join('、')}。`
          : d?.type === 'authentication' ? `飞书登录凭证不可用（${d.subtype || 'authentication'}），请重新授权。`
          : d?.type === 'authorization' ? `飞书拒绝访问（${d.subtype || 'authorization'}${d.cliCode !== undefined ? `，错误码 ${d.cliCode}` : ''}），请检查账号及应用权限。`
          : d?.type === 'config' ? `飞书 CLI 配置异常（${d.subtype || 'config'}）。`
          : d?.cliCode !== undefined ? `飞书 CLI 错误码：${d.cliCode}。`
          : d?.exitCode === 3 ? '飞书 CLI 报告登录、权限或配置错误；旧回执缺少具体分类，不能据此认定需要重新登录。'
          : d?.exitCode !== undefined ? `飞书 CLI 退出码：${d.exitCode}。`
          : '旧回执未记录具体退出原因。';
        error.message = `上传结果尚未确认，已暂停重传以避免重复文档。${reason}请检查飞书最近文档；若已创建，请保留文档链接用于回读核验。不要删除本地回执。`;
      }
      throw error;
    }
  }

  beginConnection() {
    if (this.setupBusy() || this.appSetupStarting) throw new Error('请先完成飞书应用配置。');
    if (this.authStarting) return this.authStarting;
    if (this.authFinishing) throw new Error('正在完成授权，请稍候。');
    this.authStarting = this.startConnection().finally(() => { this.authStarting = undefined; });
    return this.authStarting;
  }
  async startConnection() {
    if (this.pendingAuth?.expiresAt > Date.now()) return { url: this.pendingAuth.url };
    this.pendingAuth = undefined;
    const check = await this.checkConnection();
    if (check.ok) return { connected: true, message: check.message };
    if (check.diagnostic?.type !== 'authentication') throw new Error(check.message);
    const engine = await this.engine();
    const { executable, configDir } = engine.backends.get('lark-cli').options;
    let result;
    try { result = await this.authRunner(executable, ['login', '--domain', 'docs,drive', '--no-wait', '--json'], { configDir }); }
    catch (error) {
      await atomic(join(this.root, 'desktop-diagnostics.json'), { ok: false, phase: 'authorization-start', checkedAt: new Date().toISOString(), diagnostic: error.details || {} });
      throw error;
    }
    let url; try { url = new URL(result.verification_url); } catch {}
    if (!url || url.protocol !== 'https:' || url.username || url.password || !/(^|\.)(feishu\.cn|larksuite\.com)$/.test(url.hostname)
      || typeof result.device_code !== 'string' || !result.device_code || !Number.isFinite(result.expires_in) || result.expires_in <= 0) {
      throw new Error('飞书 CLI 返回了无效的授权信息，请检查 CLI 版本。');
    }
    // Never persist device codes or expose them to the renderer.
    this.pendingAuth = { executable, configDir, url: result.verification_url, deviceCode: result.device_code, expiresAt: Date.now() + Math.min(result.expires_in, 900) * 1000 };
    return { url: this.pendingAuth.url };
  }
  finishConnection() {
    if (this.authFinishing) return this.authFinishing;
    const pending = this.pendingAuth;
    if (!pending || pending.expiresAt <= Date.now()) {
      this.pendingAuth = undefined;
      throw new Error('授权链接已过期，请重新点击“连接飞书”。');
    }
    this.authFinishing = (async () => {
      try {
        const result = await this.authRunner(pending.executable, ['login', '--device-code', pending.deviceCode, '--json'], { configDir: pending.configDir, timeoutMs: Math.max(1000, pending.expiresAt - Date.now()) });
        if (result.event !== 'authorization_complete') throw new Error('Unexpected authorization response');
        this.pendingAuth = undefined;
        // A successful OAuth response alone is insufficient; verify from this
        // same desktop process using a real authenticated read.
        return await this.checkConnection();
      } catch (error) {
        this.pendingAuth = undefined;
        throw new Error(`飞书授权未完成，请重新连接。${[error.details?.type, error.details?.subtype].filter(Boolean).join(' / ')}`);
      }
    })().finally(() => { this.authFinishing = undefined; });
    return this.authFinishing;
  }
  async checkConnection(value) {
    const engine = value?.engine || await this.engine();
    const backend = engine.backends.get('lark-cli');
    const checks = [];
    try {
      const target = value?.plan.target;
      // This endpoint forces a real authenticated read, unlike auth status.
      await backend.call(['docs', '+search', '--query', 'LarkAnything', '--page-size', '1']);
      checks.push('authenticated-read');
      await backend.call(['docs', '+create', '--title', 'LarkAnything connection check', '--doc-format', 'markdown', '--content', '-', '--dry-run', ...(target?.parentToken ? ['--parent-token', target.parentToken] : [])], 'Connection check only.');
      checks.push('create-dry-run');
      const result = { ok: true, checkedAt: new Date().toISOString(), checks, message: '账号读取和创建预检通过。未上传测试文档；实际写入权限仍以发布结果为准。' };
      await atomic(join(this.root, 'desktop-diagnostics.json'), result);
      return result;
    } catch (error) {
      const d = error.details || {};
      const message = d.missingScopes?.length ? `缺少权限：${d.missingScopes.join('、')}`
        : d.subtype === 'token_missing' ? '此 App 尚未读取到飞书登录凭证。请在设置中点击“连接飞书”，完成浏览器授权后返回 App 确认。此次未上传文档。'
        : `飞书 CLI：${[d.type, d.subtype, d.cliCode !== undefined ? `API ${d.cliCode}` : '', d.exitCode !== undefined ? `退出码 ${d.exitCode}` : '', error.code].filter(Boolean).join(' / ')}`;
      const auth = d.subtype === 'token_missing' ? await this.authInspector(backend.options.executable, backend.options.configDir) : undefined;
      const result = { ok: false, checkedAt: new Date().toISOString(), checks, message, diagnostic: d, ...(auth ? { auth } : {}) };
      await atomic(join(this.root, 'desktop-diagnostics.json'), result);
      return result;
    }
  }
}
