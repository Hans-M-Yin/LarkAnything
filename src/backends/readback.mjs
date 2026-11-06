import MarkdownIt from 'markdown-it';
import { protectMath, transportTex } from '../renderers/math.mjs';

const md = new MarkdownIt({ html: false, linkify: false, typographer: false });
const boundary = '\u0000link\u0000';
const escapePattern = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function canonical(body, linkBoundaries = false, legacyMath = false) {
  const blocks = [], codes = [], formulas = [];
  // These are rendered Markdown documents, not source messages: backslash
  // parentheses/brackets escape literal punctuation. Real formulas were
  // emitted as <latex> and Feishu fetch exports them with dollar delimiters.
  const math = legacyMath ? { body, restore: text => text } : protectMath(body, { native: true, markdownEscapes: true });
  const code = (kind, text) => {
    codes.push({ kind, text });
    // Encoding protects code whitespace from prose normalization and prevents
    // prose that has lost its code structure from passing verification.
    return `\u0000${kind}:${JSON.stringify(text)}\u0000`;
  };
  for (const token of md.parse(math.body, {})) {
    if (token.children) {
      let text = '', prose = '';
      const flush = () => { text += prose.replace(/\s+/gu, ' '); prose = ''; };
      for (const child of token.children) {
        if (child.type === 'code_inline') { flush(); text += code('inline-code', child.content); }
        else if (child.type === 'text') prose += child.content;
        else if (['softbreak', 'hardbreak'].includes(child.type)) prose += ' ';
        else if (linkBoundaries && ['link_open', 'link_close'].includes(child.type)) prose += boundary;
      }
      flush(); blocks.push(text);
    } else if (['fence', 'code_block'].includes(token.type)) blocks.push(code('block-code', token.content));
  }
  const text = math.restore(blocks.filter(Boolean).join(' ').trim(), formula => {
    const tex = transportTex(formula.tex);
    formulas.push(tex);
    return `\u0000math:${JSON.stringify(tex)}\u0000`;
  });
  return { text, codes, formulas };
}

export function verifyMarkdownReadback(expectedBody, actualBody, { legacyMath = false } = {}) {
  // Old frozen plans explicitly warned that math was sent as Markdown text.
  // Retry those with their original contract; native formulas can never opt out.
  legacyMath = legacyMath && !protectMath(expectedBody, { native: true }).formulas.some(formula => formula.native);
  const normalizations = legacyMath ? ['legacy-math-as-text'] : [];
  if (!legacyMath && protectMath(expectedBody, { native: true }).formulas.some(f => transportTex(f.tex) !== f.tex)) normalizations.push('math-source-layout');
  // The fetch transport prepends document metadata; it is not body coverage.
  const body = actualBody.replace(/^\s*<title>[^\r\n]*<\/title>(?:\r?\n|$)/, '');
  const expected = canonical(expectedBody, false, legacyMath), actual = canonical(body, false, legacyMath);
  const result = { passed: false, method: legacyMath ? 'markdown-text-and-code-legacy-math' : 'markdown-text-and-code', expectedCharacters: expected.text.length,
    actualCharacters: actual.text.length, visualVerified: false };
  if (!expected.text) return { ...result, difference: { kind: 'empty-expected' } };
  if (actual.text.includes(expected.text)) return { ...result, passed: true, normalizations };
  // Lark may add/remove whitespace at the edge of a link. Relax only those
  // known boundaries in the source; prose elsewhere and all code remain exact.
  const linked = canonical(expectedBody, true, legacyMath).text;
  if (linked.includes(boundary)) {
    const pattern = linked.replace(/ *\u0000link\u0000 */g, boundary).split(boundary).map(escapePattern).join(' *');
    if (new RegExp(pattern, 'u').test(actual.text)) return { ...result, passed: true, normalizations: [...normalizations, 'link-boundary-whitespace'] };
  }
  const codeMismatch = expected.codes.some(c => !actual.codes.some(a => a.kind === c.kind && a.text === c.text));
  const mathMismatch = expected.formulas.some(formula => !actual.formulas.includes(formula));
  // A short prefix anchors diagnostics after a fetched title or append prefix.
  const anchor = actual.text.indexOf(expected.text.slice(0, 48));
  const comparison = anchor >= 0 ? actual.text.slice(anchor) : actual.text;
  let offset = 0;
  while (offset < Math.min(expected.text.length, comparison.length) && expected.text[offset] === comparison[offset]) offset++;
  return { ...result, difference: { kind: codeMismatch ? 'code' : mathMismatch ? 'math' : 'text', offset,
    expected: expected.text.slice(Math.max(0, offset - 32), offset + 96),
    actual: comparison.slice(Math.max(0, offset - 32), offset + 96) } };
}
