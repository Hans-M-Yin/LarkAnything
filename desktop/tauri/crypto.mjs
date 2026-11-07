import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
export const randomUUID = () => crypto.randomUUID();
export function createHash(algorithm) {
  if (algorithm !== 'sha256') throw new Error('Unsupported hash');
  const hash = sha256.create();
  return { update(value) { hash.update(typeof value === 'string' ? new TextEncoder().encode(value) : value); return this; }, digest(encoding) { if (encoding !== 'hex') throw new Error('Unsupported digest'); return bytesToHex(hash.digest()); } };
}
