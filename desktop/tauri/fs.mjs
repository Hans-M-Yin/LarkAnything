import { native } from './runtime.mjs';
export const readFile = (path) => native('read', { path });
export const writeFile = (path, data, options = {}) => native('write', { path, data, exclusive: options.flag === 'wx' });
export const mkdir = (path, options = {}) => native('mkdir', { path, recursive: !!options.recursive });
export const rename = (path, to) => native('rename', { path, to });
export const rm = (path, options = {}) => native('remove', { path, force: !!options.force });
export const stat = path => native('stat', { path });
export async function readdir(path, options = {}) {
  const entries = await native('readdir', { path });
  return options.withFileTypes ? entries.map(e => ({ name: e.name, isFile: () => e.file, isDirectory: () => e.directory })) : entries.map(e => e.name);
}
export async function open(path, flags) {
  if (flags !== 'wx') throw new Error('Unsupported file mode');
  const handle = await native('lock_open', { path });
  return { writeFile: data => native('lock_write', { handle, data }), close: () => native('lock_close', { handle }) };
}
// Discovery needs only the first nonempty JSONL record; do not load whole archives.
export const createReadStream = path => ({ path, destroy() {} });
export const createInterface = ({ input }) => ({ close() {}, async *[Symbol.asyncIterator]() { const line = await native('header', { path: input.path }); if (line !== null) yield line; } });
