import { invariant } from '../core/errors.mjs';

const labels = {
  'zh-CN': { user: '用户', assistant: '助手', tool: '工具', transcript: '对话实录', source: '来源', session: '会话', step: '步骤', commentary: '进度更新', final: '最终答复', time: '记录时间', unknown: '未记录', model: '模型', turnModel: '轮次配置', period: '记录范围' },
  en: { user: 'User', assistant: 'Assistant', tool: 'Tool', transcript: 'Conversation', source: 'Source', session: 'Session', step: 'Step', commentary: 'Progress', final: 'Final answer', time: 'Recorded at', unknown: 'Not recorded', model: 'Model', turnModel: 'turn configuration', period: 'Time range' },
};

const sameTurn = (a, b) => a.turnId === b.turnId;

function groupMessages(model, options) {
  const groups = [];
  let excludedTools = 0, publishedMessages = 0, assistantMessages = 0, boundary = false;
  for (const message of model.messages) {
    // Even an empty/filtered user entry separates assistant replies.
    if (message.role === 'user') boundary = true;
    if (message.role === 'tool' && !options.includeTools) { excludedTools += message.content.length; continue; }
    const content = message.content.filter(part => {
      if (part.type === 'tool' && !options.includeTools) { excludedTools++; return false; }
      return true;
    });
    if (!content.length) continue;
    publishedMessages++;
    if (message.role === 'assistant') assistantMessages++;
    const previous = groups.at(-1);
    const merge = options.mergeConsecutiveAssistant && !boundary && previous?.role === 'assistant'
      && ['assistant', 'tool'].includes(message.role) && sameTurn(previous.messages.at(-1), message);
    const visible = { ...message, content };
    if (merge) previous.messages.push(visible);
    else groups.push({ role: message.role, messages: [visible] });
    boundary = false;
  }
  return { groups, excludedTools, publishedMessages, mergedAssistantMessages: assistantMessages - groups.filter(g => g.role === 'assistant').length };
}

function clock(timeZone, unknown) {
  let formatter;
  try { formatter = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }); }
  catch { invariant(false, 'TIME_ZONE', `Invalid timeZone: ${timeZone}`); }
  return value => {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return unknown;
    const p = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
    return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
  };
}

