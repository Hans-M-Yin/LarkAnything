# 修复失败的会话同步

普通保存仍使用 `publish --channel codex --session SESSION_ID`，只追加新增消息。

当旧版转换已损坏远端正文，且原计划重试回读仍失败时，可在用户明确同意重建原文档后使用：

```text
larkanything preview --channel codex --session SESSION_ID --repair
larkanything publish --plan PATH_TO_REPAIR_PLAN
```

先备份远端文档。`--repair` 会以当前来源的完整快照覆盖同一文档正文，可能移除远端人工编辑；它不是普通增量保存。只有存在文档 ID 且状态为 `verification_failed` 的会话允许准备修复；不会自动覆盖已验证的文档，也不允许绕过未知写入结果。

修复计划冻结正文、文档 ID 和前一版本。发布仍持有会话锁与导出锁；成功回读后保存新的消息检查点，下一次普通保存继续增量追加。失败后重试同一计划只进行回读，不重复覆盖。

已知目标的 sync append 或显式 repair 若写入回执无法解析，先确认远端写入情况；可用以下命令只读恢复：

```text
larkanything publish --plan PATH_TO_PLAN --recover
```

`--recover` 不写飞书。仅对当前状态为 `uncertain` 的已知目标计划执行正式 Backend 回读校验，完全通过后才更新回执及会话状态。它拒绝新建文档的未知写入、过期计划和修改后的计划。校验失败时保留原状态，不自动重发。
