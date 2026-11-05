#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

try {
  let installation;
  try { installation = JSON.parse(await readFile(new URL('../installation.json', import.meta.url), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (installation && installation.managedBy !== 'larkanything') throw new Error('Unrecognized installation pointer. Reinstall LarkAnything.');
  const runtimeRoot = installation?.runtimeRoot || fileURLToPath(new URL('../../../', import.meta.url));
  const configPath = installation?.configPath;
  const config = configPath ? JSON.parse(await readFile(configPath, 'utf8')) : {};
  const larkExecutable = config.backends?.['lark-cli']?.executable || 'lark-cli';
  const args = process.argv.slice(2);
  if (args[0] === 'paths') {
    console.log(JSON.stringify({ runtimeRoot, configPath, larkExecutable, readme: join(runtimeRoot, 'README.md'), connectionGuide: join(runtimeRoot, 'skills/larkanything-export/references/connect.md') }, null, 2));
  } else {
    const lark = args[0] === 'lark';
    const command = lark ? larkExecutable : process.execPath;
    const commandArgs = lark ? args.slice(1) : [join(runtimeRoot, 'bin/larkanything.mjs'), ...args, ...(configPath && !args.some(a => a === '--config' || a.startsWith('--config=')) ? ['--config', configPath] : [])];
    const child = spawn(command, commandArgs, { stdio: 'inherit', shell: false, windowsHide: true });
    child.on('error', () => { console.error('Could not start LarkAnything/Lark CLI. Rerun the installer or read the connection guide.'); process.exitCode = 1; });
    child.on('exit', code => { process.exitCode = code ?? 1; });
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
