import { readFile, writeFile, mkdir, rename, readdir, stat } from 'node:fs/promises';
import { join, basename, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createLarkAnything, discoverSessions, loadConfig, resolveOptions, markdownRenderer } from '../src/index.mjs';
import { markdownFileAdapter, markdownFileProtocol } from '../src/adapters/markdown-file.mjs';

const json = async (path, fallback) => { try { return JSON.parse(await readFile(path, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; } };
const atomic = async (path, value) => { await mkdir(dirname(path), { recursive: true }); const temp = `${path}.${randomUUID()}.tmp`; await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); await rename(temp, path); };
export class DesktopService {
  constructor({ root = join(homedir(), '.larkanything'), engineFactory = createLarkAnything } = {}) {
    this.root = root; this.engineFactory = engineFactory; this.items = new Map(); this.plans = new Map();
  }
  async settings() {
    const config = await json(join(this.root, 'config.json'), { version: 1 });
    const desktop = await json(join(this.root, 'desktop.json'), {});
    return { parentToken: config.defaults?.target?.parentToken || '', includeTools: config.defaults?.format?.includeTools || false,
      executable: config.backends?.['lark-cli']?.executable || 'lark-cli', ...desktop };
  }
  async saveSettings(value) {
    for (const key of ['parentToken', 'executable', 'vault', 'codexHome', 'claudeHome']) if (value[key] !== undefined && typeof value[key] !== 'string') throw new Error('配置字段必须为文本。');
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
    await atomic(path, config);
    await atomic(join(this.root, 'desktop.json'), Object.fromEntries(['vault', 'codexHome', 'claudeHome'].map(k => [k, value[k] || ''])));
    this.items.clear(); this.plans.clear();
    return this.settings();
  }
  async engine() {
    const path = join(this.root, 'config.json');
    const exists = await json(path, null);
    const config = exists ? await loadConfig(path) : { version: 1, stateDir: join(this.root, 'state') };
    return this.engineFactory({ config, adapters: [markdownFileAdapter], protocols: [markdownFileProtocol] });
  }
  async list(channel) {
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
    const engine = await this.engine();
    const overrides = request.channel === 'obsidian' ? { protocol: 'markdown-file', target: { operation: 'create' } } : { target: { operation: 'sync' } };
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
    return value.engine.publish(value.plan);
  }
}
