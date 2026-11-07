import { createInterface } from 'node:readline';
import { DesktopService } from '../desktop/service.mjs';

// Private stdio protocol. No listener, shell execution, or arbitrary method dispatch.
const rootIndex = process.argv.indexOf('--root');
const service = new DesktopService(rootIndex >= 0 ? { root: process.argv[rootIndex + 1] } : {});
const methods = {
  settings: () => service.settings(),
  list: ({ channel }) => service.list(channel),
  preview: ({ id }) => service.preview(id),
  publish: ({ token }) => service.publish(token),
  saveSettings: ({ settings }) => service.saveSettings(settings),
};
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
let queue = Promise.resolve();
function send(value) { process.stdout.write(JSON.stringify(value) + '\n'); }
async function dispatch(line) {
  let request;
  try {
    if (Buffer.byteLength(line) > 1024 * 1024) throw new Error('Request too large');
    request = JSON.parse(line);
    if (!Number.isSafeInteger(request.id) || request.version !== 1) throw new Error('Invalid protocol request');
    if (!Object.hasOwn(methods, request.method)) throw new Error('Unknown method');
    const value = await methods[request.method](request.params || {});
    send({ version: 1, id: request.id, ok: true, value });
  } catch (error) {
    send({ version: 1, id: Number.isSafeInteger(request?.id) ? request.id : null, ok: false,
      error: { code: error.code || 'BRIDGE_ERROR', message: error.message, details: error.details || {} } });
  }
}
lines.on('line', line => { queue = queue.then(() => dispatch(line)); });
lines.on('close', () => { queue.then(() => { process.exitCode = 0; }); });
