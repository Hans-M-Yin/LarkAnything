---
name: larkanything-export
description: Connect LarkAnything to Feishu/Lark and export a selected Codex, Claude Code, ChatGPT export file, or ConversationV1 JSON conversation with a local preview and configurable transcript format. Ordinary Feishu document edits use the user's existing document tools.
---

# LarkAnything Export

Use this skill's `scripts/run.mjs` launcher. The lazy installer already installs dependencies and locates Lark CLI; no plugin marketplace registration, cache lookup, npm install or JSON editing is needed after that. The launcher works from any current directory and supplies the shared configuration automatically. Node.js 22+ is required.

For initial connection, missing authorization or a request to connect Feishu, read [connect.md](references/connect.md). Never request tokens or app secrets in chat. To locate the installed runtime, config or full README, run `node <skill-root>/scripts/run.mjs paths`.

## Select the conversation

- Use the exact local rollout file/session id for the conversation the user selected. Do not assume the most recent session is the intended conversation.
- `codex`: local Codex CLI/Desktop rollout JSONL. `claude-code`: local Claude Code JSONL. `chatgpt`: user-provided ChatGPT conversation export JSON; multiple conversations require `--session`. `generic`: ConversationV1 JSON from a custom client.
- If the source is ambiguous, use `list --channel codex` or `list --channel claude-code`, then resolve the user's selection. These commands list paths; they do not upload anything.
- Do not manufacture a full transcript from the current context or summaries. Fork prefixes and missing attachments may be unavailable; surface the reported limits.

## Preview and publish

```bash
node <skill-root>/scripts/run.mjs preview --channel codex --session <selected-id>
node <skill-root>/scripts/run.mjs publish --channel codex --session <selected-id>
```

Replace placeholders with resolved local paths/ids, and pass arguments without shell interpolation. `--input <file>` works for all four channels; use `--channel claude-code` for Claude Code logs. The user can simply say “把这个对话导出到飞书”; do not require a skill invocation syntax. `--parent-token` selects a destination without editing JSON. `--profile engineering` includes tools; `--config` overrides the installed default config. If the user only requests a preview, stop after preview. A request to export to Feishu authorizes publishing to the selected target; proceed after preparing the preview unless the user explicitly requested a review first.

The default protocol exports user/assistant text, keeps code and tables, and excludes tool logs. Respect `--include-tools` or a profile when requested. Media remains linked or explicitly marked unsupported in v0.1. Review conversion warnings; use `--strict` when the user requires no unsupported content. No model calls or automatic summarization are involved.

Consecutive assistant messages in the same turn are grouped by default. Display the time range and model once at the reply's start; list any actual recorded model changes there. Quote public progress/implementation messages with only a “（步骤 x）” marker; final answers stay in the body. Only explicit public commentary/tool output is quoted; unknown phases stay in the body and private reasoning is never exported. The adapter retains each original message's time and model. Explicit turn boundaries and user messages prevent merging; unknown turn ids fall back to adjacency. Time means the log's recorded time, and Codex model names from turn context are labeled as configuration, not independently verified routing. Missing metadata stays unknown. Use `--time-zone` when the user specifies a zone, `--no-merge` for separate entries, `--no-timestamps` or `--no-models` to hide metadata. Never infer historical models from the current model setting.

Return the actual document URL/id from the receipt and distinguish text readback from visual verification. If publishing is uncertain, do not repeat the write. If a document was written but readback failed, rerunning the same command retries only readback. Never change the key or delete state to bypass an uncertain result without investigating the existing document.

If this skill was copied without its installer and the launcher reports missing dependencies, read INSTALL.md in the source repository and run its installer. Do not rewrite unrelated agent settings to make the skill load.
