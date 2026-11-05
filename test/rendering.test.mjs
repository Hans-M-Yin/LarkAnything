import test from 'node:test';
import assert from 'node:assert/strict';
import MarkdownIt from 'markdown-it';
import { resolveOptions, transcriptProtocol, markdownRenderer, createLarkAnything } from '../src/index.mjs';
import { prepareMarkdown, fenced, previewHtml, markdownText } from '../src/renderers/markdown.mjs';

test('Format precedence is defaults < channel < profile < explicit override', () => {
  const options = resolveOptions({ defaults: { format: { includeTools: true } }, channels: { codex: { format: { assistantLabel: 'Codex', includeTimestamps: true } } }, profiles: { simple: { format: { includeTools: false } } } }, 'codex', 'simple', { format: { includeTimestamps: false } });
  assert.equal(options.format.assistantLabel, 'Codex');
  assert.equal(options.format.includeTools, false);
  assert.equal(options.format.includeTimestamps, false);
});

test('Unknown format options and missing append destinations fail before any backend call', async () => {
  const engine = createLarkAnything();
  await assert.rejects(engine.plan({ channel: 'codex', input: 'examples/codex.jsonl', overrides: { format: { incldueTools: true } } }), { code: 'PROTOCOL_OPTION' });
  await assert.rejects(engine.plan({ channel: 'codex', input: 'examples/codex.jsonl', overrides: { target: { operation: 'append' } } }), { code: 'TARGET_DOCUMENT' });
  assert.throws(() => resolveOptions({}, 'codex', 'missing'), { code: 'PROFILE_NOT_FOUND' });
});

