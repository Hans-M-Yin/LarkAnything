---
name: larkanything-export
description: Connect LarkAnything to Feishu/Lark and export a selected Codex, Claude Code, ChatGPT export file, or ConversationV1 JSON conversation with a local preview and configurable transcript format. Ordinary Feishu document edits use the user's existing document tools.
---

# LarkAnything Export

Use this skill's `scripts/run.mjs` launcher. The lazy installer already installs dependencies and locates Lark CLI; no plugin marketplace registration, cache lookup, npm install or JSON editing is needed after that. The launcher works from any current directory and supplies the shared configuration automatically. Node.js 22+ is required.

For initial connection, missing authorization or a request to connect Feishu, read [connect.md](references/connect.md). Never request tokens or app secrets in chat. To locate the installed runtime, config or full README, run `node <skill-root>/scripts/run.mjs paths`.

## Select the conversation

- Use the exact session id for the conversation the user selected. For Codex, prefer `--session`: LarkAnything discovers and assembles all local segments using their recorded session identity, including renamed and archived files. Do not assume the most recent session is intended.
- `codex`: local Codex CLI/Desktop rollout JSONL. `claude-code`: local Claude Code JSONL. `chatgpt`: user-provided ChatGPT conversation export JSON; multiple conversations require `--session`. `generic`: ConversationV1 JSON from a custom client.
- If the source is ambiguous, use `list --channel codex` or `list --channel claude-code`, then resolve the user's selection. Codex results include the session id, segment count and source paths; they do not upload anything.
- `--input` deliberately exports only the specified file. Codex reports its conversation completeness as unknown. Use it when the user selected that file, not as a workaround for segmented sessions.
- Do not manufacture a transcript from context or summaries. Do not read original logs to judge completeness, write merge/filter scripts, import adapters to construct a generic conversation, or delete messages based on similar text. Source assembly, context filtering, deduplication and coverage reporting belong to LarkAnything. Report source conflicts or missing-history diagnostics instead of repairing the transcript yourself. Fork prefixes and missing attachments remain explicit limitations.

## Export with one command

For an irreparably damaged published snapshot, see `docs/RECOVERY.md` in the installed runtime. After the user explicitly authorizes replacing the original document, back it up and use `preview ... --repair` followed by publishing the saved plan. This rebuilds the same document and checkpoints from the actual adapter output. For a known sync append/repair target with an uncertain receipt, `publish --plan ... --recover` performs strict read-only verification; it never replays a write. Ordinary exports never use these flags automatically.

```bash
node <skill-root>/scripts/run.mjs publish --channel codex --session <selected-id>
```

Replace placeholders with resolved local paths/ids, and pass arguments without shell interpolation. Publishing automatically prepares the source snapshot, writes the local preview, converts, uploads and verifies it. No separate agent inspection of the transcript is required. The user can simply say “把这个对话导出到飞书”; do not require a skill invocation syntax. A request to export authorizes publishing to the selected target unless the user explicitly requests review first. `--input <file>` works for all channels; use `--channel claude-code` for Claude Code logs. `--parent-token` selects a destination; `--profile engineering` includes tools; `--config` overrides the installed default config.

The default `sync` operation matches the stable conversation id to its locally saved document binding and appends only new messages. With no new messages, report the existing document and `reused` result. Keep the same state directory, namespace, identity and parent destination to continue it. Do not add a fixed `--key` to routine exports: keys identify individual frozen snapshots. If a config explicitly selects `create`, pass `--operation sync` when the user wants to continue the conversation document. Use explicit `create` only for a requested independent document; explicit `append --document` appends the entire selected export. Legacy receipts have no conversation binding. On `SYNC_HISTORY_CHANGED`, report the history conflict without editing source messages. On `SYNC_PENDING`, finish the indicated original plan first. On `SYNC_STALE_PLAN`, prepare a fresh preview; obtain renewed approval only if the user required review and the reviewed content has changed.

For a preview-only request, run `preview` with the same source options and stop. If the user later approves that preview, publish its saved plan so a growing conversation cannot change the reviewed content:

```bash
node <skill-root>/scripts/run.mjs preview --channel codex --session <selected-id>
node <skill-root>/scripts/run.mjs publish --plan <output.plan>
```

Use the returned JSON's `source.manifest`, `coverage`, `warnings` and `receipt` to report results. Once a plan has been saved, use it for retries after any required runtime permission or authorization adjustment as well. `complete` with `scope: local-session` means all discoverable local segments at preparation time, not proof that deleted, remote or parent-fork history exists. Ambiguous repeated/revised messages are retained with a warning; never silently remove them to produce a preferred question count.

The default protocol exports user/assistant text, keeps code and tables, and excludes tool logs. Respect `--include-tools` or a profile when requested. Media remains linked or explicitly marked unsupported in v0.1. Review conversion warnings; use `--strict` when the user requires no unsupported content. No model calls or automatic summarization are involved.

LaTeX delimited by `$…$`, `$$…$$`, `\(…\)` or `\[…\]` is converted to native Feishu `<latex>` elements. Do not escape formulas by hand or reconstruct a damaged formula from a rendered export; keep the original source. Code examples remain literal. The HTML preview renders math offline, but does not verify Feishu's visual result or command coverage. Old frozen plans carrying `MATH_NOT_VERIFIED` can retry their original text-only verification; the receipt records this compatibility mode, and new native formulas always require formula-aware verification.

Consecutive assistant messages in the same turn are grouped by default. Display the time range and model once at the reply's start; list any actual recorded model changes there. Quote public progress/implementation messages with only a “（步骤 x）” marker; final answers stay in the body. Only explicit public commentary/tool output is quoted; unknown phases stay in the body and private reasoning is never exported. The adapter retains each original message's time and model. Explicit turn boundaries and user messages prevent merging; unknown turn ids fall back to adjacency. Time means the log's recorded time, and Codex model names from turn context are labeled as configuration, not independently verified routing. Missing metadata stays unknown. Use `--time-zone` when the user specifies a zone, `--no-merge` for separate entries, `--no-timestamps` or `--no-models` to hide metadata. Never infer historical models from the current model setting.

Return the actual document URL/id from the receipt and distinguish readback from visual verification. Link-boundary whitespace normalization is reported explicitly; code whitespace and code structure are verified separately from prose. On `READBACK_ERROR` or `READBACK_MISMATCH`, use `publish --plan <retry.plan>` to retry only verification of the existing document. Do not replan from a growing session, manually fetch/normalize text to override a failed result, or mark a separate agent-authored verification as success. Report the structured difference if verification still fails. On `WRITE_UNCERTAIN`, stop and report the saved export key; never change keys or delete state to force a new write.

If this skill was copied without its installer and the launcher reports missing dependencies, read INSTALL.md in the source repository and run its installer. Do not rewrite unrelated agent settings to make the skill load.
