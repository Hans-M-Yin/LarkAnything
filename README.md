![LarkAnything](docs/assets/larkanything-banner.png)

**English** | [简体中文](README.zh-CN.md)

**Bring your AI conversations and documents into Feishu / Lark.**

LarkAnything is a lightweight desktop app for Windows and macOS. Choose a source, select a conversation or file, preview it, and publish an editable Feishu document. Set the destination folder in Settings. No model API key is required, and LarkAnything does not use AI to rewrite your content.

## Download and install

Current desktop release: **0.1.3 Preview 2** · [Release notes and checksums](https://github.com/Hans-M-Yin/LarkAnything/releases/tag/desktop-v0.1.3-preview.2)

| Platform | Download | Installation |
| --- | --- | --- |
| Windows x64 | [EXE installer · about 15 MB](https://github.com/Hans-M-Yin/LarkAnything/releases/download/desktop-v0.1.3-preview.2/LarkAnything_0.1.3_x64-setup.exe) | Run the installer |
| Apple Silicon Mac · macOS 13+ | [DMG · about 23 MB](https://github.com/Hans-M-Yin/LarkAnything/releases/download/desktop-v0.1.3-preview.2/LarkAnything_0.1.3_aarch64.dmg) | Open the DMG and drag LarkAnything into Applications |

**No Git, Node.js, Rust, Xcode or terminal commands needed.** Both installers include the official Feishu CLI 1.0.98. Windows installs Microsoft's shared WebView2 runtime if it is missing; that step needs internet access. Intel Mac and native Windows ARM installers are not included in this release.

This is a **preview release**. Windows has no publisher certificate; macOS uses an ad-hoc signature without Apple Developer ID notarization. Your OS may show an unidentified-developer prompt. See the [installation guide](docs/DESKTOP-INSTALL.md) for details. The previous Mac release was user-tested for Feishu connection and normal operation. This update restores native macOS window controls; builds and automated checks passed, while the new window interactions still need real-device confirmation.

## First use

1. Open the App and follow the connection guide to create a Feishu application or use your own App ID and App Secret. Your organization may require administrator permission.
2. Complete account authorization in your browser and return to the App to confirm. No credential-repair utility is needed.
3. Choose a source and select a conversation, page or file. Set your destination folder in Settings if needed.
4. Review the preview, then upload. The App verifies the result by reading the document back.

The App lists available content for you to select; it does not infer the active document from another app's window. Authorization and upload require internet access. Installers contain no developer account credentials or user documents.

## Supported desktop sources

| Source | How content is selected |
| --- | --- |
| Codex | Select a conversation from local session logs |
| Claude Code | Select a local conversation |
| Obsidian | Configure a vault and select a Markdown note |
| OpenCode | List and export sessions through its locally installed native CLI |
| Notion | Connect your integration, grant page access, then select a page |
| Markdown | Choose an `.md` file with the file picker |
| Microsoft Word | Choose a `.docx` file; Word itself is not required |

All sources use the same Core conversion, preview and publishing pipeline. Notion tokens are saved in Windows Credential Manager or macOS Keychain and reused after restarting. Feishu connection settings and CLI-managed login credentials also persist; secrets are not copied into app JSON settings. File imports are limited to 20 MB per file. DOCX supports text, headings, lists and tables; images and complex layouts are not preserved. ChatGPT export JSON is also supported through the optional CLI/SDK.

## Settings, updates and data

- Configure the Feishu destination, source locations, appearance and connection in the App. Advanced CLI/SDK formatting options are documented separately.
- Quit the App before updating. Run the new Windows installer, or replace the Mac application in Applications.
- Uninstall through Windows Settings, or move the Mac app to the Trash. Settings and publishing receipts in `~/.larkanything` are retained; uninstalling does not revoke Feishu authorization.
- Local previews may contain private content. Original source documents are not modified. Preserve publishing receipts: an unknown write result is deliberately not retried automatically, to avoid duplicate documents.

Conversation sources support incremental publishing when their history and identity permit it; Notion pages and imported files create document snapshots. Image upload, two-way sync and background monitoring are not implemented. Conversion limits and Feishu permissions can affect the result; readback verifies text, not pixel-perfect layout.

## Optional CLI, Skills and SDK

For agent-driven exports, automation and custom integrations, see the [CLI, Skills and SDK guide](docs/CLI-AND-SDK.md), [agent installation instructions](INSTALL.md), and [TypeScript interfaces](https://github.com/Hans-M-Yin/LarkAnything/tree/desktop-v0.1.3-preview.2/src/index.d.ts). These are optional paths with separate development/runtime requirements.

## Build from source

The standard desktop app uses Tauri, Rust and React and is maintained on `main`. The published preview remains pinned by tag `desktop-v0.1.3-preview.2`.

Follow the [Windows and Mac build instructions](docs/BUILD.md):

```bash
git clone https://github.com/Hans-M-Yin/LarkAnything.git
cd LarkAnything
npm ci
npm run check
npm run desktop:check
npm test
```

Native packaging additionally requires Rust and platform build tools. [The release workflow](.github/workflows/desktop-release.yml) builds Windows x64 and Apple Silicon installers, bundles the official CLI, and produces SHA-256 checksums. Historical Electron and SwiftUI implementations remain available in Git history; current desktop build entry points use Tauri.

MIT License. An independent community project, not affiliated with OpenAI, Anthropic, Feishu or Lark. Bundled components and fonts retain their respective licenses.
