# 自动评测与问题台账

最后更新：2026-11-07。评测分支：`codex/source-evaluation`。

目标是验证“选择来源 → 读取 → Core 转换 → 预览 → 发布 → 回读”，并持续保存失败、修复和复测证据。模拟测试通过不等于真实 App 或账号验收通过。

## 本轮结论

- 首轮 12 项专项测试：4 通过、8 失败；8 项缺陷均已修复并加入回归。
- 扩展后的专项测试 17/17 通过；全量 141 项中 138 通过、3 项在 Windows 上按现有规则跳过（CLI 子进程发布/增量/分段测试）。语法、类型和桌面构建检查通过。
- 官方 OpenCode CLI 实测额外发现 2 项 V2 兼容缺陷，已修复。Windows 1.19.5 / 2.2.6 的合成会话导入、真实列表、真实导出及适配器读取通过。
- Word 超链接目前仍仅保留文字；修复是明确告知链接目标未保留，不表示已实现链接还原。
- Tauri/WebView2 原生窗口通过桌面冒烟测试；数据与飞书 CLI 为测试替身。
- 尚未完成所有来源的真实账号验收，也未把本轮修改发布到安装包。

## 可重复运行

在项目根目录：

```sh
npm ci --ignore-scripts
npm run evaluate:sources -- local
npm test
npm run check
npm run desktop:check
npm run desktop:setup:smoke
```

专项评测每次新建 `.larkanything/evaluation/<UTC时间>-<标签>/report.json`，保留用例编号、数据来源、状态、耗时、错误、Git 提交及关键源码哈希，不覆盖前次报告。完整测试入口 `npm test` 同样包含这些回归用例。

CI 在 Windows / macOS / Linux、Node 22 / 24 上运行专项评测，上传报告保存 14 天。该工作流修改尚待提交到远端后执行，本轮不能据此宣称已通过跨平台 CI。

Windows 原生窗口测试需要 Rust、WebView2 和已准备的飞书 CLI 构建资源：

```sh
node scripts/prepare-tauri-release.mjs
cargo build --manifest-path src-tauri/Cargo.toml --locked
npm run desktop:smoke
```

如使用共享 Rust 构建缓存，构建和冒烟测试必须使用同一个 `CARGO_TARGET_DIR`。测试创建隔离的桌面配置、源文件、WebView 数据和模拟 CLI，不使用日常登录记录。结果在 `.larkanything/tauri-smoke-*/result.json`，截图在同目录。文件导入使用测试 API，**尚未自动操作系统文件选择器**。

官方 OpenCode CLI 验证（Windows x64，安装在项目忽略目录，不全局安装）：

```sh
npm install --prefix .larkanything/evaluation/tools --no-audit --no-fund --ignore-scripts --save-exact opencode-windows-x64@1.19.5 @opencode/cli-windows-x64@2.2.6
node scripts/evaluation/opencode-live.mjs .larkanything/evaluation/tools/node_modules/opencode-windows-x64/bin/opencode.exe .larkanything/evaluation/tools/node_modules/@opencode/cli-windows-x64/bin/opencode.exe
```

