# macOS 原生版（SwiftUI / AppKit）

> 此路线已停止作为主界面开发，保留用于历史参考。新版 Windows / macOS 共用 Electron + React 界面，请使用 [桌面版指南](DESKTOP.md)。本文的 native 命令与旧版 macOS Bash 安装脚本仍会构建原生原型。

Mac 原生界面使用 SwiftUI MenuBarExtra、NavigationSplitView、List、Toolbar、Form 和 AppKit 文件选择器。文档预览使用禁用 JavaScript 与外部导航的 WKWebView。Core 作为随包附带的 Node 辅助进程，通过私有标准输入输出通信；没有开放 HTTP 端口。

## 支持范围

- 当前构建目标：Apple Silicon ARM64；部署基线暂定 macOS 13。
- Xcode 15 / Swift 5.9 或更新版本可构建传统原生界面。
- Liquid Glass 路径需要 Xcode 26 / Swift 6.2 或更新 SDK，并运行在 macOS 26 或更新系统。旧系统回退为标准原生按钮与材质。
- Apple 标准组件随系统演进；布局、操作含义与 Core 行为一致。不自行模拟玻璃。实际系统外观仍需 Mac 实机验证。
- 运行 App 不要求用户安装 Node；构建机需要 Node.js 22+ ARM64 和 Xcode。

## 在你的 Mac 上构建

### 一键安装与卸载（推荐）

在 Mac 拉取本分支后执行。脚本需要已安装的 Xcode 与 ARM64 Node.js 22+，不使用 sudo，也不自动更新 Git 分支。

```bash
git pull --ff-only
bash scripts/macos/install.sh
```

安装脚本依次执行 `npm ci --omit=dev --ignore-scripts`、`npm test`、`npm run native:build`，验证签名后安装到 `~/Applications/LarkAnything Native Test.app` 并打开。加 `--no-open` 可只安装不启动。重新执行可更新本脚本安装的旧版本，构建失败时保留旧 App。

测试后先从菜单栏退出 LarkAnything，再卸载：

```bash
bash scripts/macos/uninstall.sh
```

需要下一轮完全重新编译 Swift 时：

```bash
bash scripts/macos/uninstall.sh --clean-build
git pull --ff-only
bash scripts/macos/install.sh
```

卸载只移除脚本管理的测试 App；`--clean-build` 额外清理当前仓库 `native/macos/.build`。保留飞书授权、`~/.larkanything` 配置与发布回执，避免丢失原文档同步关联。也保留源码、构建日志与 DMG。通过 DMG 手动拖入 `/Applications` 的 App 不由这套脚本卸载。

### 分步构建

将源码解压到 Mac；不要复制 Windows 的 node_modules。推荐使用 nodejs.org 提供的独立 ARM64 Node。Homebrew Node 若依赖外部动态库，脚本会停止并说明原因，避免生成只能在构建机运行的安装包。

```bash
node -p "process.platform + ' ' + process.arch"
xcrun swift --version
xcrun --sdk macosx --show-sdk-version
npm ci --omit=dev --ignore-scripts
npm test
npm run native:build
```

最后一条会编译 Swift、打包 Core 与生产依赖、复制 Node，并输出 `.app` 的绝对路径。用 Finder 打开这个 `.app`，或运行 `open "输出的.app路径"`。

运行正常后生成 DMG：

```bash
npm run native:package:mac
```

产物：`.larkanything/releases/LarkAnything-Native-0.1.0-arm64.dmg`。
这是本地临时签名测试包，尚非 Developer ID 签名 / 公证后的正式分发包。应用图标暂使用系统默认，自动更新未接入。

## 连接飞书

继续复用现有 `~/.larkanything/config.json` 与官方 Lark CLI 授权。首次安装按 INSTALL.md 完成连接，在原生设置中选择 CLI 的原生可执行文件。当前未随包分发 Lark CLI，也未提供原生登录向导；Node 运行时已经随包附带。

## Mac 验收清单

1. 打开应用与菜单栏图标，检查原生列表、窗口缩放、搜索、快捷键、设置与文件选择器。
2. 选择 Obsidian Vault，打开含代码、表格、公式的笔记；预览应可读，页面链接不应导航到外部。
3. 切换 Codex / Claude Code，选择会话；来源变更和设置保存后清除旧预览。
4. 设置目标飞书文件夹，选择一项发布，确认回读成功、结果链接与二次同步。
5. 切换浅色 / 深色、减少透明度 / 减少动态效果；在 macOS 26+ 检查系统工具栏和发布按钮的新材质。
6. 退出再打开，验证配置和回执保留。后台处理期间退出会被阻止，避免中断写入。
7. 关闭主窗口，确认菜单栏入口可重新打开资料库；从 DMG 拖入 Applications 后重复测试。

Windows 已验证 stdio 协议与 Core 集成，不代表 Swift 编译、WKWebView 或原生材质已通过实机验证。遇到问题请提供构建日志、macOS 与 Xcode 版本。

## 开发边界

`native/bridge.mjs` 仅允许 settings/list/preview/publish/saveSettings，串行执行请求，保留 Core 的冻结计划与未知写入保护。Swift 客户端负责本地辅助进程生命周期，不包含来源解析或飞书写入规则。React/Electron 原型继续保留，Mac 原生包不包含 Chromium、React 或 Electron。
