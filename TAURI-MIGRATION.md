# LarkAnything 轻量桌面版

这份工作区从 2026-11-06 的最新源码复制，原 Electron 工作区保持原样。迁移前的源码 ZIP 和 SHA-256 清单位于原项目 `.larkanything/backups/latest-before-tauri-20261106/`。

## 架构与兼容

- React 页面、来源切换动画、主题、列表、可选预览及连接流程沿用现有实现。
- 原 Core、适配器、Markdown 渲染和防重复上传逻辑在 Web Worker 中运行。没有嵌入 Node.js、Electron 或另一份 Chromium。
- Tauri/Rust 提供原生文件读写、排他锁、进程启动/超时/取消、文件选择和窗口控制。CLI 通过参数和标准输入调用，不经过 shell。
- Node 路径实现按 MIT 许可保留 Windows/POSIX 行为；SHA-256 与原实现对照验证，保持会话身份和回执兼容。
- 仍使用 `~/.larkanything/config.json`、`desktop.json` 和原 state 目录。不要删除原回执；未确认的写入仍然禁止自动重传。
- 飞书 CLI 是独立依赖。优先使用设置中的路径；默认 `lark-cli` 会查找既有 `~/.larkanything/tools/node_modules/@larksuite/cli/bin/`、PATH 和 macOS Homebrew 常见路径。不会随 App 捆绑或重新实现。
- Windows 使用系统 WebView2，macOS 使用系统 WKWebView。视觉与动画需要在两端分别验收；不能承诺不同浏览器内核像素完全一致。

## Windows 开发与打包

### 窗口内快捷键

Windows 使用 Ctrl，Mac 使用 Command（⌘）。鼠标悬停在相关按钮上也可查看提示。

| 操作 | Windows | Mac |
| --- | --- | --- |
| 聚焦搜索并选中关键词 | Ctrl+F | ⌘F |
| 刷新当前列表 | Ctrl+R | ⌘R |
| Codex / Claude Code / Obsidian | Ctrl+1 / 2 / 3 | ⌘1 / 2 / 3 |
| 展开或收起预览 | Ctrl+P | ⌘P |
| 打开设置 | Ctrl+, | ⌘, |
| 关闭设置或连接弹窗 | Esc | Esc |

未选择内容时不会展开预览。准备或上传期间禁用刷新、来源切换、预览切换及设置快捷键；弹窗打开时不触发背景操作。预览正文内同样支持这些组合键，Ctrl/⌘+R 不会重载 App，Ctrl/⌘+P 不会打开打印窗口。没有新增上传快捷键或全局后台热键。

### 构建步骤

构建机需要 Node.js 22+、Rust stable、Visual Studio C++ Build Tools 和 Windows SDK。最终用户不需要 Node.js 或 Rust。

```powershell
npm ci
npm test
npm run desktop:check
npm run desktop:start
npm run desktop:package:win
```

安装程序在 `src-tauri/target/release/bundle/nsis/`。主程序是 `src-tauri/target/release/larkanything-desktop.exe`。Windows 安装器在系统缺少 WebView2 时联网安装共享运行库；体积报告应将 App 本体、安装器、系统共享运行库和独立 CLI 分开。

卸载用 Windows“设置 → 应用 → LarkAnything → 卸载”。不会删除 `~/.larkanything` 中的配置和回执，也不卸载独立 CLI。再次安装可继续测试。

本机迁移过程使用原项目 `.larkanything/toolchains/` 中的隔离 Rust 1.99.1 工具链，没有修改系统 PATH。若继续使用该工具链，请为终端设置 `RUSTUP_HOME`、`CARGO_HOME`、`RUSTUP_TOOLCHAIN=1.99.1`，并把该 `CARGO_HOME/bin` 临时加入 PATH；普通开发者直接使用自己的 Rust 安装即可。

## Apple Silicon Mac

安装 Xcode Command Line Tools（`xcode-select --install`）、Node.js 22+、Rust，确保 `rustup target add aarch64-apple-darwin` 已完成，然后：

```bash
bash scripts/tauri-mac-install.sh
```

脚本构建 ARM64 的 `.app` 和 `.dmg`。完成后打开 DMG，将 App 拖入 Applications。测试后卸载：

```bash
bash scripts/tauri-mac-uninstall.sh
```

未配置开发者签名与公证的构建仅用于测试；正式分发需要相应平台的签名。Mac 安装、授权凭证访问和 WKWebView 动画效果仍需在真实 Mac 验证。

## 自动验证

```powershell
npm test
npm run desktop:check
npm run desktop:build
cargo build --manifest-path src-tauri/Cargo.toml
npm run desktop:smoke
```

Windows smoke 测试启动真正的 Tauri/WebView2，使用隔离配置与本地模拟 CLI，验证内容转换一致、预览显示、图标等宽、主题、设置持久化、模拟上传回读、未知结果不重传、排他锁、路径权限、超时和取消。不会上传用户文档或修改用户配置。

历史 Electron/SwiftUI 文件暂留作参考；本副本 `desktop:*` 的默认构建和打包入口均为 Tauri。请以本文件为桌面迁移后的操作说明，不使用历史 native 或 Electron 打包脚本。