此项使用独立 XDG 目录与合成会话，V2 使用私有服务模式。没有模型请求、账号登录或飞书上传；它证明 CLI 与适配器互通，尚未证明真实用户长期会话或 OpenCode 图形界面兼容。记录二进制 SHA-256 与版本。命令参考 [V1 官方 CLI 文档](https://docs.opencode.ai/docs/cli/)、[V2 官方 CLI 文档](https://dev.opencode.ai/v2/docs/cli/commands/)；V2 消息结构参照 [官方 schema](https://github.com/anomalyco/opencode/blob/dev/packages/schema/src/session-message.ts)，并用真实导出核验。

## 问题台账

“修复并复测”表示本分支验证通过，不表示当前 GitHub 安装包已包含修复。

| 编号 | 优先级 | 复现与影响 | 修复 / 当前状态 |
| --- | --- | --- | --- |
| DOCX-001 | P2 | 标题样式 ID 为 `1` 等本地化 ID 时丢失标题层级 | 读取 styles.xml、继承样式和 outlineLvl；修复并复测 |
| DOCX-002 | P1 | 同一表格单元格两个段落变成 FirstSecond | 保留段落分隔；修复并复测 |
| DOCX-003 | P1 | 未闭合 XML 被当成有效正文，可能静默导出残缺内容 | 校验 XML 和主文档结构；修复并复测 |
| DOCX-004 | P2 | 超链接目标被丢弃却无具体提示 | 明确提示仅保留文字；修复并复测，链接保真仍未实现 |
| OC-001 | P1 | 毫秒时间戳被误认为秒，日期异常 | 在 OpenCode 边界统一时间单位；修复并复测 |
| OC-002 | P1 | 未识别内容类型被静默丢弃 | 占位与不完整提示，仍排除内部推理；修复并复测 |
| NOTION-001 | P1 | 服务重复分页游标会无限请求 | 检测重复游标并中止；修复并复测 |
| NOTION-002 | P1 | 无效列表响应显示为空工作区 | 校验响应，连接失败恢复旧令牌；修复并复测 |
| OC-004 | P1 | 官方 2.2.6 返回 `opencode v2.2.6`，版本判断选错导出命令 | 支持实际版本前缀；修复并复测 |
| OC-005 | P1 | V2 已改为 type/text/content 消息，原适配器报空会话 | 适配 V1/V2、文件和工具内容及位置字段；修复并复测 |

## 真实验收矩阵与剩余工作

| 来源 / 环节 | 当前证据 | 待验证内容 |
| --- | --- | --- |
| Codex | 现有解析回归、原生窗口合成会话、Core 预览一致性 | 当前安装包读取真实会话并上传回读 |
| Claude Code | 分支链解析回归、原生窗口合成会话发现与预览 | 官方客户端生成的长会话、恢复/分支/工具调用；目前无账号环境 |
| Obsidian | 原生文件系统中的合成 vault、Unicode 与预览 | Obsidian 实际编辑保存、嵌入、附件、双链、复杂笔记 |
| OpenCode | 官方 Windows CLI 1.19.5、2.2.6 合成会话往返通过 | 真实模型生成长会话；App 内调用真实 CLI；macOS |
| Notion | 模拟分页、异常、截断检测 | 工作区集成、页面授权、真实分页及复杂块；用户暂无环境 |
| Markdown | 扩展名、大小、Unicode、重新读取、原生预览 | 系统选择器、取消、多次选择、文件被删除或拒绝访问 |
| Word | 合成 OOXML 标题、表格、实体/损坏/大小限制、原生预览 | Microsoft Word 实际生成文档与复杂格式；本机 COM 调用无响应，已终止此次测试进程 |
| 飞书 | 模拟发布回读、回执复用、不确定结果禁止自动重传 | 各来源真实上传并回读核对；本轮未创建远程文档 |
| macOS | 本轮尚未运行 | Apple Silicon 安装、权限、文件选择、预览、真实发布 |

Notion 使用 API，不要求安装桌面客户端。真实验收需要工作区、专用测试页面和可访问该页面的集成，在网页版即可准备；令牌只在 App 设置中输入，不写进报告。

## 后续每轮规则

1. 先复现，分配稳定编号，记录版本、环境、输入来源与预期/实际结果。
2. 将最小复现加入专项用例，保留修复前报告；真实数据需脱敏，禁止提交账号令牌或私人正文。
3. 修复后重跑相关用例和受影响的集成测试，更新台账与验收矩阵。
4. 未运行、缺少账号、环境阻塞分别记录；不能按“通过”统计。
5. 发布候选需补齐真实客户端、系统选择器、真实飞书回读与 macOS 验收；本轮离线全绿不等于达到发布验收条件。

历史证据摘要保存在 [evaluation/runs](evaluation/runs)。本轮原始运行记录保存在项目 `.larkanything/evaluation`，原生 UI 截图在 `.larkanything/tauri-smoke-*`。
