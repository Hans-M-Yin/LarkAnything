import { native } from './runtime.mjs';
class Events {
  listeners = new Map();
  on(name, fn) { const list = this.listeners.get(name) || []; list.push(fn); this.listeners.set(name, list); return this; }
  emit(name, ...args) { for (const fn of this.listeners.get(name) || []) fn(...args); }
}
function launch(executable, args, options, callback) {
  const child = new Events(); child.stdout = new Events(); child.stderr = new Events(); child.stdin = new Events();
  let input = '', handle, killed = false;
  child.stdin.end = data => { input = data || ''; };
  child.kill = () => { killed = true; if (handle) native('process_kill', { handle }).catch(() => {}); };
  queueMicrotask(async () => {
    let stdout = '', stderr = '';
    try {
      handle = await native('process_start', { executable, args, input, configDir: options.env?.LARKSUITE_CLI_CONFIG_DIR || null, timeout: options.timeout || 600000, limit: options.maxBuffer || 32 * 1024 * 1024 });
      if (killed) await native('process_kill', { handle });
      for (;;) {
        const state = await native('process_poll', { handle });
        if (state.stdout) { stdout += state.stdout; child.stdout.emit('data', state.stdout); }
        if (state.stderr) { stderr += state.stderr; child.stderr.emit('data', state.stderr); }
        if (state.done) {
          const error = state.code === 0 && !state.killed ? null : Object.assign(new Error('CLI failed'), { code: state.code, killed: state.killed, ...(state.killed ? { signal: 'SIGTERM' } : {}) });
          callback?.(error, stdout, stderr); child.emit('close', state.code); break;
        }
        await new Promise(resolve => setTimeout(resolve, 60));
      }
    } catch (error) { if (callback) callback(error, stdout, stderr); else child.emit('error', error); }
  });
  return child;
}
export const execFile = (executable, args, options, callback) => launch(executable, args, options, callback);
export const spawn = (executable, args, options) => launch(executable, args, options);
