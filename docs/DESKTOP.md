# LarkAnything Desktop — macOS ARM64 测试版

Mac 原生开发路线已切换为 SwiftUI / AppKit，请优先阅读 [原生 Mac 指南](NATIVE-MAC.md)。本文描述保留的 Electron 原型，命令与安装包不等同于原生版。

桌面端使用 Electron + React + TypeScript，共用现有 Core。当前支持 Codex / Claude Code 本地会话、Obsidian Markdown 文件；设置写入 `~/.larkanything/config.json`，来源目录写入 `~/.larkanything/desktop.json`。已有配置与发布回执复用。内容索引与预览含私人内容，只存本机。

## 开发

需要 Node.js 22 或更新版本。在项目根目录运行：

```bash
npm ci
npm run desktop:build
npm run desktop:start
```

## Apple Silicon Mac 打包

把源码与 package-lock.json 复制到 Mac（不要复制 Windows 的 node_modules 或私人 `.larkanything` 数据）。在 Mac 项目目录执行：

```bash
npm ci
npm run desktop:check
npm test
npm run desktop:smoke
npm run desktop:package:mac
```

输出：`.larkanything/releases/LarkAnything-0.1.0-mac-arm64.dmg`。
仓库也提供手动触发的 `macOS desktop test package` GitHub Actions 工作流，生成未签名 ARM64 测试包；需要先将代码推送到自己的仓库，再手动触发。工作流不会发布 GitHub Release。
打开 DMG，把 LarkAnything 拖到 Applications，再运行应用。无签名测试包可能被系统拦截，请使用 macOS 系统设置中的针对该应用的“仍要打开”，不要全局关闭 Gatekeeper。正式公开分发需配置 Apple Developer 签名、公证；当前不配置自动更新。

## 飞书连接

此测试版复用已安装、已授权的官方 Lark CLI，不把它打包进应用。按 INSTALL.md 完成 LarkAnything CLI 安装和飞书授权后启动桌面端，即可读取安装器生成的 CLI 路径。若单独安装 CLI，在设置中选择其原生可执行文件的绝对路径（不能选择 Windows 的 .cmd 启动脚本）。macOS Finder 启动环境通常不包含终端 PATH，建议始终选择绝对路径。

## 功能验证

1. 首次打开后选择来源目录；Obsidian 选择 Vault。检查列表、搜索、时间与摘录。
2. 选择一项，核对预览。文件仍在编辑时，发布使用此前生成的冻结快照。
3. 设置飞书文件夹链接，保存后重新选择内容；确认目标位置。
4. 点击上传，等待上传和回读完成，再打开结果链接。对话新增消息可继续同步；笔记按新内容创建文档，相同快照复用回执。
5. 重启应用，核对配置和原会话同步关联。失败时保留预览并重试；写入结果未知时由 Core 阻止自动重放。
6. 测试中文路径、长文档、多 Vault 同名文档、网络断开、撤销飞书授权、窗口缩放、键盘操作和减少动态效果。

## 当前边界

- 使用标准可缩放窗口；托盘常驻、深色主题、品牌图标、应用内授权与自动更新仍待完善。
- 首次列表索引读取来源内容，后续按大小与修改时间使用缓存。大历史库需进一步改为后台分页索引。
- 文件时间明确来自磁盘。Obsidian 只读取已保存 Markdown；双链、嵌入、附件保留说明，未进行资源上传。
- 配置目前提供一个默认飞书位置，高级 profiles 继续保留在配置文件中。
- 自动化测试与 Windows 实测不能替代 macOS 的安装、权限与签名验证。
