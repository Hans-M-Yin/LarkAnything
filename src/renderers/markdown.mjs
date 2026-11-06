import MarkdownIt from 'markdown-it';
import katex from 'katex';
import { invariant } from '../core/errors.mjs';
import { protectMath, nativeFormula } from './math.mjs';

const md = new MarkdownIt({ html: false, linkify: false, typographer: false });
md.renderer.rules.table_open = () => '<div class="table-scroll"><table>\n';
md.renderer.rules.table_close = () => '</table></div>\n';
export const escapeMarkdown = text => String(text).replace(/[\\`*_{}\[\]()#+.!|<>~$-]/g, '\\$&');
const escapeHtml = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safeUrl = value => {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href.replace(/[()]/g, c => c === '(' ? '%28' : '%29') : null; }
  catch { return null; }
};

export function fenced(text, language = '') {
  const length = Math.max(3, ...Array.from(text.matchAll(/`+/g), m => m[0].length + 1));
  const fence = '`'.repeat(length);
  return `${fence}${String(language).replace(/[^a-zA-Z0-9_+.-]/g, '')}\n${text}${text.endsWith('\n') ? '' : '\n'}${fence}`;
}

function rewriteInline(line) {
  let output = '';
  for (let i = 0; i < line.length;) {
    if (line[i] === '\\' && i + 1 < line.length) { output += line.slice(i, i + 2); i += 2; continue; }
    if (line[i] === '`') {
      const run = /^`+/.exec(line.slice(i))[0];
      const candidates = line.slice(i + run.length).matchAll(/`+/g);
      const close = Array.from(candidates).find(m => m[0].length === run.length);
      if (close) {
        const end = i + run.length + close.index + run.length;
        output += line.slice(i, end); i = end; continue;
      }
      // An unmatched backtick is literal Markdown; it must not suppress escaping.
      output += run; i += run.length; continue;
    }
    if (line[i] === '$') output += '\\$';
    else if (line[i] === '<') output += '\\<';
    else if (line.slice(i, i + 2) === '![') { output += '[Image: '; i += 2; continue; }
    else output += line[i];
    i++;
  }
  return output;
}

export function prepareMarkdown(source, warnings) {
  const math = protectMath(source);
  source = math.body;
  const tokens = md.parse(source, {}), lines = source.split('\n');
  const protectedLines = new Set();
  for (const token of tokens) if (['fence', 'code_block'].includes(token.type) && token.map) {
    for (let n = token.map[0]; n < token.map[1]; n++) protectedLines.add(n);
    if (token.info.trim() === 'mermaid') warnings.push({ code: 'MERMAID_SOURCE_ONLY', message: 'Mermaid source is retained as a code block; no diagram is rendered.' });
  }
  // Preserve document hierarchy: h1 document section, h2 messages, h3+ content.
  const headings = tokens.filter(t => t.type === 'heading_open');
  const min = Math.min(...headings.map(t => Number(t.tag.slice(1))));
  let previous = 2;
  for (const token of headings) {
    const level = Math.min(6, previous + 1, 3 + Number(token.tag.slice(1)) - min);
    previous = level;
    const [start, end] = token.map;
    if (/^ {0,3}#{1,6}\s/.test(lines[start])) lines[start] = lines[start].replace(/^ {0,3}#{1,6}\s+/, `${'#'.repeat(level)} `);
    else if (end - start === 2) { lines[start] = `${'#'.repeat(level)} ${lines[start]}`; lines[start + 1] = ''; }
  }
  const children = tokens.flatMap(t => t.children || []);
  if (children.some(t => t.type === 'image')) warnings.push({ code: 'IMAGE_LINK_ONLY', message: 'Markdown images are retained as links; media upload is not enabled.' });
  if (math.unclosed.length) warnings.push({ code: 'MATH_DELIMITER_UNCLOSED', message: 'An unmatched or empty math delimiter is retained as text; check the source formula.' });
  const rewritten = [];
  for (let index = 0; index < lines.length;) {
    if (protectedLines.has(index) || !lines[index].trim()) { rewritten.push(lines[index++]); continue; }
    const start = index;
    while (index < lines.length && !protectedLines.has(index) && lines[index].trim()) index++;
    rewritten.push(rewriteInline(lines.slice(start, index).join('\n')));
  }
  let body = rewritten.join('\n');
  // An unfinished fence in one message must not consume subsequent messages.
  let open;
  for (const line of body.split('\n')) {
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!match) continue;
    if (!open) open = match[1];
    else if (match[1][0] === open[0] && match[1].length >= open.length && !match[2].trim()) open = undefined;
  }
  if (open) { body += `\n${open}`; warnings.push({ code: 'UNCLOSED_FENCE_REPAIRED', message: 'An unfinished code fence was closed at the message boundary.' }); }
  return math.restore(body, nativeFormula);
}

