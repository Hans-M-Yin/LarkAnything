import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareMarkdown, previewHtml, markdownText } from '../src/renderers/markdown.mjs';
import { protectMath } from '../src/renderers/math.mjs';
import { verifyMarkdownReadback } from '../src/backends/readback.mjs';
import { createLarkAnything, LarkCliBackend } from '../src/index.mjs';

const reward = String.raw`r(\tau)
=
r_{\text{答案与格式}}(\tau) + 0.1\sum_i \operatorname{MBE}(g_i,s_i,v_i)`;
const source = `公式：\n\n\\[\n${reward}\n\\]\n\n后续正文。`;

test('Multiline reward formula becomes a native formula before equals can become a heading', () => {
  const warnings = [];
  const body = prepareMarkdown(source, warnings);
  assert.match(body, /<latex>r\(\\tau\)&#10;=&#10;r_\{/);
  assert.ok(body.includes(String.raw`r_{\text{答案与格式}}(\tau)`));
  assert.ok(!body.includes('###'));
  assert.ok(!body.includes('\\['));
  assert.deepEqual(warnings, []);
  assert.ok(markdownText(body).includes(String.raw`r_{\text{答案与格式}}(\tau)`));
});

test('Parenthesis, bracket and dollar delimiters preserve LaTeX, comparisons and matrices', () => {
  for (const source of [String.raw`\(x_i^2\)`, String.raw`\[x_i^2\]`, '$x_i^2$', '$$x_i^2$$']) {
    assert.equal(prepareMarkdown(source, []), '<latex>x_i^2</latex>');
  }
  const tex = String.raw`\begin{aligned}a &< b \\ c &= d\end{aligned}`;
  const body = prepareMarkdown(`$$\n${tex}\n$$`, []);
  assert.equal(body, String.raw`<latex>\begin{aligned}a &amp;&lt; b \\ c &amp;= d\end{aligned}</latex>`);
  assert.equal(protectMath(body, { native: true }).formulas[0].tex, tex);
});

test('Currency, escaped delimiters, code and URLs are never converted to formulas', () => {
  const cases = [
    'Prices are $5 and $10.',
    String.raw`Literal \$x_i\$ and \\(x_i\\).`,
    '`$x_i$` and ``\\[\nx_i\n\\]``',
    '```latex\n\\[x_i\\]\n$$y_i$$\n```',
    '    $$x_i$$\n',
    '[link](https://example.com/$a$b) and <https://example.com/$a$b>',
    'Plain https://example.com/$a$b and https://example.com/\\(x\\)',
    '[reference]: https://example.com/$a$b',
    'Literal LARKANYTHINGMATHTOKEN0END.',
  ];
  for (const source of cases) assert.equal(protectMath(source).body, source);
  assert.equal(prepareMarkdown('`$x_i$`', []), '`$x_i$`');
  assert.equal(prepareMarkdown('```latex\n\\[x_i\\]\n```', []), '```latex\n\\[x_i\\]\n```');
  const warnings = [];
  prepareMarkdown('```latex\n$$x_i$$\n\\[x_i\\]\n```', warnings);
  assert.deepEqual(warnings, []);
});

test('Literal native XML stays escaped and TeX cannot activate resource tags', () => {
  assert.equal(prepareMarkdown('<latex>x_i</latex>', []), '\\<latex>x_i\\</latex>');
  const body = prepareMarkdown(String.raw`\[x < y + \text{<source path="@./private"/>}\]`, []);
  assert.ok(body.includes('&lt;source'));
  assert.ok(!body.includes('<source'));
  assert.equal((body.match(/<latex>/g) || []).length, 1);
  assert.equal((body.match(/<\/latex>/g) || []).length, 1);
});

test('Quoted formulas and TeX comments retain their content and newlines', () => {
  const body = prepareMarkdown('> \\[\n> x_i % keep this comment\n> + y_i\n> \\]', []);
  const formula = protectMath(body, { native: true }).formulas[0];
  assert.equal(formula.tex, 'x_i % keep this comment\n+ y_i');
  assert.ok(body.startsWith('> <latex>'));
});

test('Unmatched formula delimiters produce a warning without inventing missing math', () => {
  const warnings = [];
  const body = prepareMarkdown(String.raw`Before \[x_i`, warnings);
  assert.ok(!body.includes('<latex>'));
  assert.equal(warnings[0].code, 'MATH_DELIMITER_UNCLOSED');
});

test('Preview renders offline MathML and gracefully preserves invalid formula source', () => {
  const body = prepareMarkdown(source, []);
  const html = previewHtml('Reward', { body, warnings: [] });
  assert.ok(html.includes('<math'));
  assert.ok(html.includes('<msub>'));
  assert.ok(html.includes('答案与格式'));
  assert.ok(!html.includes('<script'));
  assert.ok(!html.includes('<link'));
  const invalid = previewHtml('Invalid', { body: prepareMarkdown(String.raw`\(\invalidCommand{x}\)`, []), warnings: [] });
  assert.ok(invalid.includes('math-error'));
  assert.ok(invalid.includes(String.raw`\invalidCommand{x}`));
});

test('Readback matches native formulas against dollar exports and rejects lost math structure', () => {
  const tex = String.raw`r_{\text{答案与格式}}(\tau) + 0.1\sum_i \operatorname{MBE}(g_i,s_i,v_i)`;
  const body = prepareMarkdown(`Reward $${tex}$ END`, []);
  assert.equal(verifyMarkdownReadback(body, `Reward $${tex}$ END`).passed, true);
  assert.equal(verifyMarkdownReadback(body, `Reward $$${tex}$$ END`).passed, true);
  for (const actual of [`Reward $${tex.replace('0.1', '0.2')}$ END`, `Reward ${tex} END`, `Reward $${tex.replace('r_', 'r')}$ END`]) {
    const result = verifyMarkdownReadback(body, actual);
    assert.equal(result.passed, false);
    assert.equal(result.difference.kind, 'math');
  }
});

test('Old frozen plans explicitly retain their original text-only math verification', async () => {
  const expected = 'Equation:\n\n\\[a + b\\]\n\nUse `a b` END';
  let content = 'Equation:\n\n[a + b]\n\nUse `a b` END';
  const backend = new LarkCliBackend({}, async () => ({ ok: true, data: { document: { document_id: 'old-math', content } } }));
  const plan = { artifact: { body: expected, warnings: [{ code: 'MATH_NOT_VERIFIED' }] } };
  const result = await backend.verify({ documentId: 'old-math' }, plan);
  assert.equal(result.passed, true);
  assert.equal(result.method, 'markdown-text-and-code-legacy-math');
  assert.deepEqual(result.normalizations, ['legacy-math-as-text']);
  assert.equal(verifyMarkdownReadback(expected, content).passed, false);
  content = content.replace('a + b', 'a + c');
  assert.equal((await backend.verify({ documentId: 'old-math' }, plan)).passed, false);
  content = 'Equation:\n\n[a + b]\n\nUse `ab` END';
  assert.equal((await backend.verify({ documentId: 'old-math' }, plan)).difference.kind, 'code');
});

test('Legacy compatibility cannot disable verification of a native formula', async () => {
  const expected = prepareMarkdown('Equation: \\(a_i + b_i\\)', []);
  const actual = 'Equation: a_i + b_i';
  const result = verifyMarkdownReadback(expected, actual, { legacyMath: true });
  assert.equal(result.passed, false);
  assert.equal(result.difference.kind, 'math');
  assert.equal(result.method, 'markdown-text-and-code');
});

test('End-to-end plan and backend publish send native formulas, including progress quotes', async () => {
  const adapter = { id: 'math-fixture', version: 1, async load() { return {
    version: 1, kind: 'conversation', id: 'math', title: 'Reward', source: { channel: 'math-fixture' },
    messages: [{ id: 'm', role: 'assistant', phase: 'commentary', content: [{ type: 'text', format: 'markdown', text: source }] }],
  }; } };
  const plan = await createLarkAnything({ adapters: [adapter] }).plan({ channel: 'math-fixture', input: 'unused', overrides: { format: { unsupported: 'error' } } });
  assert.ok(plan.artifact.body.includes('> <latex>'));
  assert.ok(!plan.artifact.body.includes('### r('));
  let written;
  const backend = new LarkCliBackend({}, async (_executable, args, options) => {
    if (args.includes('+create')) written = options.input;
    return { ok: true, data: { document: { document_id: 'math-doc', content: written } } };
  });
  const receipt = await backend.publish(plan);
  assert.equal(written, plan.artifact.body);
  assert.equal((await backend.verify(receipt, plan)).passed, true);
});
