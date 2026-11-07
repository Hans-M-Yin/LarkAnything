#!/usr/bin/env node
import { cp, lstat, mkdir, open, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify, parseArgs } from 'node:util';
import { dirname, delimiter, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

const exec = promisify(execFile);
const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
const owner = 'larkanything';
const markerName = '.larkanything-install.json';
const skillName = 'larkanything-export';
const larkPackage = '@larksuite/cli@1.0.98';
const runtimeFiles = ['package.json', 'package-lock.json', 'README.md', 'README.zh-CN.md', 'INSTALL.md', 'LICENSE', 'bin', 'src', 'skills', 'docs', 'examples'];
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const exists = async path => { try { await lstat(path); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
const save = (path, data) => writeFile(path, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });

export async function runCommand(command, args, options = {}) {
  return exec(command, args, { ...options, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 300000, windowsHide: true });
}

export async function findNpm() {
  const candidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    join(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
  ].filter(Boolean);
  for (const directory of (process.env.PATH || '').split(delimiter)) {
    if (!directory) continue;
    try {
      const executable = await realpath(join(directory, process.platform === 'win32' ? 'npm.cmd' : 'npm'));
      if (executable.endsWith('.js')) candidates.push(executable);
      candidates.push(join(dirname(executable), 'node_modules/npm/bin/npm-cli.js'));
    } catch {}
  }
  for (const candidate of candidates) if (candidate.endsWith('.js') && await exists(candidate)) return resolve(candidate);
  throw new Error('npm was not found. Install Node.js 22+ with npm, then rerun this installer.');
}

async function ownedOrMissing(path, expectedPrefix) {
  if (!await exists(path)) return;
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Refusing to replace this path: ${path}`);
  let marker;
  try { marker = await json(join(path, markerName)); } catch {}
  if (!marker && resolve(path) === expectedPrefix) {
    try { marker = await json(join(path, '.larkanything-desktop.json')); } catch {}
  }
  if (marker?.managedBy !== owner || marker.prefix !== expectedPrefix) throw new Error(`An unrelated installation or folder already exists: ${path}. Choose another --prefix or preserve that folder before continuing.`);
}

async function ensureLark(prefix, run, npm, requestedExecutable, skip) {
  if (skip) return { status: 'skipped', executable: requestedExecutable || 'lark-cli' };
  const verify = async executable => {
    await run(executable, ['--version']);
    const help = await run(executable, ['docs', '+create', '--help']);
    if (!help.stdout.includes('--doc-format') || !help.stdout.includes('markdown')) throw new Error('This Lark CLI lacks Markdown import support.');
  };
  for (const executable of [...new Set([requestedExecutable, 'lark-cli'].filter(Boolean))]) {
    try { await verify(executable); return { status: 'ready', executable }; } catch {}
  }
  const tools = join(prefix, 'tools');
  await mkdir(tools, { recursive: true, mode: 0o700 });
  const packageRoot = join(tools, 'node_modules/@larksuite/cli');
  const executable = join(packageRoot, 'bin', process.platform === 'win32' ? 'lark-cli.exe' : 'lark-cli');
  try { await verify(executable); return { status: 'ready', executable }; } catch {}
  // Install privately, never into the user's global npm prefix or shell configuration.
  await run(process.execPath, [npm, 'install', '--prefix', tools, '--ignore-scripts', '--no-audit', '--no-fund', larkPackage]);
  // Run only the official package's checksum-verifying native binary installer.
  await run(process.execPath, [join(packageRoot, 'scripts/install.js')]);
  await verify(executable);
  return { status: 'ready', executable };
}

export async function install({ agent = 'all', prefix, homeDir = homedir(), source = sourceRoot, run = runCommand, npmCli, skipLark = false } = {}) {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22+ is required.');
  if (!['codex', 'claude', 'all'].includes(agent)) throw new Error('--agent must be codex, claude, or all.');
  prefix = resolve(prefix || join(homeDir, '.larkanything'));
  const runtimeRoot = join(prefix, 'runtime'), configPath = join(prefix, 'config.json');
  const targets = [
    ...(agent !== 'claude' ? [{ agent: 'codex', path: join(homeDir, '.agents/skills', skillName) }] : []),
    ...(agent !== 'codex' ? [{ agent: 'claude', path: join(homeDir, '.claude/skills', skillName) }] : []),
  ];
  await ownedOrMissing(prefix, prefix);
  await ownedOrMissing(runtimeRoot, prefix);
  for (const target of targets) await ownedOrMissing(target.path, prefix);
  if (source === runtimeRoot || resolve(source) === runtimeRoot) throw new Error('Run updates from a fresh source checkout, not the installed runtime.');
  const npm = npmCli || await findNpm();
  const packageInfo = await json(join(source, 'package.json'));
  const existingConfig = await exists(configPath) ? await json(configPath) : undefined;
  await mkdir(prefix, { recursive: true, mode: 0o700 });
  // Claim only this managed prefix; unrelated existing folders were rejected above.
  await save(join(prefix, markerName), { managedBy: owner, prefix, version: packageInfo.version });
  let lock;
  try { lock = await open(join(prefix, '.install.lock'), 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('Another installation is running. Inspect any interrupted install before removing .install.lock.'); throw error; }
  const stage = join(prefix, `.stage-${randomUUID()}`), backups = [], committed = [];
  try {
    await mkdir(stage, { mode: 0o700 });
    for (const file of runtimeFiles) await cp(join(source, file), join(stage, file), { recursive: true });
    await save(join(stage, markerName), { managedBy: owner, prefix, version: packageInfo.version });
    await run(process.execPath, [npm, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: stage });
    const lark = await ensureLark(prefix, run, npm, existingConfig?.backends?.['lark-cli']?.executable, skipLark);
    // The installed program must actually start before replacing a working version.
    await run(process.execPath, [join(stage, 'bin/larkanything.mjs'), '--help']);
    for (const target of targets) {
      target.stage = join(stage, `skill-${target.agent}`);
      await cp(join(source, 'skills', skillName), target.stage, { recursive: true });
      await save(join(target.stage, 'installation.json'), { managedBy: owner, runtimeRoot, configPath });
      await save(join(target.stage, markerName), { managedBy: owner, prefix, version: packageInfo.version });
    }
    const replacements = [{ path: runtimeRoot, stage }, ...targets];
    // Move skill staging folders out of the runtime staging folder before swapping it.
    for (const target of targets) {
      const independentStage = join(prefix, `.skill-${target.agent}-${randomUUID()}`);
      await rename(target.stage, independentStage); target.stage = independentStage;
    }
    for (const target of replacements) {
      await ownedOrMissing(target.path, prefix);
      await mkdir(dirname(target.path), { recursive: true });
      if (await exists(target.path)) {
        const backup = `${target.path}.backup-${randomUUID()}`;
        await rename(target.path, backup); backups.push({ path: target.path, backup });
      }
      await rename(target.stage, target.path); committed.push(target.path);
    }
    const nextConfig = existingConfig ? {
      ...existingConfig,
      backends: { ...existingConfig.backends, 'lark-cli': { ...existingConfig.backends?.['lark-cli'], executable: lark.executable } },
    } : {
      version: 1, stateDir: 'state',
      defaults: { format: { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone } },
      channels: { codex: { format: { assistantLabel: 'Codex' } }, 'claude-code': { format: { assistantLabel: 'Claude Code' } }, chatgpt: { format: { assistantLabel: 'ChatGPT' } } },
      profiles: { readable: { format: { includeTools: false } }, engineering: { format: { includeTools: true, includeTimestamps: true } } },
      backends: { 'lark-cli': { identity: 'user', executable: lark.executable } },
    };
    const configStage = join(prefix, `.config-${randomUUID()}.json`);
    try { await save(configStage, nextConfig); await rename(configStage, configPath); }
    finally { await rm(configStage, { force: true }); }
    // Backup cleanup must not roll back a successful install after another backup was removed.
    for (const backup of backups) await rm(backup.backup, { recursive: true, force: true }).catch(() => {});
    return {
      ok: true, version: packageInfo.version, prefix, runtimeRoot, configPath, larkCli: lark, skills: targets.map(({ agent, path }) => ({ agent, path })),
      next: 'Start a new Codex/Claude Code conversation and say: 帮我连接飞书，然后把这个对话导出到飞书。',
      connectionGuide: join(runtimeRoot, 'skills', skillName, 'references/connect.md'),
    };
  } catch (error) {
    for (const path of committed.reverse()) await rm(path, { recursive: true, force: true });
    for (const backup of backups.reverse()) await rename(backup.backup, backup.path);
    throw error;
  } finally {
    await rm(stage, { recursive: true, force: true });
    for (const target of targets) if (target.stage && target.stage !== stage) await rm(target.stage, { recursive: true, force: true });
    await lock.close(); await rm(join(prefix, '.install.lock'), { force: true });
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const { values } = parseArgs({ options: { agent: { type: 'string', default: 'all' }, prefix: { type: 'string' }, 'skip-lark': { type: 'boolean' }, help: { type: 'boolean' } }, strict: true });
    if (values.help) console.log('node scripts/install.mjs [--agent codex|claude|all] [--prefix DIRECTORY] [--skip-lark]\nInstalls a private runtime, dependencies and personal skills. Default: both agents.\nNo global npm install, shell profile changes, sign-in or token collection.');
    else {
      console.error('Installing LarkAnything and preparing skills…');
      console.log(JSON.stringify(await install({ agent: values.agent, prefix: values.prefix, skipLark: values['skip-lark'] }), null, 2));
    }
  } catch (error) {
    console.error(JSON.stringify({ ok: false, message: error.code && error.cmd ? `Dependency installation failed (${error.code}). Check Node/npm and network access, then rerun the installer.` : error.message }, null, 2));
    process.exitCode = 1;
  }
}
