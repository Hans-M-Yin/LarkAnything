# LarkAnything 标准桌面版

`main` 使用 Tauri + Rust + React。Windows 使用系统 WebView2，macOS 使用 WKWebView；App 不内嵌 Node.js 或 Chromium。安装包包含官方原生飞书 CLI、许可证与校验清单。普通用户见[安装说明](DESKTOP-INSTALL.md)，开发者见[构建说明](BUILD.md)。

## 架构与来源

React 负责来源列表、预览、设置与连接引导。共享 Core 和适配器在 Web Worker 中运行，Rust 提供受约束的文件操作、文件选择、进程运行、窗口控制与网络代理。预览正文不能直接调用原生接口。

Codex、Claude Code、Obsidian、OpenCode、Notion、Markdown 和 DOCX 统一进入 Core 转换、冻结预览和发布回读流程。来源图标用于选择内容，不代表连接到其他 App 的活动窗口。Markdown / DOCX 使用限定格式的原生选择器；Notion 令牌仅保留在当前运行内存中。

CLI、个人 Skill 与 JavaScript SDK 继续使用同一 Core。对话身份、消息哈希和回执保持兼容；写入结果未知时禁止自动重传。

## 配置与连接

配置保存在 `~/.larkanything/config.json`，来源路径保存在 `desktop.json`，上传状态保存在配置指定的 state 目录。界面可设置飞书目标、来源目录、CLI 路径及工具日志；主题偏好使用 WebView 本地存储。

首次连接按“连接组件 → 飞书应用 → 账号授权”完成。默认使用内置 CLI，用户明确配置的路径优先；旧路径失效时可选择“使用内置连接组件”。应用创建与账号授权由本人在浏览器完成。

App Secret 经标准输入交给官方 CLI，不进入命令行参数或 LarkAnything 配置。CLI 管理系统凭据。新连接先写入独立目录，验证成功后才启用；Core 发布与授权使用同一连接配置目录。安装包不包含开发者凭据。

## 交互与验证

默认窗口约 420 × 560，预览展开后加宽。来源栏是三个等宽槽位的循环滑轨，支持更多来源菜单及减少动态效果。明暗主题、离线字体和玻璃图标统一打包。

Windows 使用 Ctrl、Mac 使用 Command：F 搜索，R 刷新，1 / 2 / 3 选择 Codex / Claude Code / Obsidian，P 切换预览，逗号打开设置，Esc 关闭弹窗。

Windows 原生 smoke 使用隔离数据和模拟 CLI，覆盖 Tauri/WebView2、Core 预览、上传回读、防重复写入、路径权限、排他锁、超时与取消。Mac 安装、授权与 WKWebView 显示仍需真机验证。

附件上传、复杂 DOCX 版式、自动更新和后台监控尚未实现。请保留上传回执。Windows 的可选登录重置测试工具保留在 `scripts/build-reset-login-windows.ps1`，正常安装无需使用。
