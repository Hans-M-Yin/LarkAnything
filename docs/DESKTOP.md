# LarkAnything 跨平台桌面版

当前主界面使用 Electron + React + TypeScript，Windows 和 macOS 共用 UI 与 Core。
SwiftUI / AppKit 版本保留为历史原型，不再作为主路线。

界面采用接近 Codex 的中性色小窗口布局：默认约 420 × 560，顶部横向切换来源、中间单列内容、底部上传。预览默认收起，点击后窗口展开至约 860 像素宽，收起时恢复原尺寸。支持 Codex / Claude Code 本地会话和 Obsidian 已保存 Markdown；来源图标用于选择数据来源，不代表已连接到正在运行的 App，也不读取当前窗口。

## Windows 本机运行

下载打包好的桌面版后，保留并解压整个 `win-unpacked` 文件夹，打开 `LarkAnything.exe`。桌面包自带官方飞书 CLI，不需要另装 Node.js、npm 或运行凭证修复工具。下方命令仅供从源码开发和打包使用。

需要 Node.js 22 或更新版本。在项目根目录执行：

```powershell
npm ci
npm run desktop:start
```

构建可直接运行的 x64 测试包：

```powershell
npm run desktop:check
npm run desktop:build
npm run desktop:smoke
npm run desktop:package:win
& '.\.larkanything\releases\win-unpacked\LarkAnything.exe'
```

保留整个 `win-unpacked` 文件夹，不能只复制 exe。这个测试包免安装、未签名，暂未生成安装向导或自动更新。关闭应用后删除整个测试包目录即可卸载；配置和发布回执仍保留，下一次测试可继续复用。不要删除回执来重新测试上传，否则可能失去已有文档的同步关联。

开发启动会先构建 UI。配置默认保存在用户目录的 `.larkanything/config.json`，来源路径在 `.larkanything/desktop.json`；明暗偏好保存在 Electron 用户数据目录。设置弹窗可修改保存位置、来源目录、CLI 路径和工具日志开关，取消不写入配置。Windows 开发与打包测试包共用同一 Core 配置。

## Apple Silicon Mac 打包

在 Mac 上拉取源码后执行（不要复制 Windows 的 node_modules）：

```bash
npm ci
npm run desktop:build
npm run desktop:check
npm run desktop:smoke
npm run desktop:package:mac
```

输出 `.larkanything/releases/LarkAnything-0.1.0-mac-arm64.dmg`。拖入 Applications 安装；退出后将应用移到废纸篓可卸载，Core 配置与回执保留。仓库中的旧 `native:*` 命令、`scripts/macos/install.sh` 属于 SwiftUI 原型，不适用于新版跨平台界面。

当前 DMG 为未签名测试包，正式分发仍需 Apple 签名和公证。Windows 实测不能替代 Mac 安装、标题栏、权限与系统行为验证。

## 飞书连接与使用

首次启动会检查当前 App 能否读取飞书凭证，并在需要时打开连接引导。也可随时从“设置 → 配置飞书连接”重新进入。

1. **连接组件**：优先保留用户已配置的 CLI；没有自定义路径时使用安装包内置的官方 CLI。自定义路径失效时，可选择“使用内置连接组件”。
2. **飞书应用**：新用户可点击“开始创建应用”，打开官方配置页面并按提示完成；已有应用可填写 App ID 和 App Secret。检测到现有应用但凭证不可读时，仅允许修复该应用，避免无意切换已有文档的账号归属。
3. **账号授权**：点击“授权飞书账号”，在浏览器确认后回到 App 点击“我已完成授权”。App 随后执行账号读取和创建预检；通过后点击“开始使用”。已有可用授权会复用。

所有配置和授权进程均由桌面 App 启动。App Secret 通过标准输入交给 CLI，不进入命令行参数、LarkAnything 配置或日志；设备授权码只保存在主进程内存。官方 CLI 管理系统凭证存储。新应用配置先写入 `~/.larkanything/connections/<id>/`，检查成功后才在共享配置中启用 `backends.lark-cli.configDir`；原有 CLI profiles 和发布回执不会被初始化操作覆盖。Core 上传、账号授权和个人 Skill 启动器使用同一个配置目录。

