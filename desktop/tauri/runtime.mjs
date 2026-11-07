// Native operations are brokered by the owning main frame, never by previews.
let sequence = 0;
const pending = new Map();
export const context = {};
export function native(op, args = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence; pending.set(id, { resolve, reject });
    postMessage({ native: true, id, op, args });
  });
}
export function reply(message) {
  const task = pending.get(message.id); if (!task) return;
  pending.delete(message.id);
  if (message.error) task.reject(Object.assign(new Error(message.error.message || String(message.error)), message.error));
  else task.resolve(message.value);
}
export const process = { env: {}, pid: 0, platform: '', cwd: () => context.cwd };
export function initialize(value) { Object.assign(context, value); Object.assign(process, { env: value.env, pid: value.pid, platform: value.platform }); }
