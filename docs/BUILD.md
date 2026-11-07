# 开发、测试与打包

标准桌面源码位于 `main`。普通用户直接下载 [Release 安装包](https://github.com/Hans-M-Yin/LarkAnything/releases)，无需以下构建步骤。

## 环境与启动

需要 Node.js 22+、npm、Rust stable。Windows x64 还需要 Visual Studio C++ Build Tools、Windows SDK 和 WebView2；Apple Silicon Mac 需要 Xcode Command Line Tools（`xcode-select --install`）及 `rustup target add aarch64-apple-darwin`。

打包机器的平台与架构必须匹配目标，避免捆绑错误架构的 CLI。不要跨机器复制 node_modules。

```bash
git clone https://github.com/Hans-M-Yin/LarkAnything.git
cd LarkAnything
npm ci
npm run check
npm run desktop:check
npm test
npm run desktop:start
```

## Windows 安装包

```powershell
npm run desktop:package:win
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-windows-icon.ps1 -ExePath src-tauri/target/release/larkanything-desktop.exe
```

输出在 `src-tauri/target/release/bundle/nsis/`。应分发安装程序，不能只复制主 EXE：内置 CLI 等资源由安装器一并部署。缺少 WebView2 时安装器会联网安装。

## Apple Silicon DMG

```bash
bash scripts/tauri-mac-install.sh
```

输出在 `src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/`。脚本默认使用 ad-hoc 签名；可通过 APPLE_SIGNING_IDENTITY 指定自己的签名身份。正式分发仍需相应证书和 Apple 公证。

卸载可将 App 移到废纸篓，或运行 `bash scripts/tauri-mac-uninstall.sh`。保留用户设置、回执及独立安装的 CLI。

## 内置连接组件

`scripts/prepare-tauri-release.mjs` 在开发启动与打包前校验官方 CLI 1.0.98 的平台、架构和 SHA-256，缺失时调用官方下载安装流程，再构建 UI。只打包原生程序、许可证和清单，不复制用户凭据。

可通过 `node scripts/prepare-desktop-cli.mjs --from-package <package-directory>` 复用可信官方包。Windows 资源位于安装目录 `lark-cli/lark-cli.exe`，Mac 位于 `Contents/Resources/lark-cli/lark-cli`。明确指定的自定义 CLI 路径优先。

## 验证

```bash
npm run desktop:build
npm run desktop:setup:smoke
```

连接引导测试自行生成带模拟宿主 API 的界面，不访问真实授权。Windows 使用系统 Edge，其他平台需 Playwright Chromium。

Windows 原生 smoke 还需生成完整 debug 程序：

```powershell
node scripts/prepare-tauri-release.mjs
cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo build --manifest-path src-tauri/Cargo.toml --locked
npm run desktop:smoke
node desktop/source-switcher-smoke.mjs
```

原生 smoke 当前仅覆盖 Windows/WebView2，使用隔离配置与模拟 CLI；Mac 仍需真机验收。单独 desktop:build 只生成 UI / Worker，不准备原生打包资源。

## 持续集成与历史

- CI：Core / SDK 检查与测试。
- Desktop test packages：可在 main 手动触发 Windows / Mac 安装包构建。
- Desktop release installers：推送 desktop-v* 标签后构建并验证两个平台，上传含 SHA-256 清单的 Release 草稿；确认结果后公开发布。

已发布 desktop-v0.1.0-preview.1 安装包保持原样。旧 main 标签是 legacy/pre-tauri-main-20261107；旧 Electron / SwiftUI 实现保留在历史提交和发布标签中，已移出当前构建入口。