export const transcriptProtocol = {
  id: 'transcript', version: 1, inputKinds: ['conversation'],
  selectMessages(model, options) {
    return groupMessages(model, options).groups.flatMap(group => group.messages);
  },
  format(model, options, { append = false, groupOffset = 0 } = {}) {
    const keys = ['locale', 'includeTools', 'includeTimestamps', 'includeModels', 'mergeConsecutiveAssistant', 'timeZone', 'showMetadata', 'separators', 'unsupported', 'userLabel', 'assistantLabel', 'toolLabel'];
    for (const key of Object.keys(options)) invariant(keys.includes(key), 'PROTOCOL_OPTION', `Unknown transcript option: ${key}`);
    invariant(labels[options.locale], 'LOCALE', 'Supported transcript locales: zh-CN, en.');
    invariant(['warn', 'error'].includes(options.unsupported), 'UNSUPPORTED_POLICY', 'unsupported must be warn or error.');
    for (const key of ['includeTools', 'includeTimestamps', 'includeModels', 'mergeConsecutiveAssistant', 'showMetadata', 'separators']) invariant(typeof options[key] === 'boolean', 'PROTOCOL_OPTION', `${key} must be a boolean.`);
    invariant(typeof options.timeZone === 'string' && options.timeZone.trim(), 'TIME_ZONE', 'timeZone must be an IANA time zone.');
    for (const key of ['userLabel', 'assistantLabel', 'toolLabel']) if (options[key] !== undefined) invariant(typeof options[key] === 'string' && options[key].trim(), 'PROTOCOL_LABEL', `${key} must be a nonempty string.`);
    const l = labels[options.locale], warnings = [...(model.warnings || [])], time = clock(options.timeZone, l.unknown);
    const { groups, excludedTools, publishedMessages, mergedAssistantMessages } = groupMessages(model, options);
    invariant(groups.length > 0, 'EMPTY_DOCUMENT', 'The selected protocol excluded all messages.');
    const nodes = append ? [] : [{ type: 'heading', level: 1, text: l.transcript }];
    const visible = groups.flatMap(g => g.messages);
    if (options.showMetadata && !append) {
      const userCount = visible.filter(m => m.role === 'user').length, replyCount = groups.filter(g => g.role === 'assistant').length;
      nodes.push({ type: 'metadata', text: options.locale === 'zh-CN'
        ? `${l.source}：${model.source.channel} · ${userCount} 条用户消息 · ${replyCount} 段回复 · ${publishedMessages} 条原始消息`
        : `${l.source}: ${model.source.channel} · ${userCount} user messages · ${replyCount} replies · ${publishedMessages} original messages` });
      if (options.includeTimestamps) {
        const dates = visible.map(m => m.timestamp).filter(t => t && !Number.isNaN(new Date(t).getTime())).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
        nodes.push({ type: 'metadata', text: `${l.period}: ${dates.length ? `${time(dates[0])} — ${time(dates.at(-1))}` : l.unknown} · ${options.timeZone}` });
      }
      nodes.push({ type: 'metadata', text: `${l.session}: ${model.id}` });
    } else if (options.includeTimestamps && !append) nodes.push({ type: 'metadata', text: options.timeZone });
    for (const [index, group] of groups.entries()) {
      if (options.separators) nodes.push({ type: 'divider' });
      const label = options[`${group.role}Label`] || l[group.role];
      nodes.push({ type: 'heading', level: 2, text: `${String(groupOffset + index + 1).padStart(2, '0')} · ${label}`, sourceMessageId: group.messages[0].id, role: group.role });
      const info = [];
      if (options.includeTimestamps) {
        const start = time(group.messages[0].timestamp), end = time(group.messages.at(-1).timestamp);
        info.push(`${l.time}: ${start}${start !== end ? ` — ${end}` : ''}`);
      }
      if (options.includeModels && group.role !== 'user') {
        const modelMessages = group.messages.filter(m => m.role === group.role);
        const modelNames = modelMessages.map(m => m.model || l.unknown).filter((name, i, names) => !i || name !== names[i - 1]);
        const source = modelMessages.some(m => m.modelSource === 'turn_context') ? ` (${l.turnModel})` : '';
        info.push(`${l.model}: ${modelNames.join(' → ')}${source}`);
      }
      if (info.length) nodes.push({ type: 'metadata', text: info.join(' · '), sourceMessageId: group.messages[0].id });
      let step = 0;
      for (const message of group.messages) {
        // Only explicitly public progress and tool output enter the process quote.
        // Unclassified messages stay in the body; never invent a final answer.
        const process = message.phase === 'commentary' || message.role === 'tool';
        let destination = nodes;
        if (process) {
          if (nodes.at(-1)?.type !== 'quote') nodes.push({ type: 'quote', children: [] });
          destination = nodes.at(-1).children;
          step++;
          const stepNode = { type: 'step', label: options.locale === 'zh-CN' ? `（步骤 ${step}）` : `(Step ${step})`, children: [], sourceMessageId: message.id };
          destination.push(stepNode);
          destination = stepNode.children;
        }
        for (const part of message.content) {
          const provenance = { sourceMessageId: message.id };
          if (part.type === 'text') destination.push({ type: part.format === 'markdown' ? 'markdown' : 'paragraph', text: part.text, ...provenance });
          else if (part.type === 'code') destination.push({ type: 'code', text: part.text, language: part.language, ...provenance });
          else if (part.type === 'tool') destination.push({ type: 'code', text: part.text, language: 'text', caption: part.name, ...provenance });
          else if (part.type === 'image') {
            destination.push({ type: 'image', src: part.src, label: part.label || 'Image', ...provenance });
            warnings.push({ code: 'IMAGE_LINK_ONLY', message: 'Images are preserved as links in v0.1; they are not uploaded.', messageId: message.id });
          } else {
            destination.push({ type: 'paragraph', text: `[${part.label}]`, ...provenance });
            warnings.push({ code: 'UNSUPPORTED_CONTENT', message: part.label, messageId: message.id });
          }
        }
      }
    }
    if (excludedTools) warnings.push({ code: 'TOOLS_EXCLUDED', message: options.locale === 'zh-CN' ? `已按设置排除 ${excludedTools} 项工具记录。` : `${excludedTools} tool content item(s) excluded by the format protocol.` });
    return { version: 1, kind: 'document', title: model.title, nodes, source: model.source, warnings, coverage: { sourceMessages: model.messages.length, publishedMessages, displayGroups: groups.length, mergedAssistantMessages, excludedToolItems: excludedTools }, unsupported: options.unsupported };
  },
};
