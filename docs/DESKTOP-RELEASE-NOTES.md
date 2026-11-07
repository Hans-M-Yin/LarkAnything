面向 Windows x64 和 Apple Silicon Mac 的 LarkAnything 桌面预览版。

## 下载与安装

- **Windows**：下载 `LarkAnything_0.1.0_x64-setup.exe`，双击安装。
- **Apple Silicon Mac**：下载 `LarkAnything_0.1.0_aarch64.dmg`，打开后拖入 Applications。
- 无需 Git、Node.js、Rust 或 Xcode；安装包已包含官方飞书 CLI 1.0.98。首次打开按 App 引导配置自己的飞书应用和账号授权。
- 详细步骤见附件 `INSTALL.md`，完整性校验见 `SHA256SUMS.txt`。

## 本版内容

- Tauri 跨平台桌面架构、统一转换 Core 和可配置的飞书目标位置。
- Codex、Claude Code、Obsidian、OpenCode、Notion、Markdown 和 Word（DOCX）来源。
- 循环来源切换动画、离线字体、蓝青玻璃图标和配套界面。
- 修复 Windows EXE 内嵌图标未随界面更新的问题。
- 继续保留上传回读核验与未知结果禁止自动重传的机制。

## 预览版限制

Windows 尚未使用发布者证书签名；Mac 为 ad-hoc 签名，未完成 Apple Developer ID 签名和公证，系统可能提示未知开发者。请只从本仓库下载并使用系统批准入口，无需关闭系统安全保护。Mac 安装、授权和界面仍需真实设备验证。此次不提供 Intel Mac 或 Windows ARM 原生包。

Notion 令牌使用 Windows 凭据管理器 / macOS 钥匙串持久保存，飞书配置及 CLI 登录凭据也在重启后保留。旧版用户需重新连接 Notion 一次。DOCX 的图片与复杂版式不保真。飞书账号、租户权限和目标文件夹权限由使用者自行授权；安装包不含开发者凭据。