export function markdownText(body) {
  const math = protectMath(body, { native: true });
  const inline = tokens => tokens.map(t => t.children ? inline(t.children) : ['text', 'code_inline', 'fence', 'code_block'].includes(t.type) ? t.content : ' ').join(' ');
  return math.restore(inline(md.parse(math.body, {})), formula => formula.tex).replace(/\s+/g, ' ').trim();
}

// Inline markup changes token boundaries, not visible spacing. Keep this
// separate from the legacy artifact text so existing export keys stay stable.
export function markdownReadbackText(body) {
  const math = protectMath(body, { native: true });
  const inline = tokens => tokens.map(t => t.children ? inline(t.children)
    : ['text', 'code_inline'].includes(t.type) ? t.content
      : ['softbreak', 'hardbreak'].includes(t.type) ? ' ' : '').join('');
  const text = md.parse(math.body, {}).map(t => t.children ? inline(t.children)
    : ['fence', 'code_block'].includes(t.type) ? t.content : '').join(' ');
  return math.restore(text, formula => formula.tex).replace(/\s+/g, ' ').trim();
}

export const markdownRenderer = {
  id: 'markdown', version: 1, outputFormat: 'markdown',
  preview: previewHtml,
  render(document) {
    invariant(document?.kind === 'document' && document.version === 1, 'DOCUMENT_MODEL', 'Expected Document v1.');
    const warnings = [...document.warnings];
    const renderNode = node => {
      if (node.type === 'heading') return `${'#'.repeat(node.level)} ${escapeMarkdown(node.text)}`;
      if (node.type === 'paragraph') return escapeMarkdown(node.text);
      if (node.type === 'metadata') return `> ${escapeMarkdown(node.text).replace(/\n/g, '\n> ')}`;
      if (node.type === 'quote') return node.children.map(renderNode).join('\n\n').split('\n').map(line => `> ${line}`).join('\n');
      if (node.type === 'step') {
        const content = node.children.map(renderNode).join('\n\n');
        // Prefix prose inline; keep heading/list/code/table syntax at line start.
        const separator = md.parse(content, {})[0]?.type === 'paragraph_open' ? ' ' : '\n\n';
        return `${escapeMarkdown(node.label)}${separator}${content}`;
      }
      if (node.type === 'markdown') return prepareMarkdown(node.text, warnings);
      if (node.type === 'code') return `${node.caption ? `${escapeMarkdown(node.caption)}\n\n` : ''}${fenced(node.text, node.language)}`;
      if (node.type === 'divider') return '---';
      if (node.type === 'image') {
        const url = safeUrl(node.src);
        return url ? `[${escapeMarkdown(node.label)}](<${url}>)` : escapeMarkdown(`[${node.label}: image reference unavailable]`);
      }
      throw new Error(`Renderer does not support node: ${node.type}`);
    };
    const blocks = document.nodes.map(renderNode);
    const material = warnings.filter(w => !['TOOLS_EXCLUDED', 'SOURCE_SEGMENTS_MERGED'].includes(w.code));
    invariant(document.unsupported !== 'error' || !material.length, 'UNSUPPORTED_CONTENT', `Strict rendering stopped: ${material.map(w => w.code).join(', ')}`);
    const body = blocks.join('\n\n') + '\n';
    return { format: this.outputFormat, extension: 'md', body, warnings, verificationText: markdownText(body) };
  },
};

