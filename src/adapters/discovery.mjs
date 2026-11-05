import { readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { invariant } from '../core/errors.mjs';

async function walk(root) {
  const files = [];
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return files; throw error; }
  for (const entry of entries) {
    if (entry.isDirectory()) files.push(...await walk(join(root, entry.name)));
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(join(root, entry.name));
  }
  return files;
}

export async function discoverSessions(channel, { codexHome = process.env.CODEX_HOME || join(homedir(), '.codex'), claudeHome = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude') } = {}) {
  invariant(['codex', 'claude-code'].includes(channel), 'DISCOVERY_CHANNEL', 'Local session discovery supports codex and claude-code.');
  const roots = channel === 'codex' ? [join(codexHome, 'sessions'), join(codexHome, 'archived_sessions')] : [join(claudeHome, 'projects')];
  const files = (await Promise.all(roots.map(walk))).flat();
  return files.filter(path => !path.split(/[\\/]/).includes('subagents')).sort().map(path => ({ channel, input: path, filename: basename(path) }));
}

export async function resolveSession(channel, id, options) {
  invariant(typeof id === 'string' && /^[a-zA-Z0-9-]+$/.test(id), 'SESSION_ID', 'Session id must contain only letters, digits and hyphens.');
  const all = await discoverSessions(channel, options);
  const matches = all.filter(r => r.filename === `${id}.jsonl` || r.filename.endsWith(`-${id}.jsonl`));
  invariant(matches.length === 1, 'SESSION_SELECTION', matches.length ? 'Multiple session files match; specify --input.' : 'No local session matches this id. Specify --input or list sessions.');
  return matches[0].input;
}
