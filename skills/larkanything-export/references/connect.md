# Connect LarkAnything to Feishu/Lark

Use the launcher from this skill, not an assumed global CLI path:

```bash
node <skill-root>/scripts/run.mjs paths
node <skill-root>/scripts/run.mjs lark auth status --json --verify
```

The installer prepares the program and personal Skill. Connection is complete only after the CLI confirms a valid user identity and the required document scopes. Reuse existing authorization when valid; do not make a new app or request login on every export. Read the available Lark setup/auth skill when the host provides one; otherwise use the bounded flow below. Do not collect credentials in chat or print tokens.

## Missing app configuration

Read `node <skill-root>/scripts/run.mjs lark config init --help` first. When configuration is absent, `config init --new` starts the official browser setup. This can block waiting for the user: start it as an ongoing process, relay its actual verification URL and keep the session available. Generate a QR code with `lark auth qrcode` when its help confirms the syntax; `--output` must be a path relative to the current directory. Let the user complete the app setup in Feishu/Lark and collect completion before proceeding. Reuse an existing app when configured. Do not force initialization inside an unrelated agent-managed application, replace an existing profile, or invent app secrets.

## User authorization

Read `node <skill-root>/scripts/run.mjs lark auth login --help`, then request only document/Drive domains:

```bash
node <skill-root>/scripts/run.mjs lark auth login --domain docs,drive --no-wait --json
```

Relay the returned authorization URL unchanged and show its QR code if generated. Ask the user to complete authorization and return. Do not wait in a blocking polling call before the user can see the URL. After the user confirms completion, finish the same flow yourself:

```bash
node <skill-root>/scripts/run.mjs lark auth login --device-code <returned-device-code>
node <skill-root>/scripts/run.mjs lark auth status --json --verify
```

Keep the device code within this authorization flow. If expired, initiate a fresh flow with the same domain selection. If missing scopes are reported, follow the exact domain/scope error rather than expanding to all services. A tenant may require app/admin approval; report the actual requirement without claiming connection succeeded. Finally continue the user's original export request, when one exists.
