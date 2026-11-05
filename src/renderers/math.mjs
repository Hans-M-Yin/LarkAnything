import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({ html: false, linkify: false, typographer: false });
const escapeXml = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/\r/g, '&#13;').replace(/\n/g, '&#10;');
const decodeXml = text => text.replace(/&(amp|lt|gt|quot|apos|#10|#13);/g,
  (_, entity) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#10': '\n', '#13': '\r' })[entity]);

function escaped(source, index) {
  let count = 0;
  while (index > 0 && source[--index] === '\\') count++;
  return count % 2 === 1;
}

function codeRanges(source) {
  const offsets = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') offsets.push(i + 1);
  return md.parse(source, {}).filter(token => ['fence', 'code_block'].includes(token.type) && token.map)
    .map(token => [offsets[token.map[0]], offsets[token.map[1]] ?? source.length]);
}

function codeSpanEnd(source, start) {
  const run = /^`+/.exec(source.slice(start))[0];
  for (const close of source.slice(start + run.length).matchAll(/`+/g)) {
    if (close[0].length === run.length) return start + run.length + close.index + run.length;
  }
  return start + run.length;
}

function linkEnd(source, start) {
  let depth = 1;
  for (let i = start + 2; i < source.length; i++) {
    if (source[i] === '\\') { i++; continue; }
    if (source[i] === '(') depth++;
    if (source[i] === ')' && --depth === 0) return i + 1;
  }
  return start + 2;
}

function formulaAt(source, start, native) {
  if (escaped(source, start)) return;
  if (native && source.startsWith('<latex>', start)) {
    const end = source.indexOf('</latex>', start + 7);
    if (end >= 0) {
      const before = source.slice(source.lastIndexOf('\n', start - 1) + 1, start);
      const after = source.slice(end + 8).split('\n', 1)[0];
      return { tex: decodeXml(source.slice(start + 7, end)), end: end + 8, native: true, display: /^[\s>]*$/.test(before) && !after.trim() };
    }
  }
  let open, close, display;
  if (source.startsWith('\\[', start)) { open = '\\['; close = '\\]'; display = true; }
  else if (source.startsWith('\\(', start)) { open = '\\('; close = '\\)'; display = false; }
  else if (source[start] === '$') {
    display = source[start + 1] === '$';
    open = close = display ? '$$' : '$';
    // Match conventional inline delimiters, not currency such as "$5 and $10".
    if (!display && (/\s/.test(source[start + 1] || '') || !source[start + 1] || source[start - 1] === '$')) return;
  } else return;
  let end = start + open.length;
  while ((end = source.indexOf(close, end)) >= 0) {
    if (escaped(source, end)) { end += close.length; continue; }
    if (close === '$' && (source[end + 1] === '$' || /\s/.test(source[end - 1]) || /\d/.test(source[end + 1] || ''))) { end++; continue; }
    const tex = source.slice(start + open.length, end);
    if (!tex.trim() || (!display && /\n\s*\n/.test(tex))) return;
    // Quoted math has Markdown's container prefix on each continuation line.
    const prefix = source.slice(source.lastIndexOf('\n', start - 1) + 1, start);
    const quote = /^( {0,3}(?:> ?)+)\s*$/.exec(prefix)?.[1];
    const content = quote ? tex.split('\n').map(line => line.startsWith(quote) ? line.slice(quote.length) : line).join('\n') : tex;
    return { tex: content.trim(), display, end: end + close.length };
  }
}

// Hide formulas before Markdown parses headings/emphasis or escapes native tags.
// Markers cannot collide with authored text and never occur in code or link URLs.
export function protectMath(source, { native = false } = {}) {
  let prefix = 'LARKANYTHINGMATHTOKEN';
  while (source.includes(prefix)) prefix += 'X';
  const formulas = [], unclosed = [], ranges = codeRanges(source);
  let body = '', index = 0, range = 0;
  while (index < source.length) {
    while (range < ranges.length && ranges[range][1] <= index) range++;
    let end;
    if (ranges[range]?.[0] <= index && index < ranges[range][1]) end = ranges[range][1];
    else if (source[index] === '`' && !escaped(source, index)) end = codeSpanEnd(source, index);
    else if (source.startsWith('](', index) && !escaped(source, index)) end = linkEnd(source, index);
    else if (source.startsWith('http', index)) {
      const url = /^https?:\/\/[^\s<>]+/.exec(source.slice(index));
      if (url) end = index + url[0].length;
    }
    else if ((index === 0 || source[index - 1] === '\n') && /^ {0,3}\[[^\]\n]+\]:/.test(source.slice(index))) {
      const close = source.indexOf('\n', index);
      end = close < 0 ? source.length : close;
    }
    else if (source[index] === '<' && /^<(?:https?:\/\/|mailto:)/.test(source.slice(index))) {
      const close = source.indexOf('>', index + 1);
      if (close >= 0) end = close + 1;
    }
    if (end !== undefined) { body += source.slice(index, end); index = end; continue; }
    const formula = ['\\', '$', '<'].includes(source[index]) ? formulaAt(source, index, native) : undefined;
    if (formula) {
      const marker = `${prefix}${formulas.length}END`;
      formulas.push({ ...formula, marker });
      body += marker;
      index = formula.end;
    } else {
      if (!escaped(source, index) && ['\\[', '\\(', '$$'].some(delimiter => source.startsWith(delimiter, index))) unclosed.push(index);
      if (source[index] === '\\') { body += source.slice(index, index + 2); index += 2; }
      else body += source[index++];
    }
  }
  const restore = (text, render) => {
    const pattern = new RegExp(`${prefix}(\\d+)END`, 'g');
    return text.replace(pattern, (marker, number) => formulas[Number(number)] ? render(formulas[Number(number)]) : marker);
  };
  return { body, formulas, unclosed, restore };
}

export const nativeFormula = formula => `<latex>${escapeXml(formula.tex)}</latex>`;
