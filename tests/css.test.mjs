import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  parseCss, walkRules, walkDeclarations, stripComments, firstStatements, selectorClasses,
  themeDeclarations, darkBlocks,
} from '../scripts/lib/css.mjs';

const REF = readFileSync(fileURLToPath(new URL('../fixtures/theme.reference.css', import.meta.url)), 'utf8');

test('reference: @theme token counts per prefix', () => {
  const { nodes } = parseCss(REF);
  const counts = {};
  for (const d of themeDeclarations(nodes)) {
    const p = d.prop.split('-')[2];
    counts[p] = (counts[p] ?? 0) + 1;
  }
  assert.deepEqual(counts, { font: 3, color: 16, radius: 1, shadow: 2, ease: 1 });
});

test('reference: both dark blocks have 18 tokens plus color-scheme', () => {
  const { nodes } = parseCss(REF);
  const { dataTheme, media } = darkBlocks(nodes);
  for (const b of [dataTheme, media]) {
    assert.equal(b.found, true);
    assert.equal(b.decls.length, 19);
    assert.equal(b.decls.filter((d) => d.prop.startsWith('--')).length, 18);
    assert.ok(b.decls.some((d) => d.prop === 'color-scheme' && d.value === 'dark'));
  }
});

test('reference: top-level structure', () => {
  const { nodes } = parseCss(REF);
  const top = nodes.filter((n) => n.type !== 'comment').map((n) => `${n.name}:${n.params}`);
  assert.deepEqual(top, [
    'import:"tailwindcss"',
    'source:"../"',
    'import:"@fontsource-variable/inter/wght.css"',
    'import:"@fontsource-variable/source-serif-4/wght.css"',
    'theme:',
    'layer:base',
    'layer:components',
    'utility:panel',
  ]);
  assert.equal(nodes[0].type, 'comment');
  assert.equal(nodes[0].line, 1);
  const imp = nodes.find((n) => n.name === 'import');
  assert.equal(imp.line, 7);
  assert.deepEqual(imp.children, []);
});

test('reference: classes in @layer components and base', () => {
  const { nodes } = parseCss(REF);
  const cls = new Set();
  walkRules(nodes, (n, anc) => {
    if (n.type === 'rule' && anc.some((a) => a.name === 'layer')) selectorClasses(n.selector).forEach((c) => cls.add(c));
  });
  for (const c of ['card-link', 'stretched', 'only-dark', 'only-light', 'skip-link', 'btn-primary', 'prose', 'hero-wash', 'num-badge']) {
    assert.ok(cls.has(c), c);
  }
  assert.equal(cls.size, 26);
});

test('reference: !important only in reduced-motion block', () => {
  const { nodes } = parseCss(REF);
  const imp = [];
  walkDeclarations(nodes, (d, node, anc) => {
    if (d.important) imp.push({ d, node, anc });
  });
  assert.equal(imp.length, 2);
  for (const { d, anc } of imp) {
    assert.ok(anc.some((a) => a.name === 'media' && a.params.includes('prefers-reduced-motion')));
    assert.ok(!d.value.includes('important'));
  }
});

test('strings, url(), multi-line values and comments', () => {
  const css = `
  /* top */
  .a { content: "x; { y }"; background: url(data:image/svg+xml;utf8,<svg>{}</svg>) no-repeat; }
  .b {
    background:
      radial-gradient(1rem 2rem at 0 0, red, /* inline */ blue),
      linear-gradient(red, blue);
    color: red !important;
    font-family: 'A; B', serif
  }`;
  const { nodes } = parseCss(css);
  const rules = nodes.filter((n) => n.type === 'rule');
  assert.equal(rules.length, 2);
  assert.equal(rules[0].declarations[0].value, '"x; { y }"');
  assert.match(rules[0].declarations[1].value, /^url\(data:image\/svg\+xml;utf8,<svg>\{\}<\/svg>\) no-repeat$/);
  const b = rules[1].declarations;
  assert.equal(b.length, 3);
  assert.equal(b[0].value, 'radial-gradient(1rem 2rem at 0 0, red, blue), linear-gradient(red, blue)');
  assert.equal(b[0].line, 5);
  assert.deepEqual([b[1].value, b[1].important], ['red', true]);
  assert.equal(b[2].value, "'A; B', serif");
  assert.equal(nodes[0].type, 'comment');
});

test('nested at-rules and @utility / @theme', () => {
  const css = `@layer a { @media (min-width: 1px) { @supports (display: grid) { .x { color: red } } } }
@utility tab-4 { tab-size: 4; }
@theme { --x: y; --font-z: "Q", serif; }
@import url("https://example.com/x.css");`;
  const { nodes } = parseCss(css);
  const seen = [];
  walkRules(nodes, (n, anc) => seen.push(`${n.type === 'rule' ? n.selector : '@' + n.name}#${anc.length}`));
  assert.deepEqual(seen, ['@layer#0', '@media#1', '@supports#2', '.x#3', '@utility#0', '@theme#0', '@import#0']);
  assert.equal(nodes[1].params, 'tab-4');
  assert.deepEqual(nodes[2].declarations.map((d) => [d.prop, d.value]), [['--x', 'y'], ['--font-z', '"Q", serif']]);
  assert.equal(nodes[3].params, 'url("https://example.com/x.css")');
});

test('unbalanced input throws with a line number', () => {
  assert.throws(() => parseCss('.a { color: red;\n'), /line 1: unclosed/);
  assert.throws(() => parseCss('.a { }\n}'), /line 2: unexpected/);
  assert.throws(() => parseCss('/* x'), /unterminated comment/);
});

test('stripComments keeps line count and strings', () => {
  const s = '/* a\nb */ .x { content: "/* no */"; }\n/* c */';
  const out = stripComments(s);
  assert.equal(out.split('\n').length, s.split('\n').length);
  assert.ok(out.includes('"/* no */"'));
  assert.ok(!out.includes('/* a'));
});

test('firstStatements ignores the leading comment', () => {
  assert.deepEqual(firstStatements(REF, 2), ['@import "tailwindcss";', '@source "../";']);
  assert.deepEqual(firstStatements('\n\n/* x */\n.a{}\n@import "b";', 2), ['.a {', '@import "b";']);
});

test('selectorClasses', () => {
  assert.deepEqual(selectorClasses('.card-link > a.stretched::after'), ['card-link', 'stretched']);
  assert.deepEqual(selectorClasses('.card-link:hover, .card-link:focus-within'), ['card-link']);
  assert.deepEqual(selectorClasses(':root[data-theme="dark"] .only-dark'), ['only-dark']);
  assert.deepEqual(selectorClasses('.prose > * + *'), ['prose']);
  assert.deepEqual(selectorClasses('a[href$=".pdf"] .x:not(.y)'), ['x', 'y']);
  assert.deepEqual(selectorClasses('.md\\:flex'), ['md:flex']);
  assert.deepEqual(selectorClasses('html, body'), []);
});
