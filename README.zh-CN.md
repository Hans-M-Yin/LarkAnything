# LarkAnything

[English](README.md) | **简体中文**

**将 AI 对话导出为清晰易读、可编辑的飞书 / Lark 文档。**

把不同 AI 客户端中的对话，按统一的格式协议发布到飞书。目标是逐步连接更多来源与飞书协作对象；v0.1 先专注于对话原文导出。

当前提供本地 CLI、可嵌入的 JavaScript SDK，以及 Codex 插件/Skill 包。无需模型 API Key，也不会调用模型改写原文。

## 当前能力

| 输入 | 支持范围 |
| --- | --- |
| Codex CLI / Desktop | 本地 rollout JSONL；过滤镜像事件，保留实际重复问答 |
| Claude Code | 本地 JSONL；按最后一个主会话消息的 parentUuid 选取分支 |
| ChatGPT | 已导出的 conversation JSON；按 current_node 选择分支 |
| 自定义客户端 | 实现 Adapter，或提供 ConversationV1 JSON |

| 输出 | 状态 |
| --- | --- |
| 本地 Markdown、HTML 预览、发布计划 | 已实现；完全离线 |
| 飞书原生可编辑文档 | 已接入官方 lark-cli 的 Markdown 导入 |
| 新建文档、向指定文档追加 | 已实现；文件夹/Wiki 父节点参数交由 CLI 处理 |
| 渠道格式偏好、命名配置、单次参数 | 已实现；支持逐层覆盖 |
| 回复合并、时间与模型记录 | 同轮回复合并；开头集中显示时间范围和模型，公开过程引用展示 |
| 重复发布识别、并发锁、失败回读 | 已实现；状态保存在本机 |
| 图片 | 保留链接；嵌入数据/不可用附件明确标记，首版不上传 |
| 公式、Mermaid | 保留源码并提示；不承诺原生渲染 |

首版是**本地执行的插件/CLI**。它不会往 Codex 原生界面添加按钮；一条导出指令或一条 CLI 命令启动整条流程。飞书最终视觉效果需要打开生成文档确认，HTML 仅作为本地阅读预览。

## 懒人安装（Codex / Claude Code）

把本仓库的 GitHub 链接交给 Codex 或 Claude Code，说：

> 帮我安装 https://github.com/Hans-M-Yin/LarkAnything 里的 LarkAnything，阅读 INSTALL.md，并引导我连接飞书。

Agent 会按 [INSTALL.md](INSTALL.md) 安装程序、依赖和当前客户端的个人 Skill。也可以手动安装：

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

`list` 列出本机文件，不会上传。`preview` 生成 Markdown、HTML 和 `plan.json`，三者可能含私人对话，请自行选择保存位置。工具日志默认不进入导出结果；`--include-tools` 可以开启。

### 阅读与元信息

默认将同一回复的连续助手消息合并到一个标题下，保留每一步的原文。回复开头统一显示记录时间范围和模型；公开的进度/实现过程放在引用块中，仅使用“（步骤 x）”标记，最终答复使用正文。只有日志明确标注的过程消息进入引用，未知阶段保留为正文，不推断某条消息是最终答复。Codex 使用 `turn_id` 判定边界；缺少轮次标识的来源按连续助手消息分组，用户消息始终打断合并。显示工具时，工具步骤按原始顺序保留在引用块内。

Adapter 仍逐条保留时间与模型，文档中集中显示一次；若日志确实记录了同轮模型切换，会在回复开头按顺序列出。**时间是客户端日志记录时间，不承诺等于用户点击发送或服务端开始生成的时刻。** Codex 模型来自当时的轮次配置，标注“轮次配置”；Claude Code 使用消息的 `model`，ChatGPT 导出使用消息的 `metadata.model_slug`。缺失信息显示“未记录”，不会用当前模型补写历史，也不会导出内部推理。

新安装默认采用本机时区；SDK/无配置调用默认 UTC，已有配置更新时保持原有设置。可以单次指定：

```bash
node bin/larkanything.mjs preview --channel codex --session YOUR_SESSION_ID --time-zone Asia/Shanghai
```

`--no-merge` 保留逐条消息标题，`--no-timestamps` 隐藏时间，`--no-models` 隐藏模型。对应配置为 `format.mergeConsecutiveAssistant`、`includeTimestamps`、`includeModels`、`timeZone`。合并仅改变展示分组，`publishedMessages` 仍统计原始消息数，`displayGroups` 统计展示分组数。

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

该命令会先保存本地预览，再创建飞书文档、回读并核对完整的规范化文字序列，最终输出实际文档 URL/id。回读不验证字体、表格宽度或图片视觉效果。

指定目标与格式：

```bash
node bin/larkanything.mjs publish --channel codex --input /path/session.jsonl --parent-token FOLDER_OR_WIKI_NODE_TOKEN
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

参见 [完整示例](examples/larkanything.config.json)。覆盖顺序为：

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

五个可替换接口为 `Adapter`、`FormatProtocol`、`Renderer`、`Backend`、`ReceiptStore`。查看 [TypeScript 接口](src/index.d.ts) 与 [架构说明](docs/ARCHITECTURE.md)。Core 不依赖渠道日志格式；新增来源类型可以注册对应 Protocol，不必伪装成聊天消息。

## 可靠性与边界

- 回执区分 `publishing`、`written`、`verified`、`verification_failed`、`uncertain`。
- 相同内容和目标生成相同 fingerprint，已验证的发布返回原回执。命名 key 与不同内容发生冲突时直接报错。
- 写入结果未知时不自动重发。已获得文档 id 但回读失败时，再执行同一命令只重试回读。
- 幂等保证限于**同一状态目录**；多机器/多用户需要共享 ReceiptStore。首版没有分布式事务或自动 exactly-once 保证。
- `append` 追加本次选定的整个导出内容；尚未实现仅追加新增消息。修改内容后再追加可能重复已有文字，请明确选择来源范围。
- 不覆写已有文档，不做双向同步、摘要、自动分享、通知或后台监控。
- Codex fork 父会话不会自动合并，Claude Code/ChatGPT 按选定分支导出；缺失内容、转换限制和工具日志排除会写入报告。
- 首版仅解析本机实际存在的日志/用户提供的导出文件，不连接或抓取各 AI 客户端账户。日志格式不是稳定公开契约，需要持续维护真实样例兼容性。
- 本地预览/计划含导出文字；回执仅保存状态和来源错误码，不保存正文。原始客户端日志保持原样。

`--strict` 遇到已识别的来源/渲染限制会停止发布。通过本地测试与模拟后端，不等于已在你的飞书租户完成真实发布和视觉验收。

## 开发与路线

```bash
npm run check
npm test
npm run demo
```

当前测试覆盖分支选择、重复事件、格式覆盖、代码围栏、XML 转义、长文本、并发与未知写入结果，以及真实子进程边界下的模拟发布。

接下来按能力逐步扩展：媒体与公式保真 → 更多客户端/浏览器入口 → 消息级增量发布与冲突检测 → GitHub/网页/本地文件来源 → 多维表格等输出类型。每一项都有独立的适配位置；未实现的能力不出现在运行时的 capabilities 中。

MIT License。独立社区项目，与 OpenAI、Anthropic、飞书或 Lark 官方无隶属关系。