test('Markdown table, Chinese, code and semantic heading hierarchy survive rendering', async () => {
  const plan = await createLarkAnything().plan({ channel: 'codex', input: 'examples/codex.jsonl' });
  assert.match(plan.artifact.body, /### 设计目标/);
  assert.match(plan.artifact.body, /#### 调用示例/);
  assert.match(plan.artifact.body, /\| Adapter \|/);
  assert.match(plan.artifact.body, /```javascript/);
  assert.equal(plan.document.coverage.publishedMessages, 4);
  assert.ok(!plan.artifact.body.includes('Tests passed'));
  assert.ok(plan.artifact.warnings.some(w => w.code === 'TOOLS_EXCLUDED'));
  assert.equal(plan.document.coverage.excludedToolItems, 2);
});

test('Unclosed message fence is repaired, fenced XML/code bytes are preserved', () => {
  const warnings = [];
  const body = prepareMarkdown('```xml\n<source path="@./private"/>\n', warnings);
  assert.ok(body.endsWith('```'));
  assert.ok(body.includes('<source path="@./private"/>'));
  assert.equal(warnings[0].code, 'UNCLOSED_FENCE_REPAIRED');
});

test('Conversation XML cannot become a native file upload or active HTML', () => {
  const rendered = prepareMarkdown('<source path="@./secrets.txt"/>\n\n<img src="x"/>\n\n`<b>`', []);
  assert.ok(rendered.includes('\\<source'));
  assert.ok(rendered.includes('\\<img'));
  assert.ok(rendered.includes('`<b>`'));
  const html = previewHtml('</title><script>alert(1)</script>', { body: rendered, warnings: [] });
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('Content-Security-Policy'));
});

test('Images become links and produce conversion warnings', () => {
  const warnings = [];
  const body = prepareMarkdown('![diagram](https://example.com/image.png)\n\n`![literal](x)`', warnings);
  assert.ok(body.includes('[Image: diagram](https://example.com/image.png)'));
  assert.ok(body.includes('`![literal](x)`'));
  assert.ok(warnings.some(w => w.code === 'IMAGE_LINK_ONLY'));
});

test('Unmatched backticks cannot activate native tags; multiline code spans retain their bytes', () => {
  const malicious = prepareMarkdown('Unclosed ` prefix <source path="@./secret"/>', []);
  assert.ok(malicious.includes('\\<source'));
  const multiline = 'A ``code\n<source path="@./literal"/>\n![literal](x)`` span.';
  assert.equal(prepareMarkdown(multiline, []), multiline);
});

test('Code fences are long enough to contain embedded backticks', () => {
  assert.match(fenced('hello\n```\nworld', 'js'), /^````js/);
  assert.equal(markdownText('**a** | `b`\n\n```js\nx < y\n```'), 'a | b x < y');
});

test('Strict mode rejects incomplete content rather than claiming full fidelity', async () => {
  const adapter = { id: 'image-client', version: 1, async load() { return { version: 1, kind: 'conversation', id: 'image', title: 'image', source: { channel: 'image-client' }, messages: [{ id: '1', role: 'assistant', content: [{ type: 'image', src: 'https://example.com/x.png' }] }] }; } };
  const engine = createLarkAnything({ adapters: [adapter] });
  await assert.rejects(engine.plan({ channel: 'image-client', input: 'unused', overrides: { format: { unsupported: 'error' } } }), { code: 'UNSUPPORTED_CONTENT' });
});

test('Large Unicode messages are never silently truncated', () => {
  const text = '中文🧩'.repeat(20000) + 'END-OF-TRANSCRIPT';
  const doc = transcriptProtocol.format({ id: 'large', title: 'Large', source: { channel: 'generic' }, messages: [{ id: '1', role: 'user', content: [{ type: 'text', format: 'plain', text }] }] }, resolveOptions({}, 'generic').format);
  const artifact = markdownRenderer.render(doc);
  assert.ok(markdownText(artifact.body).includes(text));
  assert.ok(artifact.verificationText.endsWith('END-OF-TRANSCRIPT'));
});

const message = (id, role, text, extra = {}) => ({ id, role, content: [{ type: 'text', format: 'markdown', text }], ...extra });
const formatMessages = (messages, format = {}) => transcriptProtocol.format({ id: 'grouped', title: 'Grouped', source: { channel: 'codex' }, messages }, resolveOptions({}, 'codex', undefined, { format }).format);
const leaves = nodes => nodes.flatMap(n => ['quote', 'step'].includes(n.type) ? leaves(n.children) : [n]);

test('One assistant reply groups progress, tools and final output while preserving every step in order', () => {
  const messages = [message('u', 'user', 'question', { turnId: 't1' }),
    message('a1', 'assistant', 'progress', { turnId: 't1', phase: 'commentary', model: 'model-A', timestamp: '2026-11-04T13:18:35Z' }),
    { id: 'tool', role: 'tool', turnId: 't1', content: [{ type: 'tool', text: 'tool output' }] },
    message('a2', 'assistant', 'final', { turnId: 't1', phase: 'final', model: 'model-B', timestamp: '2026-11-04T13:19:47Z' })];
  const doc = formatMessages(messages, { timeZone: 'Asia/Shanghai' });
  assert.equal(doc.coverage.displayGroups, 2);
  assert.equal(doc.coverage.publishedMessages, 3);
  assert.equal(doc.coverage.mergedAssistantMessages, 1);
  assert.deepEqual(leaves(doc.nodes).filter(n => n.type === 'markdown').map(n => [n.sourceMessageId, n.text]), [['u', 'question'], ['a1', 'progress'], ['a2', 'final']]);
  const meta = doc.nodes.filter(n => n.type === 'metadata' && n.sourceMessageId);
  assert.ok(meta.find(n => n.sourceMessageId === 'a1').text.includes('2026-11-04 21:18:35'));
  assert.equal(meta.length, 2);
  assert.ok(meta.find(n => n.sourceMessageId === 'a1').text.includes('model-A → model-B'));
  assert.ok(meta.find(n => n.sourceMessageId === 'a1').text.includes('2026-11-04 21:19:47'));
  const withTools = formatMessages(messages, { includeTools: true });
  assert.equal(withTools.coverage.displayGroups, 2);
  assert.deepEqual(leaves(withTools.nodes).filter(n => ['markdown', 'code'].includes(n.type)).map(n => n.sourceMessageId), ['u', 'a1', 'tool', 'a2']);
});

test('Progress steps share a quote, final answer stays outside, and model metadata appears once', () => {
  const doc = formatMessages([
    message('a', 'assistant', 'PROGRESS\n\n```js\nconst x = 1;\n```', { phase: 'commentary', model: 'model-A' }),
    message('b', 'assistant', 'MORE\n\n| Key | Value |\n| --- | --- |\n| a | b |', { phase: 'commentary', model: 'model-A' }),
    message('c', 'assistant', 'FINAL ANSWER', { phase: 'final', model: 'model-A' }),
  ]);
  assert.equal(doc.nodes.filter(n => n.type === 'quote').length, 1);
  assert.deepEqual(doc.nodes.find(n => n.type === 'quote').children.map(n => n.label), ['（步骤 1）', '（步骤 2）']);
  const body = markdownRenderer.render(doc).body;
  assert.equal((body.match(/model\\-A/g) || []).length, 1);
  let depth = 0, codeInside = false, tableInside = false;
  const texts = [];
  for (const token of new MarkdownIt().parse(body, {})) {
    if (token.type === 'blockquote_open') depth++;
    if (token.type === 'blockquote_close') depth--;
    if (token.type === 'inline') texts.push({ text: token.content, quoted: depth > 0 });
    if (token.type === 'fence') { codeInside = depth > 0; assert.equal(token.content, 'const x = 1;\n'); }
    if (token.type === 'table_open') tableInside = depth > 0;
  }
  assert.equal(texts.find(t => t.text === '（步骤 1） PROGRESS').quoted, true);
  assert.equal(texts.find(t => t.text === '（步骤 2） MORE').quoted, true);
  assert.equal(texts.find(t => t.text === 'FINAL ANSWER').quoted, false);
  assert.ok(codeInside && tableInside);
  const codeFirst = formatMessages([message('code', 'assistant', '```js\nconst x = 1;\n```', { phase: 'commentary' })]);
  assert.equal(new MarkdownIt().parse(markdownRenderer.render(codeFirst).body, {}).find(t => t.type === 'fence').content, 'const x = 1;\n');
});

test('Interrupted progress is not promoted to a final answer; unknown phases remain body text', () => {
  const interrupted = formatMessages([message('a', 'assistant', 'still working', { phase: 'commentary' })]);
  assert.ok(interrupted.nodes.find(n => n.type === 'quote'));
  assert.equal(interrupted.nodes.filter(n => n.type === 'markdown').length, 0);
  const unknown = formatMessages([message('a', 'assistant', 'phase unavailable')]);
  assert.equal(unknown.nodes.filter(n => n.type === 'quote').length, 0);
  assert.equal(unknown.nodes.find(n => n.type === 'markdown').text, 'phase unavailable');
});

test('Grouping respects explicit turn boundaries, user interruptions and the opt-out', () => {
  const messages = [message('a', 'assistant', 'a', { turnId: 't1' }), message('b', 'assistant', 'b', { turnId: 't2' }), message('u', 'user', 'interrupt'), message('c', 'assistant', 'c', { turnId: 't2' }), message('d', 'assistant', 'd', { turnId: 't2' })];
  assert.equal(formatMessages(messages).coverage.displayGroups, 4);
  assert.equal(formatMessages(messages, { mergeConsecutiveAssistant: false }).coverage.displayGroups, 5);
  assert.equal(formatMessages([message('a', 'assistant', 'a'), message('b', 'assistant', 'b')]).coverage.displayGroups, 1);
  assert.equal(formatMessages([message('a', 'assistant', 'a', { turnId: 'known' }), message('b', 'assistant', 'b')]).coverage.displayGroups, 2);
});

test('Missing metadata remains unknown and timestamp/model options can hide it', () => {
  const messages = [message('a', 'assistant', 'unchanged')];
  const doc = formatMessages(messages);
  const metadata = doc.nodes.find(n => n.type === 'metadata' && n.sourceMessageId === 'a');
  assert.ok(metadata.text.includes('记录时间: 未记录'));
  assert.ok(metadata.text.includes('模型: 未记录'));
  const hidden = formatMessages(messages, { showMetadata: false, includeTimestamps: false, includeModels: false });
  assert.equal(hidden.nodes.filter(n => n.type === 'metadata').length, 0);
  assert.throws(() => formatMessages(messages, { timeZone: 'Not/AZone' }), { code: 'TIME_ZONE' });
});
