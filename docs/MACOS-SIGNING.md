# macOS 签名与公证

拖拽窗口布局与 Apple 验证是两件事。DMG 使用 dmgbuild 写入固定 Finder 布局，不依赖 CI 上的 Finder 自动化；签名仍由 Tauri 执行。

## 当前模式

默认 `MACOS_SIGNING_MODE=adhoc`：可构建预览包，但没有 Developer ID 身份及 Apple 公证。`codesign --verify` 只验证签名结构，不表示 Gatekeeper 放行，也不表示已通过恶意软件检查。没有付费 Apple Developer Program 会员时，不能完成正式分发的 Developer ID 公证流程。

## 准备正式分发

1. 由项目所有者加入 [Apple Developer Program](https://developer.apple.com/programs/)，完成 Apple 要求的身份验证和协议。
2. 在自己的 Mac 生成 CSR，申请 **Developer ID Application** 证书（用于 App Store 之外的分发），安装到钥匙串；将证书及其私钥导出为带密码的 `.p12`。
3. 按 [Tauri 官方说明](https://v2.tauri.app/distribute/sign/macos/) 将 `.p12` 转为 base64，在 GitHub 仓库 Settings → Secrets and variables → Actions 中设置以下 **Secrets**，不要发到聊天、提交代码或上传 Release：

| Secret | 内容 |
| --- | --- |
| `APPLE_SIGNING_IDENTITY` | 完整的 `Developer ID Application: … (TEAMID)` 身份名称 |
| `APPLE_CERTIFICATE` | 包含私钥的 `.p12` 的 base64 内容 |
| `APPLE_CERTIFICATE_PASSWORD` | 导出 `.p12` 时设置的密码 |
| `APPLE_ID` | 用于公证的 Apple 账号邮箱 |
| `APPLE_PASSWORD` | Apple **App 专用密码**，不是账号登录密码 |
| `APPLE_TEAM_ID` | 开发者团队 ID |

4. 在同一页的 **Variables** 中设置 `MACOS_SIGNING_MODE=developer-id`。
5. 先手动运行 Desktop test packages。Tauri 负责导入证书、签名 App、提交公证并装订票据；自定义 DMG 包含这份经过公证的 App。
6. 打包流程会对原 App 和从实际 DMG 挂载出来的 App 分别执行 `codesign --verify`、`stapler validate`、`spctl --assess`。任何一步失败都会阻止附件发布，不会自动降级为 ad-hoc。

成功后再发布新版本。还需在真实 Mac 上通过浏览器下载、拖入 Applications 并启动，确认完整安装体验。公证只承诺 Apple 服务接受了提交，不替代功能测试。

## 本地构建

`bash scripts/tauri-mac-install.sh` 会创建项目内的 Python 虚拟环境并安装固定版本的 dmgbuild。正式签名使用同名环境变量和 `MACOS_SIGNING_MODE=developer-id`；不要把凭据写入脚本。普通用户下载 DMG 不需要安装 Python 或开发工具。

## 证据

CI 附件 `macos-dmg-verification` 记录实际磁盘映像中的应用、Applications 符号链接、图标坐标、背景及公证状态。`not-configured` 不得解释为正式安全验证已通过。开发者会员和证书尚未配置时，签名流程只能做配置校验，无法实际完成公证验收。