应用创建需要网络及租户允许的创建权限，账号授权只请求文档和云盘领域。失败时界面保留重试入口；“停止等待”会终止本地配置进程，不删除浏览器中可能已创建的应用。若已创建，可选择“使用已有应用”继续。连接引导可稍后完成，本地浏览和预览仍可用。

“检查飞书连接”从当前桌面进程执行真实账号读取与创建预检，不上传测试文档。终端登录成功不等于桌面启动环境能读到同一份凭证；出现 `token_missing` 时应在实际使用的 App 内连接，并在退出、重新打开后检查。上传前检查失败不会创建写入回执，已有不确定回执仍保留并阻止自动重传。

连接后，点击来源图标读取本地列表；Obsidian 在设置中指定 Vault。搜索并选择内容，查看经 Core 转换的冻结快照，确认保存位置，再点击上传并等待回读校验。

对话新增消息可继续同步；笔记修改后创建新文档，相同快照复用回执。预览和索引只存本机，用户点击上传才写入飞书。

## 视觉与交互

来源切换栏仅展开选中项的名称，其他项保留图标（悬停可查看名称）；宽度和名称使用约 240 ms 的过渡。超过三个来源时出现“更多来源”，列表可滚动，从中选择后当前来源进入顶部第三个位置。现有版本仍只适配 Codex、Claude Code 和 Obsidian，此布局不代表新增适配。

- 中性色、扁平图标、弱边框；初始主题跟随系统，手动切换后记住偏好。
- 约 160–260 ms 的悬停、来源指示器滑动、内容淡入和弹窗过渡；加载骨架屏与上传反馈。
- 遵循系统减少动态效果偏好；设置弹窗支持焦点约束和 Escape 取消。
- 品牌与界面图标离线打包，许可见 [第三方声明](../desktop/THIRD-PARTY-NOTICES.md)。

## 验证与边界

Windows 反复测试首次使用时，可运行 `powershell -ExecutionPolicy Bypass -File scripts/build-reset-login-windows.ps1` 构建 `.larkanything/Reset-LarkAnything-Login.exe`。先完全退出 App，再从资源管理器运行该工具，让清理操作使用实际桌面的凭证环境。它每次读取当前 `config.json` 中的独立连接目录，调用官方 CLI 退出登录、移除应用凭证并核验条目已移除，随后重置界面缓存与首次引导。重新登录后仍可重复清理，没有登录时重复运行也会成功。上传回执、来源内容、浏览器登录和云端文档保留；这不是云端应用删除工具。共享 CLI 配置或外部连接目录会停止清理，避免影响其他程序。正常安装不需要运行此测试工具。

清理逻辑的隔离回归用例位于 `scripts/windows/ResetLoginTests.cs`，覆盖重新登录后重置、重复重置、回执保留、失败重试和共享配置保护；这些用例模拟 CLI 与凭证检查，不触及真实登录。

`desktop:smoke` 使用隔离的测试来源和配置，检查 Electron IPC、本地发现、Core 预览、搜索、空状态、离线图标、主题、设置取消/保存、目标位置和紧凑窗口；不执行远程上传。截图位于 `.larkanything/desktop-smoke/`。

`desktop:setup:smoke` 使用模拟授权检查首次引导、浏览器交接、账号授权和已有连接复用；Windows 使用系统 Edge，其他平台需准备 Playwright Chromium。它不会创建真实应用或上传文档。打包脚本在构建阶段准备固定版本官方 CLI 并校验发布包，再把原生程序、许可证和哈希清单放入 `resources/lark-cli/`；`beforePack` 检查版本、目标架构和哈希。下载不可用时，开发者可显式运行 `node scripts/prepare-desktop-cli.mjs --from-package <已可信安装的官方 CLI 包目录>`，随后直接运行 electron-builder。此入口只复用程序，不复制凭证。

首次列表索引会读取来源内容，后续按文件大小与修改时间缓存；大历史库的后台分页索引、托盘、签名安装器和自动更新尚未实现。Obsidian 附件与双链保留说明，尚未上传附件。配置提供一个默认飞书位置，高级 profiles 保留在原配置中。