## 2026-11-06 Windows 验证结果

- 优化后的主程序：3,533,312 字节（3.53 MB / 3.37 MiB），UI 和 Core 均嵌入其中。
- NSIS 安装包：1,392,769 字节（1.39 MB / 1.33 MiB）。
- 不包含独立飞书 CLI、系统共享 WebView2、用户数据及运行缓存。安装后的卸载器等辅助文件会增加少量占用。
- 119 项 Node 测试：116 通过、3 跳过；Core 与 UI 类型/语法检查通过。
- 真正的 Tauri + WebView2 测试通过：Core 预览与原 Node 服务逐字节一致；图标等宽、中文/emoji 正文显示、主题、设置保存、模拟上传与回读、不确定结果禁止重传、排他锁、路径权限、进程流式输出/取消/超时、减少动态效果设置。
- Release 程序启动通过：嵌入资源、原生 IPC、读取现有用户设置正常。没有发起真实上传或新授权。
- 原项目备份清单中的 111 个文件逐项校验，全部未被修改。备份、迁移副本、构建工具及用户状态分开保存。
- Mac 构建与 WKWebView 验收尚未执行，真实飞书发布仍需用户在新 App 中测试。

## 新增来源：OpenCode、Notion、Markdown 与 Word

- OpenCode：通过本机官方原生 CLI 的只读命令列举和导出会话；支持 1.x / 2.x 导出命令差异。PATH 无法找到时，在设置中选择原生可执行文件（Windows 为 `.exe`，不运行 `.cmd` 包装脚本）。未知导出结构会明确报错。
- Notion：在设置中输入集成令牌，并在 Notion 为所需页面添加该连接。令牌只留在本次运行内存中，重启后需要重新连接。列表读取全部搜索分页；正文使用官方 Markdown API。不完整返回会阻止上传。尚未实现公共 OAuth 登录与系统钥匙串持久化。
- Markdown / Word：在“更多来源”选择对应入口，点击“选择文件”，原生选择器分别限定 `.md` / `.docx`，不需要选择文件夹，也不要求安装 Word。文件只保留在本次运行的列表，预览时重新读取，单个文件上限 20 MB。
- Word：提取正文、标题、列表和表格；复杂版式、图片、页眉页脚、批注与修订语义不保真，预览界面显示转换提示。加密、旧版 `.doc` 和无效文件不支持。
- 新来源统一进入 Core 的格式转换、冻结预览和回执流程；OpenCode 使用会话增量同步，Notion 和文件使用快照创建。原有未知写入结果禁止重传规则不变。

参考：[OpenCode CLI](https://opencode.ai/docs/cli/)、[Notion Search](https://developers.notion.com/reference/post-search)、[Notion Markdown](https://developers.notion.com/reference/retrieve-page-markdown)。

新增来源验证：124 项 Node 测试中 121 通过、3 跳过；前端类型检查、项目检查、Rust 编译通过。真实 Tauri/WebView2 隔离测试覆盖 Markdown / DOCX 文件导入、OpenCode 模拟 CLI 的列表与预览，以及既有上传回读、防重复写入和键盘交互。Notion 使用模拟分页 / 错误数据测试，尚未使用真实 Notion 令牌进行端到端验证；本次没有真实上传文档。

来源栏改为三个等宽槽位的循环滑轨：点击右侧来源整排左移一格，左侧反向，选中项居中；更多菜单及原有快捷键同样驱动滑轨。首尾循环以视口外副本复位，减少动态效果设置下即时切换，视口外项目不进入 Tab 顺序。动画回归覆盖中途位移、首尾往返、窄窗口布局、菜单关闭与减少动态效果。

## 视觉精修

应用图标源文件为 desktop/assets/larkanything.svg，图形结合 L 形与上行箭头。通过 Tauri icon 命令生成 Windows ICO / macOS ICNS。界面采用青绿色点缀和中性色背景。

Inter Variable 与 Noto Sans SC 常用字子集离线打包，后者改名 Lark UI CJK，约 1.96 MB；加上 Inter 约 2.31 MB。生僻字使用系统中文字体回退。字体原始许可证随应用分发，中文子集构建脚本为 scripts/prepare-ui-font.py。

列表摘录去除 Markdown 标记和重复标题，日期显示今天／昨天并保留悬停完整时间。文档预览复用界面字体、去除相同的重复标题；这些显示调整不改动上传快照或原文。设置中 Notion 和高级来源参数折叠展示。

## 最终玻璃折页图标与配套界面

采用用户选定的蓝青玻璃折页图案。desktop/assets/brand/larkanything-icon.svg 是图标导出入口，嵌入已批准母图并沿圆角轮廓裁切；圆角外 Alpha 为 0，内部保持不透明。使用 Tauri icon 导出 PNG / ICO / ICNS，界面使用 desktop/assets/larkanything.png。此前纯白外围方案未用于此交付。

标题栏、欢迎页、飞书连接引导使用同一图标；按钮、选中态、焦点环、来源栏和深色主题统一为蓝青冷色系。字体和来源轮转逻辑沿用已验证版本。
