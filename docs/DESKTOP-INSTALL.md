# 安装 LarkAnything 桌面版

普通用户下载 GitHub Release 中的安装包即可，不需要克隆仓库、执行构建命令或安装 Node.js、Rust、Xcode。安装包内含官方飞书 CLI 1.0.98，不包含任何开发者的应用密钥、登录令牌或用户文档。

## Windows

下载名称含 `x64-setup.exe` 的文件，双击并按向导安装。支持 Windows x64；ARM 设备本次没有单独提供原生安装包。若系统没有 WebView2，安装器会联网安装微软共享运行库。

## Apple Silicon Mac

下载名称含 `aarch64.dmg` 的文件，打开后把 LarkAnything 拖入 Applications（应用程序），再从应用程序启动。支持 Apple Silicon（M 系列芯片）、macOS 13 或更高版本；此次不提供 Intel Mac 安装包。

这是预览版：Windows 尚未进行发布者证书签名；Mac 使用 ad-hoc 签名，尚未完成 Apple Developer ID 签名及公证。系统可能提示无法验证开发者。确认从本仓库的 Release 下载后，可使用系统提供的批准入口；macOS 对应“系统设置 → 隐私与安全性 → 仍要打开”。组织策略可能禁止该操作，不需要关闭系统安全保护。Mac 的真实设备安装、钥匙串授权和显示效果仍需测试。

## 首次使用

1. 打开 App，在连接引导中配置飞书应用：可以创建应用，也可以使用自己的 App ID 和 App Secret。企业权限限制可能需要管理员协助。
2. 点击连接飞书，在浏览器中完成本人账号授权，再返回 App 确认。
3. 选择内容来源与会话或文件，预览后上传。可以在设置中配置目标文件夹。

首次授权和上传需要联网。无需安装独立 CLI，也无需凭证修复程序。已有用户手动设置的 CLI 路径仍优先使用；若该旧路径失效，在高级设置中恢复为默认 `lark-cli` 即可使用随包版本。

## 更新与卸载

- Windows：退出 App，运行新版安装包更新；卸载通过“设置 → 应用 → LarkAnything”。
- Mac：退出 App，用新版替换 Applications 中的应用；卸载时把应用移到废纸篓。
- 卸载保留 `~/.larkanything` 中的用户设置和上传回执，避免更新后重复上传。删除 App 不等于撤销飞书授权。

Release 同时提供 `SHA256SUMS.txt`，可核对安装包下载完整性。开发者构建说明见 [BUILD.md](BUILD.md)，当前标准源码在 `main`。
