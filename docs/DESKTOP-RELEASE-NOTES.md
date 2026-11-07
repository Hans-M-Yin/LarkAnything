面向 Windows x64 和 Apple Silicon Mac 的 LarkAnything 桌面预览版。

## 下载与安装

- **Windows**：下载 `LarkAnything_0.1.2_x64-setup.exe`，双击安装。
- **Apple Silicon Mac**：下载 `LarkAnything_0.1.2_aarch64.dmg`，打开后拖入 Applications。
- 无需 Git、Node.js、Rust 或 Xcode；安装包已包含官方飞书 CLI 1.0.98。首次打开按 App 引导配置自己的飞书应用和账号授权。
- 详细步骤见附件 `INSTALL.md`，完整性校验见 `SHA256SUMS.txt`。

## 本版内容

- 修复 GitHub Actions 生成 DMG 时未应用 Finder 布局的问题：固定 App 与 Applications 图标、箭头背景和拖拽提示。
- 挂载实际 DMG 校验应用、Applications 快捷链接、图标位置和背景，校验失败则停止发布。
- 接入可选 Developer ID 签名与公证流程；本次尚无开发者证书，仍为 ad-hoc 预览包，会出现 Apple 验证提示。

- Notion 令牌安全持久化：Windows 凭据管理器 / macOS 钥匙串；重启自动读取，支持更新和删除。
- 保留飞书连接配置及登录凭据，新增配置恢复回归验证。
- 修复 Word 本地化标题、表格段落分隔与 XML 校验，明确超链接丢失提示。
- 适配 OpenCode V1 / V2 的版本标识与会话格式，修复时间戳处理。
- 修复 Notion 分页异常处理，细分令牌失效与页面权限错误。
- 刷新已选择文件时更新摘要与修改时间，并标注不可读取的文件。
- 增加自动评测、问题台账及 Windows 原生界面和真实飞书上传验证记录。

## 升级

退出旧版后安装新版。保留原有 App 数据目录即可继续使用飞书配置与上传回执。旧版 Notion 令牌只在内存中，升级后需重新连接一次，之后重启无需再次输入。

## 预览版限制

Windows 尚未使用发布者证书签名；Mac 为 ad-hoc 签名，未完成 Apple Developer ID 签名和公证，系统可能提示未知开发者。请只从本仓库下载并使用系统批准入口，无需关闭系统安全保护。Mac 安装、授权和界面仍需真实设备验证。此次不提供 Intel Mac 或 Windows ARM 原生包。

Notion 令牌使用 Windows 凭据管理器 / macOS 钥匙串持久保存，飞书配置及 CLI 登录凭据也在重启后保留。旧版用户需重新连接 Notion 一次。DOCX 的图片与复杂版式不保真。飞书账号、租户权限和目标文件夹权限由使用者自行授权；安装包不含开发者凭据。
