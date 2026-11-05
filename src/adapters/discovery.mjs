import { readdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { invariant } from '../core/errors.mjs';

async function walk(root) {
  const files = [];
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return files; throw error; }
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name !== 'subagents') files.push(...await walk(join(root, entry.name)));
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(join(root, entry.name));
  }
  return files;
}

// Session metadata, rather than a filename suffix, identifies Desktop segments.
async function codexHeader(input) {
  const stream = createReadStream(input, { encoding: 'utf8' });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line);
        const p = record.type === 'session_meta' ? record.payload : undefined;
        return typeof p?.id === 'string' && p.id ? { session: p.id, startedAt: p.timestamp || record.timestamp } : {};
      } catch { return {}; } // Loading the selected file reports malformed JSON with its line number.
    }
    return {};
  } finally { lines.close(); stream.destroy(); }
}

export async function discoverSessions(channel, { codexHome = process.env.CODEX_HOME || join(homedir(), '.codex'), claudeHome = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude') } = {}) {
  invariant(['codex', 'claude-code'].includes(channel), 'DISCOVERY_CHANNEL', 'Local session discovery supports codex and claude-code.');
  const roots = channel === 'codex' ? [join(codexHome, 'sessions'), join(codexHome, 'archived_sessions')] : [join(claudeHome, 'projects')];
  const files = (await Promise.all(roots.map(walk))).flat();
  const entries = files.sort().map(input => ({ channel, input, filename: basename(input) }));
  if (channel !== 'codex') return entries;
  const groups = new Map(), result = [];
  // Bound open file descriptors even with a large local session archive.
  for (const entry of entries) {
    const header = await codexHeader(entry.input);
    if (!header.session) { result.push(entry); continue; }
    let group = groups.get(header.session);
    if (!group) {
      group = { ...entry, session: header.session, inputs: [], segments: 0 };
      groups.set(header.session, group); result.push(group);
    }
    group.inputs.push(entry.input); group.segments++;
  }
  return result;
}

export async function resolveSessionSources(channel, id, options) {
  invariant(typeof id === 'string' && /^[a-zA-Z0-9-]+$/.test(id), 'SESSION_ID', 'Session id must contain only letters, digits and hyphens.');
  const all = await discoverSessions(channel, options);
  const matches = all.filter(r => r.session ? r.session === id : r.filename === `${id}.jsonl` || r.filename.endsWith(`-${id}.jsonl`) || (channel === 'codex' && r.filename.includes(`-${id}_`)));
  if (channel === 'codex' && matches.length > 1 && matches.some(r => !r.session)) {
    invariant(false, 'SOURCE_SESSION_UNCONFIRMED', 'A possible session segment has no readable session metadata. Repair the source before exporting; no segment will be silently omitted.');
  }
  invariant(matches.length === 1, 'SESSION_SELECTION', matches.length ? 'Multiple session files match; specify --input.' : 'No local session matches this id. Specify --input or list sessions.');
  return matches[0].inputs || [matches[0].input];
}

export async function resolveSession(channel, id, options) {
  const inputs = await resolveSessionSources(channel, id, options);
  invariant(inputs.length === 1, 'SESSION_SEGMENTS', 'This session has multiple segments. Export with --session or use resolveSessionSources; selecting one file would omit content.');
  return inputs[0];
}
