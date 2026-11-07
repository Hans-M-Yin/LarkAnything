import { spawn } from 'node:child_process';
import { larkCliEnv } from '../src/backends/lark-cli.mjs';

export function trustedLarkUrl(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && /(^|\.)(feishu\.cn|larksuite\.com)$/.test(u.hostname); } catch { return false; }
}

// config init is a long-running browser flow. Only its verification URL and
// bounded error codes leave this owner; stdout/stderr can contain credentials.
export class AppSetupProcess {
  constructor({ spawnProcess = spawn, timeoutMs = 600000 } = {}) { this.spawnProcess = spawnProcess; this.timeoutMs = timeoutMs; this.phase = 'idle'; }
  snapshot() { return { phase: this.phase, message: this.message || '', canOpen: this.phase === 'browser' && !!this.url }; }
  start({ executable, configDir, mode, appId, secret, brand, onComplete }) {
    if (this.child) throw new Error('应用配置正在进行，请先完成或取消。');
    if (!['create', 'existing'].includes(mode) || !['feishu', 'lark'].includes(brand)) throw new Error('应用配置选项无效。');
    if (mode === 'existing' && (!/^cli_[A-Za-z0-9]+$/.test(appId || '') || typeof secret !== 'string' || !secret.trim() || /[\r\n\0]/.test(secret) || secret.length > 4096)) throw new Error('请输入有效的 App ID 和 App Secret。');
    this.phase = 'starting'; this.url = undefined; this.message = '正在准备飞书应用配置…';
    const args = ['config', 'init', '--brand', brand, '--lang', 'zh', ...(mode === 'create' ? ['--new'] : ['--app-id', appId, '--app-secret-stdin'])];
    const child = this.spawnProcess(executable, args, { env: larkCliEnv(configDir), shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    let buffer = '', errorTail = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, this.timeoutMs); timer.unref?.();
    child.stdout.on('data', () => {});
    child.stderr.on('data', chunk => {
      errorTail = (errorTail + chunk.toString()).slice(-16384);
      buffer = (buffer + chunk.toString()).slice(-16384);
      const lines = buffer.split(/\r?\n/); buffer = lines.pop();
      for (const line of lines) {
        const candidate = line.trim();
        if (trustedLarkUrl(candidate) && this.phase === 'starting') {
          this.url = candidate; this.phase = 'browser'; this.message = '在浏览器完成飞书应用创建，此窗口会自动接收结果。';
        }
      }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(mode === 'existing' ? secret.trim() + '\n' : '');
    const fail = message => { this.phase = 'failed'; this.message = message; this.url = undefined; };
    child.on('error', error => { clearTimeout(timer); this.child = undefined; fail(error.code === 'ENOENT' ? '找不到飞书 CLI，请在高级设置中选择已安装的 CLI。' : '无法启动飞书配置，请稍后重试。'); });
    child.on('close', async code => {
      clearTimeout(timer); this.child = undefined; this.url = undefined;
      if (this.phase === 'cancelled' || this.phase === 'failed') return;
      if (code !== 0) {
        let category = ''; try { const e = JSON.parse(errorTail).error; category = [e?.type, e?.subtype].filter(v => /^[a-z_]{1,80}$/.test(v || '')).join(' / '); } catch {}
        fail(timedOut ? '配置等待超时。请检查浏览器中的完成情况，再重新检测。' : `飞书应用配置未完成${category ? `（${category}）` : ''}。请确认应用凭证、网络及租户权限后重试。`);
        return;
      }
      this.phase = 'saving'; this.message = '正在验证应用配置…';
      try { await onComplete(); this.phase = 'complete'; this.message = '飞书应用已配置，接下来授权你的账号。'; }
      catch { fail('应用配置未通过检查，现有连接未被替换。请重新检测。'); }
    });
    return this.snapshot();
  }
  cancel() {
    if (this.phase === 'saving') throw new Error('正在保存配置，请稍候。');
    if (this.child) { this.phase = 'cancelled'; this.message = '已停止等待；若浏览器已创建应用，可选择“使用已有应用”继续。'; this.url = undefined; this.child.kill(); }
    return this.snapshot();
  }
}
