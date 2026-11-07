# CLI、Skill 与 SDK 使用指南

本文面向可选的 CLI、个人 Skill 和 JavaScript SDK。桌面用户从 [GitHub Releases](https://github.com/Hans-M-Yin/LarkAnything/releases/tag/desktop-v0.1.0-preview.1) 下载安装后，在 App 内连接飞书即可，无需执行下方命令。

## 懒人安装（Codex / Claude Code）

把本仓库的 GitHub 链接交给 Codex 或 Claude Code，说：

> 帮我安装 https://github.com/Hans-M-Yin/LarkAnything 里的 LarkAnything，阅读 INSTALL.md，并引导我连接飞书。

Agent 会按 [INSTALL.md](../INSTALL.md) 安装程序、依赖和当前客户端的个人 Skill。也可以手动安装：

```bash
git clone https://github.com/Hans-M-Yin/LarkAnything.git
cd LarkAnything
node scripts/install.mjs
```

已在源码目录中时，只需运行 `node scripts/install.mjs`。

默认同时支持 Codex 和 Claude Code；也可加 `--agent codex` 或 `--agent claude`。安装器自动准备依赖、复用或私有安装官方 Lark CLI，并生成默认配置。无需注册插件市场、寻找缓存目录或手动编辑 JSON。需要 Node.js 22+ 和 npm；缺少时可让 Agent 帮忙准备。

安装后让 Agent 按引导连接飞书，完成飞书要求的配置/授权。新开对话后，直接说：

> 把这个对话导出到飞书。

程序与配置保存在用户目录的 `.larkanything` 中，删除下载的源码目录后仍可使用。更新时下载新版源码，再运行同一安装命令；配置和发布回执会保留。授权是否可完成仍受飞书租户和组织权限限制。

## 本地开发 / 离线体验

需要 Node.js 22+。在项目目录执行：

```bash
npm ci --ignore-scripts
npm run demo
```

打开 `.larkanything/demo/preview.html` 查看合成样例。样例不包含真实对话，不连接飞书。

导出自己的会话到本地：

```bash
node bin/larkanything.mjs list --channel codex
node bin/larkanything.mjs preview --channel codex --session YOUR_SESSION_ID
node bin/larkanything.mjs preview --channel claude-code --input /path/to/session.jsonl
node bin/larkanything.mjs preview --channel chatgpt --input /path/to/conversations.json --session YOUR_CONVERSATION_ID
```

`list` 不上传内容。Codex 会话按日志中的 `session_meta.id` 聚合，输出会话 ID、分段数和文件列表；`--session` 自动组装同一会话的本地分段，包括归档与带后缀的日志。`--input` 只处理指定文件，并将整个会话的完整性标记为未知。

`preview` 生成 Markdown、HTML 和冻结的 `plan.json`，三者可能含私人对话，请自行选择保存位置。计划中的 `source.manifest` 记录各来源的路径、字节数、SHA-256、消息数量、排除的注入记录和去重数量。`complete` 仅表示准备时已发现的本机会话分段均被加载，不证明已删除、远端或 fork 父会话的历史可用。相同消息标识的内容冲突会停止导出；无法确认的重复或修订保留并警告，不按文本前缀删除。工具日志默认排除；`--include-tools` 可以开启。

### 阅读与元信息

默认将同一回复的连续助手消息合并到一个标题下，保留每一步的原文。回复开头统一显示记录时间范围和模型；公开的进度/实现过程放在引用块中，仅使用“（步骤 x）”标记，最终答复使用正文。只有日志明确标注的过程消息进入引用，未知阶段保留为正文，不推断某条消息是最终答复。Codex 使用 `turn_id` 判定边界；缺少轮次标识的来源按连续助手消息分组，用户消息始终打断合并。显示工具时，工具步骤按原始顺序保留在引用块内。

Adapter 仍逐条保留时间与模型，文档中集中显示一次；若日志确实记录了同轮模型切换，会在回复开头按顺序列出。**时间是客户端日志记录时间，不承诺等于用户点击发送或服务端开始生成的时刻。** Codex 模型来自当时的轮次配置，标注“轮次配置”；Claude Code 使用消息的 `model`，ChatGPT 导出使用消息的 `metadata.model_slug`。缺失信息显示“未记录”，不会用当前模型补写历史，也不会导出内部推理。

新安装默认采用本机时区；SDK/无配置调用默认 UTC，已有配置更新时保持原有设置。可以单次指定：

```bash
node bin/larkanything.mjs preview --channel codex --session YOUR_SESSION_ID --time-zone Asia/Shanghai
```

`--no-merge` 保留逐条消息标题，`--no-timestamps` 隐藏时间，`--no-models` 隐藏模型。对应配置为 `format.mergeConsecutiveAssistant`、`includeTimestamps`、`includeModels`、`timeZone`。合并仅改变展示分组，`publishedMessages` 仍统计原始消息数，`displayGroups` 统计展示分组数。

公式在 Markdown 排版前提取，计划和预览保留原始公式源码；后端发布时使用美元定界公式，避免 Markdown 导入误读 XML 实体。先按原行边界移除 TeX 行注释，再将源码换行替换为空格，保留矩阵分行命令、上下标和中文说明。回读应用相同规则，并在发生归一时记录 `math-source-layout`；公式内容、矩阵分行和代码仍严格比较。原始源码保存在本地计划中。代码保持原样，普通文本美元符号转义后发布。本地 HTML 使用离线 KaTeX MathML；飞书支持的具体命令及视觉效果以实际文档为准。旧计划明确带有 `MATH_NOT_VERIFIED` 时仍使用 `legacy-math-as-text` 兼容校验。

## 连接飞书

后端复用官方 [Lark CLI](https://github.com/larksuite/cli) 的授权和资源写入能力。按其快速开始完成安装和授权，例如：

```bash
npx @larksuite/cli@latest install
lark-cli config init
lark-cli auth login --domain docs,drive
```

需要 CLI 支持以下命令；LarkAnything 本身不读取、保存或要求粘贴 OAuth token：

```bash
lark-cli docs +create --help
lark-cli docs +update --help
lark-cli docs +fetch --help
```

确认 `+create`、`+update` 支持 `--doc-format markdown`、`--content -`，然后发布：

```bash
node bin/larkanything.mjs publish --channel codex --session YOUR_SESSION_ID
```

该命令独立完成来源组装、快照、格式转换、本地预览、飞书写入与回读，不需要 Agent 阅读日志或编写处理脚本。程序核对完整文字序列，明确报告链接边界的空白兼容处理，并严格比较代码内容、缩进与行内代码。回读不验证字体、表格宽度或图片视觉效果。

默认采用 `--operation sync`：第一次发布创建文档，并在本机记录会话 ID、文档 ID 和已发布消息的 ID/哈希；同一会话继续聊天后再次执行该命令，只在原文档末尾追加新增消息，没有新增消息时不写入。消息编号继续累加，追加内容不重复整篇标题和会话元信息；文档开头的统计与时间范围仍表示首次导出的快照。匹配范围包括渠道、后端身份、namespace 和父目录，需使用同一状态目录及稳定会话 ID。旧配置若显式设置了 `create`，改为 `sync` 或单次指定 `--operation sync`。旧版回执没有会话关联，不能据此自动接续旧文档。

发布已检查的预览，或在回读失败后重试，使用返回的 `output.plan` / `retry.plan`：

```bash
node bin/larkanything.mjs publish --plan /absolute/path/to/plan.json
```

保存的计划固定正文、目标和导出键，不会再次读取仍在增长的会话。已有远端回执时只重试校验；错误 JSON 提供文档 URL/id、差异诊断和重试计划。写入结果未知时仍停止自动重放。Agent 应报告程序结果，不能通过删除全部空白或另写验证文件覆盖失败状态。

指定目标与格式：

```bash
node bin/larkanything.mjs publish --channel codex --input /path/session.jsonl --parent-token FOLDER_OR_WIKI_NODE_TOKEN
node bin/larkanything.mjs publish --channel codex --session YOUR_SESSION_ID --operation create
node bin/larkanything.mjs publish --channel claude-code --input /path/session.jsonl --operation append --document DOCUMENT_URL_OR_ID
node bin/larkanything.mjs publish --channel codex --input /path/session.jsonl --config examples/larkanything.config.json --profile engineering
```

首次授权需要用户在飞书完成。保存位置、可用能力和访问权限受账号、租户及授权范围限制。Lark 与飞书的区域、域名和认证交给官方 CLI 配置处理。

## 可选：作为 Codex 插件安装

普通用户优先使用上面的懒人安装。以下是插件市场分发方式，与个人 Skill 安装二选一即可。

仓库包含 portable `plugin.json`、Codex 兼容 manifest 和 `.agents/plugins/marketplace.json`。

本地开发时，在项目根目录注册市场：

```bash
codex plugin marketplace add .
```

在 Codex 插件界面选择 LarkAnything 市场并安装。安装后的插件目录需要执行一次 `npm ci --ignore-scripts`，并完成 Lark CLI 授权；然后在新对话中使用：

> 使用 $larkanything-export，把这个 Codex 会话保存到飞书，不包含工具日志。

Skill 使用选定会话的真实日志，不把当前上下文摘要当作完整对话。插件需要本地执行环境；当前不提供远程 MCP 服务或浏览器扩展。同一市场也可以从本仓库的 GitHub 地址添加。公共插件商店的提交是独立流程，本仓库尚未上架。

## 配置与 Protocol

参见 [完整示例](../examples/larkanything.config.json)。覆盖顺序为：

`内置默认值 → defaults → channels[channel] → profiles[name] → 本次 CLI/SDK 参数`

- `protocol` 决定内容选择和文档结构；首版为 `transcript`。
- `format` 是协议的参数，如角色名称、语言、时间戳、工具日志和转换严格程度。
- `renderer` 决定传输格式；首版为 `markdown`。
- `target` 决定后端、操作、目标位置和业务 namespace。
- `backends` 是后端自己的运行参数；不在配置中填写凭据。

例如，给研究笔记配置专门的飞书目录：

```json
{
  "version": 1,
  "profiles": {
    "research": {
      "format": { "locale": "zh-CN", "includeTools": false },
      "target": { "parentToken": "YOUR_FOLDER_TOKEN", "namespace": "research" }
    }
  }
}
```

配置中的 `stateDir` 相对配置文件解析；没有配置文件时，默认在当前工作目录 `.larkanything/state` 下保存发布回执。不同账号/业务建议使用独立 namespace 和状态目录。

## 扩展接口

```javascript
import { createLarkAnything } from './src/index.mjs';

const engine = createLarkAnything({
  adapters: [myClientAdapter],
  protocols: [myFormatProtocol],
  renderers: [myRenderer],
  backends: [myLarkBackend],
});

const plan = await engine.plan({
  channel: myClientAdapter.id,
  input: '/path/to/export',
  overrides: { protocol: myFormatProtocol.id, target: { backend: myLarkBackend.id } },
});
await engine.publish(plan);
```

五个可替换接口为 `Adapter`、`FormatProtocol`、`Renderer`、`Backend`、`ReceiptStore`。查看 [TypeScript 接口](../src/index.d.ts) 与 [架构说明](ARCHITECTURE.md)。Core 不依赖渠道日志格式；新增来源类型可以注册对应 Protocol，不必伪装成聊天消息。

## 可靠性与边界

- 回执区分 `publishing`、`written`、`verified`、`verification_failed`、`uncertain`。
- 已验证的冻结计划再次发布时返回原回执。命名 key 绑定一次发布快照，与不同计划发生冲突时直接报错；日常增量推送无需指定 key。
- 写入结果未知时不自动重发。已获得文档 id 但回读失败时，用 `publish --plan` 重试同一冻结计划，只进行回读。
- 幂等保证限于**同一状态目录**；多机器/多用户需要共享 ReceiptStore。首版没有分布式事务或自动 exactly-once 保证。
- 默认 `sync` 按会话关联和消息 checkpoint 仅追加新增消息。已发布历史被修改、截断或切换分支时停止并报告 `SYNC_HISTORY_CHANGED`；尚未完成的发布必须先用原冻结计划恢复。过期计划会报告 `SYNC_STALE_PLAN`，重新准备后再推送。
- 显式 `create` 创建独立文档，显式 `append --document ...` 追加本次选定的整个导出内容，后者仍可能重复已有文字。这两种操作不建立自动会话关联。
- 不覆写已有文档，不做双向同步、摘要、自动分享、通知或后台监控。
- Codex fork 父会话不会自动合并，Claude Code/ChatGPT 按选定分支导出；缺失内容、转换限制和工具日志排除会写入报告。
- 首版仅解析本机实际存在的日志/用户提供的导出文件，不连接或抓取各 AI 客户端账户。日志格式不是稳定公开契约，需要持续维护真实样例兼容性。
- 本地预览/计划含导出文字；回执保存状态、错误码和消息 ID/哈希，回读失败时可包含短差异片段，不保存完整正文。原始客户端日志保持原样。

`--strict` 遇到已识别的来源/渲染限制会停止发布。通过本地测试与模拟后端，不等于已在你的飞书租户完成真实发布和视觉验收。

## 开发与路线

```bash
npm run check
npm test
npm run demo
```

当前测试覆盖分支选择、重复事件、格式覆盖、代码围栏、XML 转义、长文本、并发与未知写入结果，以及真实子进程边界下的模拟发布。

接下来按能力逐步扩展：媒体与公式保真 → 更多客户端/浏览器入口 → 远端人工编辑的冲突处理 → GitHub/网页/本地文件来源 → 多维表格等输出类型。每一项都有独立的适配位置；未实现的能力不出现在运行时的 capabilities 中。

MIT License。独立社区项目，与 OpenAI、Anthropic、飞书或 Lark 官方无隶属关系。
