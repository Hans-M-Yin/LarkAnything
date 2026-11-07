# CLI, Skills and SDK guide

This guide is for the optional CLI, personal Skills and JavaScript SDK. Desktop users can install from [GitHub Releases](https://github.com/Hans-M-Yin/LarkAnything/releases/tag/desktop-v0.1.0-preview.1) and connect inside the App; they do not need the commands below.

## Easy installation for Codex / Claude Code

Give Codex or Claude Code this repository's GitHub URL and say:

> Install LarkAnything from https://github.com/Hans-M-Yin/LarkAnything, read INSTALL.md, and help me connect it to Feishu/Lark.

The agent follows [INSTALL.md](../INSTALL.md) (currently in Chinese) to install the runtime, dependencies, and a personal Skill for your client. To install manually:

```bash
git clone https://github.com/Hans-M-Yin/LarkAnything.git
cd LarkAnything
node scripts/install.mjs
```

If you are already in the source directory, only run `node scripts/install.mjs`.

Both Codex and Claude Code are installed by default. Use `--agent codex` or `--agent claude` to select one. The installer prepares dependencies, reuses an existing official Lark CLI or installs a private copy, and creates a default configuration. No plugin marketplace registration, cache-directory hunting, or manual JSON editing is required. Node.js 22+ and npm are required; your agent can help prepare them if missing.

After installation, let the agent guide you through the setup and authorization required by Feishu/Lark. Start a new chat and say:

> Export this conversation to Feishu.

The runtime and configuration live in `.larkanything` under your home directory. You can delete the downloaded source afterward. To update, download the new source and rerun the same installation command; configuration and publish receipts are preserved. Authorization remains subject to your tenant and organization permissions.

## Local development / offline demo

With Node.js 22+, run these commands in the project directory:

```bash
npm ci --ignore-scripts
npm run demo
```

Open `.larkanything/demo/preview.html` to view a synthetic example. The demo contains no real conversations and does not connect to Feishu/Lark.

Preview your own conversation locally:

```bash
node bin/larkanything.mjs list --channel codex
node bin/larkanything.mjs preview --channel codex --session YOUR_SESSION_ID
node bin/larkanything.mjs preview --channel claude-code --input /path/to/session.jsonl
node bin/larkanything.mjs preview --channel chatgpt --input /path/to/conversations.json --session YOUR_CONVERSATION_ID
```

`list` never uploads content. Codex results group files by their recorded `session_meta.id` and include the session id, segment count and source paths. `--session` automatically assembles matching local segments, including archived and suffixed logs. `--input` deliberately loads only that file and reports full conversation completeness as unknown.

`preview` writes Markdown, HTML and a frozen `plan.json`; these may contain private conversation text. The plan's `source.manifest` records source paths, byte counts, SHA-256 fingerprints, message counts, excluded injected records and deduplication counts. `complete` covers discoverable local segments at preparation time, not deleted, remote or parent-fork history. Conflicting versions of one message identity stop the export. Ambiguous repeats or revisions are retained with diagnostics; text prefixes never justify deletion. Tool logs are excluded by default; use `--include-tools` to include them.

### Reading format and metadata

By default, consecutive assistant messages from the same reply share one heading while preserving the original text of each step. The reply's recorded time range and model appear once at the top. Public progress and implementation updates appear in block quotes with a simple step marker; the final response appears as normal body text. Only messages explicitly identified as progress by the log are quoted. Unknown phases remain body text, without guessing which message is the final response. Codex uses `turn_id` to identify reply boundaries; sources without turn identifiers use consecutive assistant messages. A user message always ends a group. When included, tool steps remain in their original order inside quotes.

Adapters still retain timestamps and models for each message. If the log records a model change within one reply, the models appear in order at the top. **Timestamps come from client logs and may differ from when the user clicked Send or the server began generating.** Codex model metadata comes from the turn configuration and is labeled accordingly. Claude Code uses the message's `model`; ChatGPT uses `metadata.model_slug`. Missing information is marked as unrecorded. The current model is never used to fill historical gaps, and internal reasoning is not exported.

New installations use your local time zone. SDK calls and calls without a configuration default to UTC; upgrades preserve existing configuration. Override the time zone for a single export:

```bash
node bin/larkanything.mjs preview --channel codex --session YOUR_SESSION_ID --time-zone Asia/Shanghai
```

Use `--no-merge` for individual message headings, `--no-timestamps` to hide timestamps, and `--no-models` to hide models. Configuration options are `format.mergeConsecutiveAssistant`, `includeTimestamps`, `includeModels`, and `timeZone`. Grouping only changes presentation: `publishedMessages` counts original messages, while `displayGroups` counts displayed groups.

Math is extracted before Markdown formatting. Plans and previews retain original formula source; the backend sends dollar-delimited formulas to avoid XML entities being interpreted as TeX during Markdown import. Transport removes TeX line comments at their original line boundaries, then replaces source newlines with spaces, preserving matrix row commands, subscripts and Chinese text. Readback applies the same rule and records `math-source-layout` when needed; formula content, row commands and code remain strictly checked. Original source stays in the local plan. Code stays literal; prose dollar signs are escaped. Local previews use offline KaTeX MathML; supported commands and visual appearance still require live validation. Frozen plans explicitly marked `MATH_NOT_VERIFIED` retain `legacy-math-as-text` verification.

## Connect to Feishu/Lark

The backend uses the official [Lark CLI](https://github.com/larksuite/cli) for authorization and document operations. Follow its quick start to install and authorize it, for example:

```bash
npx @larksuite/cli@latest install
lark-cli config init
lark-cli auth login --domain docs,drive
```

The following commands must be available. LarkAnything itself does not read, store, or ask you to paste OAuth tokens:

```bash
lark-cli docs +create --help
lark-cli docs +update --help
lark-cli docs +fetch --help
```

Confirm that `+create` and `+update` support `--doc-format markdown` and `--content -`, then publish:

```bash
node bin/larkanything.mjs publish --channel codex --session YOUR_SESSION_ID
```

This command owns source assembly, snapshotting, conversion, preview, upload and readback. The agent does not need to inspect logs or write processing scripts. Verification checks the full text sequence, explicitly reports link-boundary whitespace compatibility, and strictly preserves code whitespace, indentation and inline-code structure. It does not verify fonts, table widths or image appearance.

The default `--operation sync` creates a document on the first publish and records the conversation id, document id and published message ids/hashes locally. Running it again after more conversation appends only new messages to that document; unchanged exports perform no remote write. Message numbering continues without repeating the transcript heading or session metadata. The opening counts and time range remain the initial snapshot. Matching is scoped by channel, backend identity, namespace and parent destination, and requires the same state directory and a stable conversation id. If an existing config explicitly sets `create`, change it to `sync` or pass `--operation sync`. Legacy receipts lack conversation bindings and cannot automatically resume older documents.

To publish a reviewed preview or retry failed readback, use the returned `output.plan` / `retry.plan`:

```bash
node bin/larkanything.mjs publish --plan /absolute/path/to/plan.json
```

The saved plan freezes the body, destination and export key without rereading a growing conversation. A known remote receipt retries verification only. Error JSON includes the document URL/id, difference diagnostics and retry plan. Uncertain writes remain blocked from automatic replay. Agents must report the program's result rather than override failures by deleting whitespace or writing their own verification files.

Choose a destination and formatting profile:

```bash
node bin/larkanything.mjs publish --channel codex --input /path/session.jsonl --parent-token FOLDER_OR_WIKI_NODE_TOKEN
node bin/larkanything.mjs publish --channel codex --session YOUR_SESSION_ID --operation create
node bin/larkanything.mjs publish --channel claude-code --input /path/session.jsonl --operation append --document DOCUMENT_URL_OR_ID
node bin/larkanything.mjs publish --channel codex --input /path/session.jsonl --config examples/larkanything.config.json --profile engineering
```

The user must complete the initial Feishu/Lark authorization. Available destinations, features, and access depend on the account, tenant, and authorized scopes. Regional domains and authentication for Lark and Feishu are handled by the official CLI configuration.

## Optional: install as a Codex plugin

For most users, use the easy installer above. Marketplace distribution is an alternative to personal Skill installation; you only need one.

The repository includes a portable `plugin.json`, a Codex-compatible manifest, and `.agents/plugins/marketplace.json`.

For local development, register the marketplace from the project root:

```bash
codex plugin marketplace add .
```

Select the LarkAnything marketplace in the Codex plugin interface and install it. Run `npm ci --ignore-scripts` once in the installed plugin directory and complete Lark CLI authorization. Then start a new chat and say:

> Use $larkanything-export to save this Codex conversation to Feishu, excluding tool logs.

The Skill uses the selected conversation's actual logs, not the current context summary as a substitute for the full transcript. It requires local execution. There is no remote MCP service or browser extension in this release. The marketplace can also be added using this repository's GitHub URL. Submission to a public plugin store is a separate process; this project is not listed there.

## Configuration and protocols

See the [complete example](../examples/larkanything.config.json). Configuration precedence is:

`built-in defaults → defaults → channels[channel] → profiles[name] → per-call CLI/SDK overrides`

- `protocol` controls content selection and document structure; v0.1 provides `transcript`.
- `format` supplies protocol options such as role labels, language, timestamps, tool logs, and conversion strictness.
- `renderer` selects the transport format; v0.1 provides `markdown`.
- `target` selects the backend, operation, destination, and application namespace.
- `backends` holds backend-specific runtime options. Do not put credentials in the configuration.

For example, dedicate a Feishu folder to research notes:

```json
{
  "version": 1,
  "profiles": {
    "research": {
      "format": { "locale": "zh-CN", "includeTools": false },
      "target": { "parentToken": "YOUR_FOLDER_TOKEN", "namespace": "research" }
    }
  }
}
```

`stateDir` is resolved relative to the configuration file. Without a configuration file, receipts are stored in `.larkanything/state` under the current working directory. Separate accounts or workflows should use separate namespaces and state directories.

## Extension interfaces

```javascript
import { createLarkAnything } from './src/index.mjs';

const engine = createLarkAnything({
  adapters: [myClientAdapter],
  protocols: [myFormatProtocol],
  renderers: [myRenderer],
  backends: [myLarkBackend],
});

const plan = await engine.plan({
  channel: myClientAdapter.id,
  input: '/path/to/export',
  overrides: { protocol: myFormatProtocol.id, target: { backend: myLarkBackend.id } },
});
await engine.publish(plan);
```

The five replaceable interfaces are `Adapter`, `FormatProtocol`, `Renderer`, `Backend`, and `ReceiptStore`. See the [TypeScript interfaces](../src/index.d.ts) and [architecture guide](ARCHITECTURE.md) (currently in Chinese). The core does not depend on client-specific log formats. New source types can register their own protocol without pretending to be chat messages.

## Reliability and limitations

- Receipts distinguish `publishing`, `written`, `verified`, `verification_failed`, and `uncertain` states.
- Republishing a verified frozen plan returns its existing receipt. A named key identifies one snapshot and conflicts with a different plan; routine incremental publishing needs no explicit key.
- An unknown write result is not automatically retried. If a document id is known but readback failed, use `publish --plan` with the same frozen plan to retry readback only.
- Idempotency is limited to **the same state directory**. Multiple machines/users need a shared ReceiptStore. v0.1 has no distributed transactions or automatic exactly-once guarantee.
- Default `sync` uses the conversation binding and message checkpoint to append only new messages. Edited, truncated or switched-branch history stops with `SYNC_HISTORY_CHANGED`. Finish pending publishes using their original frozen plan. `SYNC_STALE_PLAN` requires preparing a fresh plan before publishing.
- Explicit `create` creates an independent document; explicit `append --document ...` appends the entire selected export and can repeat existing text. Neither operation creates an automatic conversation binding.
- No overwriting existing documents, two-way sync, summaries, automatic sharing, notifications, or background monitoring.
- Codex fork parents are not merged automatically. Claude Code and ChatGPT export the selected branch. Missing content, conversion limitations, and excluded tool logs are reported.
- v0.1 reads locally available logs or user-supplied export files. It does not connect to or scrape AI client accounts. Log formats are not stable public contracts and require ongoing compatibility work with real examples.
- Local previews/plans contain exported text. Receipts store status, error codes and message ids/hashes; failed readback may include short difference excerpts, but not the full document body. Original client logs remain unchanged.

`--strict` stops publication when a recognized source or rendering limitation is encountered. Passing local tests and a mock backend does not establish that publication and visual checks have succeeded in your own tenant.

## Development and roadmap

```bash
npm run check
npm test
npm run demo
```

Tests cover branch selection, duplicate events, formatting overrides, code fences, XML escaping, long text, concurrency, unknown write results, and simulated publishing across real subprocess boundaries.

Planned directions: media and formula fidelity → more clients and browser entry points → conflict handling for remote manual edits → GitHub/web/local-file sources → additional outputs such as Bitable. Each has an extension point; unimplemented features are not advertised in runtime capabilities.

MIT License. An independent community project, not affiliated with OpenAI, Anthropic, Feishu, or Lark.