export function previewHtml(title, rendered) {
  const issues = rendered.warnings.filter(w => w.code !== 'TOOLS_EXCLUDED');
  const notes = rendered.warnings.filter(w => w.code === 'TOOLS_EXCLUDED');
  const math = protectMath(rendered.body, { native: true });
  const article = math.restore(md.render(math.body), formula => {
    try {
      return katex.renderToString(formula.tex, { displayMode: formula.display, output: 'mathml', trust: false, strict: 'ignore', maxExpand: 1000, maxSize: 20 });
    } catch {
      return `<code class="math-error" title="Formula preview unavailable">${escapeHtml(formula.tex)}</code>`;
    }
  });
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escapeHtml(title)}</title><style>
  :root{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#202a38;background:#f3f5f8;line-height:1.75}body{max-width:880px;margin:40px auto;padding:0 20px}article{background:#fff;padding:40px 48px;border:1px solid #e4e9f0;border-radius:16px}header{margin-bottom:26px}header small{color:#66778e}h1{font-size:26px;line-height:1.45}h2{font-size:19px;margin-top:32px;border-left:4px solid #3370ff;padding-left:12px}h3,h4,h5,h6{margin-top:22px}p,ul,ol{margin:12px 0}pre{background:#f5f7fa;border:1px solid #e6ebf1;padding:18px;overflow:auto;border-radius:8px;line-height:1.55}code{font-family:ui-monospace,SFMono-Regular,monospace;font-size:.9em}p code,li code{background:#eef2f7;padding:2px 5px;border-radius:4px}table{width:100%;border-collapse:collapse;display:block;overflow:auto}th,td{padding:10px 14px;border:1px solid #dfe5ed;text-align:left}th{background:#f4f6f9}blockquote{border-left:3px solid #bcc8d8;margin:16px 0;padding:1px 18px;color:#58667a}hr{border:0;border-top:1px solid #e6ebf1;margin:28px 0}a{color:#245bdb;overflow-wrap:anywhere}.warnings{background:#fff9e9;border:1px solid #f3e6bb;padding:12px 18px;border-radius:8px;margin-bottom:20px;font-size:14px}@media(max-width:600px){body{margin:12px auto;padding:0 10px}article{padding:22px 18px}}@media print{body{background:white;margin:0;max-width:none}article{border:0;padding:0}}
  .table-scroll{overflow-x:auto}table{display:table} .notes{color:#66778e;font-size:14px;margin:12px 0}
  article>h2{background:#f4f7fc;padding:10px 16px;border-radius:0 8px 8px 0;letter-spacing:.02em}blockquote{background:#f8fafc;border-left:3px solid #c9d5e5;border-radius:0 6px 6px 0;padding:6px 14px;margin:18px 0;color:#64748b;font-size:13px;line-height:1.7;overflow-wrap:anywhere}blockquote p{margin:4px 0}article>hr{margin:34px 0 24px}article>h1{font-size:23px;color:#172b4d}th{font-weight:600}pre{font-size:14px}
  math{font-size:1.1em}math[display="block"]{overflow-x:auto;padding:12px 0}.math-error{color:#9c3434}
  </style></head><body><header><small>LarkAnything · Local preview · 飞书最终样式以实际文档为准</small><h1>${escapeHtml(title)}</h1></header>${notes.map(w => `<p class="notes">${escapeHtml(w.message)}</p>`).join('')}${issues.length ? `<aside class="warnings"><strong>转换说明</strong><ul>${issues.map(w => `<li>${escapeHtml(w.message)}</li>`).join('')}</ul></aside>` : ''}<article>${article}</article></body></html>`;
}
