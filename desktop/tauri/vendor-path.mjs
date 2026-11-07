// Run only when deliberately updating the pinned Node path implementation.
// Vendored path preserves existing Windows source identities and receipt hashes.
import { writeFile } from 'node:fs/promises';
let source = process.binding('natives').path;
source = source.replace("'use strict';", `import { process } from './runtime.mjs';
const uncurry = fn => Function.prototype.call.bind(fn);
const primordials = Object.fromEntries([
  ...['join', 'slice'].map(k => ['ArrayPrototype' + k[0].toUpperCase() + k.slice(1), uncurry(Array.prototype[k])]),
  ...['charCodeAt','includes','indexOf','lastIndexOf','repeat','replace','slice','split','toLowerCase'].map(k => ['StringPrototype' + k[0].toUpperCase() + k.slice(1), uncurry(String.prototype[k])]),
  ['FunctionPrototypeBind', uncurry(Function.prototype.bind)]
]);`);
source = source.replace(/const \{\s+CHAR_UPPERCASE_A,[\s\S]*?const lazyMinimatch = .*?;/, `const CHAR_UPPERCASE_A=65, CHAR_LOWERCASE_A=97, CHAR_UPPERCASE_Z=90, CHAR_LOWERCASE_Z=122,
CHAR_DOT=46, CHAR_FORWARD_SLASH=47, CHAR_BACKWARD_SLASH=92, CHAR_COLON=58, CHAR_QUESTION_MARK=63;
const validateString=(value,name)=>{if(typeof value!=='string')throw new TypeError(name+' must be a string');};
const validateObject=(value,name)=>{if(!value || typeof value!=='object')throw new TypeError(name+' must be an object');};
const isWindows=process.platform==='win32', isMacOS=process.platform==='darwin';
const lazyMinimatch=()=>{throw new Error('Glob is not used by LarkAnything');};`);
source = source.replace(/module\.exports = isWindows \? win32 : posix;/, `const selected = isWindows ? win32 : posix;
export const { resolve, join, basename, dirname, normalize, isAbsolute, relative, extname, sep, delimiter, parse, format } = selected;
export { win32, posix };
export default selected;`);
if (/require\(|module\.exports/.test(source)) throw new Error('Unexpected Node path implementation; review before vendoring');
await writeFile(new URL('./path.mjs', import.meta.url), source);
