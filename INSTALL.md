# 给 Codex / Claude Code 的安装说明

用户只需要把仓库链接交给 Agent，并说：

> 帮我安装这个仓库里的 LarkAnything，并引导我连接飞书。

以下步骤由 Agent 执行。安装、连接和导出分别报告真实结果；用户只在飞书要求时完成配置和授权。

1. 阅读本文件与 `scripts/install.mjs`。确认 Node.js 22+ 和 npm 可用；缺少时使用当前环境已有的正常安装方式准备 Node。不要因为客户端自身能运行，就假设它提供了可调用的 Node/npm。
2. 将用户指定的 GitHub 仓库克隆/解压到本机一个新目录；本地已有本仓库时直接使用。不需要先安装 npm 依赖，也不需要创建插件市场。
3. 在源码根目录运行以下命令。已知当前客户端时选择对应 agent；用户两边都使用或未指定时默认安装两边，无需为此再提问。

```bash
node scripts/install.mjs
```

仅装某个客户端时：

```bash
node scripts/install.mjs --agent codex
node scripts/install.mjs --agent claude
```

安装器会自动：

- 将可独立运行的程序复制到 `~/.larkanything/runtime`，安装生产依赖。
- 复用已有 Lark CLI；不存在时，把官方 CLI 安装到私有目录，不做全局 npm 安装、不改 shell 配置。
- 将 Skill 安装到 Codex 的 `~/.agents/skills` 和/或 Claude Code 的 `~/.claude/skills`。
- 创建默认配置和 readable/engineering 两种配置，保留后续用户修改。
- 输出 JSON，包含运行目录、Skill 路径、配置和连接指南。

4. 检查 `ok: true`，再用返回的 Skill 路径运行 `scripts/run.mjs paths`。阅读返回的 `connectionGuide`，继续检查/完成飞书连接。脚本不会替用户登录，也不会把凭据写入 LarkAnything 配置。
5. 已安装 Skill 通常需要新开客户端对话才能在选择器里出现；当前安装中的 Agent 可以直接读取安装后的 Skill，继续连接流程。之后用户直接说“把这个对话导出到飞书”即可。

## 更新与问题处理

更新时从新的源码 checkout 再运行同一命令。安装器会替换自己管理的程序/Skill，保留配置和发布回执。依赖准备失败时保留正在使用的版本。同名但不由本项目管理的文件夹会被拒绝，不静默覆盖。

不需要用户记住缓存路径、编辑 JSON、手动复制 Skill，或同时安装“插件版”和“Skill 版”。安装器使用个人 Skill 作为最直接的入口，仓库仍保留插件包供其他分发方式使用。

`--prefix DIRECTORY` 可选择运行目录；Skill 仍安装到当前用户的个人目录。`--skip-lark` 适用于只使用离线预览的情况，此时不安装或检测 Lark CLI。Windows 默认目录位于当前用户目录下，脚本不依赖 Bash 或符号链接。

参考：[Codex 个人 Skill 位置](https://learn.chatgpt.com/docs/build-skills)、[Claude Code 个人 Skill 位置](https://code.claude.com/docs/en/skills)、[官方 Lark CLI](https://github.com/larksuite/cli)。
