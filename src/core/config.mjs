import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { invariant } from './errors.mjs';

export const DEFAULTS = {
  protocol: 'transcript', renderer: 'markdown',
  format: { locale: 'zh-CN', includeTools: false, includeTimestamps: true, includeModels: true, mergeConsecutiveAssistant: true, timeZone: 'UTC', showMetadata: true, separators: true, unsupported: 'warn' },
  target: { backend: 'lark-cli', operation: 'sync' },
};

const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function mergeConfig(...values) {
  const result = {};
  for (const value of values) {
    for (const [key, item] of Object.entries(value || {})) {
      invariant(!['__proto__', 'constructor', 'prototype'].includes(key), 'CONFIG_KEY', 'Unsafe configuration key.');
      result[key] = plainObject(item) ? mergeConfig(plainObject(result[key]) ? result[key] : {}, item) : item;
    }
  }
  return result;
}

function known(value, keys, label) {
  invariant(plainObject(value), 'CONFIG_OBJECT', `${label} must be an object.`);
  for (const key of Object.keys(value)) invariant(keys.includes(key), 'UNKNOWN_OPTION', `Unknown ${label} option: ${key}`);
}

export async function loadConfig(file) {
  if (!file) return { version: 1, stateDir: resolve('.larkanything/state') };
  const absolute = resolve(file);
  const config = JSON.parse(await readFile(absolute, 'utf8'));
  known(config, ['version', 'defaults', 'channels', 'profiles', 'backends', 'stateDir'], 'configuration');
  invariant(config.version === 1, 'CONFIG_VERSION', 'Configuration version must be 1.');
  return { ...config, stateDir: resolve(dirname(absolute), config.stateDir || '.larkanything/state') };
}

export function resolveOptions(config = {}, channel, profile, overrides = {}) {
  if (profile) invariant(config.profiles?.[profile], 'PROFILE_NOT_FOUND', `Unknown profile: ${profile}`);
  const options = mergeConfig(DEFAULTS, config.defaults, config.channels?.[channel], profile ? config.profiles[profile] : {}, overrides);
  known(options, ['protocol', 'renderer', 'format', 'target'], 'export');
  invariant(typeof options.protocol === 'string' && typeof options.renderer === 'string', 'CONFIG_REGISTRY_ID', 'Protocol and renderer must be registry ids.');
  known(options.target, ['backend', 'operation', 'parentToken', 'documentId', 'namespace', 'params'], 'target');
  invariant(typeof options.target.backend === 'string', 'BACKEND_ID', 'Target backend must be a registry id.');
  invariant(typeof options.target.operation === 'string' && options.target.operation.length > 0, 'OPERATION', 'Target operation must be a nonempty string.');
  if (options.target.params !== undefined) invariant(plainObject(options.target.params), 'TARGET_PARAMS', 'target.params must be an object.');
  for (const key of ['documentId', 'parentToken', 'namespace']) if (options.target[key] !== undefined) invariant(typeof options.target[key] === 'string' && options.target[key].length > 0, 'TARGET_VALUE', `target.${key} must be a nonempty string.`);
  // Protocol-specific format fields are validated by the protocol, never here.
  return options;
}
