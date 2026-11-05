#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createLarkAnything, loadConfig, discoverSessions } from '../src/index.mjs';

const help = `LarkAnything 0.1.0 — AI conversations → Feishu/Lark

  larkanything list --channel codex|claude-code
  larkanything preview --channel CHANNEL --input FILE [--out DIRECTORY]
  larkanything publish --channel CHANNEL --input FILE [--profile NAME]
  larkanything publish --plan FILE
  larkanything status --key EXPORT_KEY

CHANNEL: codex | claude-code | chatgpt | generic
For Codex/Claude Code, --session ID can locate a local log instead of --input.
For a multi-conversation ChatGPT export, provide both --input and --session.

Options:
  --config FILE          Versioned JSON configuration
  --profile NAME         Named destination/format profile
  --title TITLE          Override the conversation title
  --key KEY              Stable idempotency key (defaults to content fingerprint)
  --out DIRECTORY        Save local Markdown, HTML preview and publish plan
  --plan FILE            Publish/retry an existing frozen plan without rereading logs
  --include-tools        Include tool calls/results (default: excluded)
  --timestamps           Display log timestamps (default: enabled)
  --no-timestamps        Hide timestamps
  --no-models            Hide recorded model names
  --no-merge             Keep assistant messages as separate groups
  --time-zone ZONE       IANA time zone, e.g. Asia/Shanghai
  --locale zh-CN|en      Transcript labels
  --operation sync|create|append  Default: sync by conversation id, append new messages
  --document ID_OR_URL   Destination document for append
  --parent-token TOKEN   Destination folder/wiki node for create
  --strict               Stop on conversion/source limitations

Publishing requires a working, authorized lark-cli. No credentials are stored
by LarkAnything. Preview is fully local and never calls the Feishu backend.
`;

let preparedOutput, preparedPlan;
try {
  const { values, positionals } = parseArgs({
    options: Object.fromEntries([
      ...['channel', 'input', 'session', 'config', 'profile', 'title', 'key', 'out', 'plan', 'locale', 'operation', 'document', 'parent-token', 'time-zone'].map(name => [name, { type: 'string' }]),
      ...['include-tools', 'timestamps', 'no-timestamps', 'no-models', 'no-merge', 'strict', 'help'].map(name => [name, { type: 'boolean' }]),
    ]), allowPositionals: true, strict: true,
  });
  const [command, ...extra] = positionals;
  if (values.help || !command) { console.log(help); process.exit(0); }
  if (extra.length) throw new Error('Unexpected positional arguments. Use --help.');
  if (!['list', 'preview', 'publish', 'status'].includes(command)) throw new Error(`Unknown command: ${command}`);
  if (values.plan && (command !== 'publish' || Object.keys(values).some(key => !['plan', 'config'].includes(key)))) throw new Error('--plan requires publish and accepts only --config alongside it. Source, format and destination are frozen in the plan.');
  const config = await loadConfig(values.config);
  if (command === 'list') {
    console.log(JSON.stringify(await discoverSessions(values.channel), null, 2));
  } else {
    const engine = createLarkAnything({ config });
    if (command === 'status') {
      if (!values.key) throw new Error('status requires --key.');
      const receipt = await engine.store.get(values.key);
      if (!receipt) throw new Error('No receipt found for this export key.');
      console.log(JSON.stringify(receipt, null, 2));
    } else {
      if (!values.plan && (!values.channel || (!values.input && !values.session))) throw new Error('Specify --channel and either --input or --session, or publish --plan FILE.');
      const format = {}, target = {};
      if (values.timestamps && values['no-timestamps']) throw new Error('Choose either --timestamps or --no-timestamps.');
      if (values['include-tools'] !== undefined) format.includeTools = values['include-tools'];
      if (values.timestamps !== undefined) format.includeTimestamps = values.timestamps;
      if (values['no-timestamps']) format.includeTimestamps = false;
      if (values['no-models']) format.includeModels = false;
      if (values['no-merge']) format.mergeConsecutiveAssistant = false;
      if (values['time-zone']) format.timeZone = values['time-zone'];
      if (values.locale) format.locale = values.locale;
      if (values.strict) format.unsupported = 'error';
      if (values.operation) target.operation = values.operation;
      if (values.document) target.documentId = values.document;
      if (values['parent-token']) target.parentToken = values['parent-token'];
      const plan = values.plan ? JSON.parse(await readFile(resolve(values.plan), 'utf8'))
        : await engine.plan({ channel: values.channel, input: values.input, session: values.session, title: values.title, profile: values.profile, key: values.key, overrides: { format, target } });
      const output = values.plan ? { plan: resolve(values.plan) }
        : await engine.preview(plan, resolve(values.out || `.larkanything/previews/${plan.fingerprint.slice(0, 16)}`));
      preparedOutput = output; preparedPlan = plan;
      const summary = { exportKey: plan.exportKey, output, source: plan.source, target: plan.target,
        ...(plan.sync ? { sync: { unchanged: plan.sync.unchanged, previousExportKey: plan.sync.previousExportKey } } : {}),
        coverage: plan.document.coverage, warnings: plan.artifact.warnings,
        retry: { command: 'publish', plan: output.plan } };
      if (command === 'preview') console.log(JSON.stringify({ ok: true, ...summary }, null, 2));
      else console.log(JSON.stringify({ ok: true, ...summary, receipt: await engine.publish(plan) }, null, 2));
    }
  }
} catch (error) {
  console.error(JSON.stringify({ ok: false, code: error.code || 'ERROR', message: error.message, ...(error.details ? { details: error.details } : {}),
    ...(preparedOutput ? { output: preparedOutput, exportKey: preparedPlan.exportKey, retry: { command: 'publish', plan: preparedOutput.plan } } : {}) }, null, 2));
  process.exitCode = 1;
}
