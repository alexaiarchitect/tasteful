import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, REF, REF_TEXT, tmpFile } from './_run.mjs';

const check = (cand, extra = []) => run('contract.mjs', [REF, cand, '--check', ...extra]);
const json = (cand) => JSON.parse(run('contract.mjs', [REF, cand, '--json']).stdout);

test('reference vs reference passes', () => {
  const r = check(REF);
  assert.equal(r.code, 0, r.stdout);
  const out = JSON.parse(check(REF, ['--json']).stdout);
  assert.equal(out.ok, true);
  assert.equal(out.first_lines_ok, true);
  assert.deepEqual(out.important, []);
  assert.deepEqual(out.missing, { tokens: [], classes: [], utilities: [] });
});

test('renamed token fails with a rename hint', () => {
  const r = check('tests/fixtures/renamed-token.css');
  assert.equal(r.code, 1);
  assert.match(r.stdout, /missing --color-ink \(likely renamed to --color-text\)/);
  const out = json('tests/fixtures/renamed-token.css');
  assert.deepEqual(out.renamed, [{ from: '--color-ink', to: '--color-text' }]);
  assert.deepEqual(out.added.tokens, ['--color-text']);
  // without --check: always 0
  assert.equal(run('contract.mjs', [REF, 'tests/fixtures/renamed-token.css']).code, 0);
});

test('missing class, utility and dark override', () => {
  const f = tmpFile(
    REF_TEXT.replace(/\.value-pill \{[^}]*\}/, '')
      .replace(/@utility panel \{[^}]*\}/, '')
      .replace(/(:root\[data-theme="dark"\] \{[\s\S]*?)--shadow-card-hover:[^;]*;/, '$1'),
  );
  const out = json(f);
  assert.deepEqual(out.missing.classes, ['value-pill']);
  assert.deepEqual(out.missing.utilities, ['panel']);
  assert.deepEqual(out.dark_missing, { data_theme: ['--shadow-card-hover'], media: [] });
  assert.equal(check(f).code, 1);
});

test('first two statements, !important, external import', () => {
  const swapped = tmpFile(REF_TEXT.replace('@import "tailwindcss";\n@source "../";', '@source "../";\n@import "tailwindcss";'));
  assert.equal(json(swapped).first_lines_ok, false);
  assert.equal(check(swapped).code, 1);

  const imp = tmpFile(REF_TEXT.replace('.mono { font-family: var(--font-mono);', '.mono { font-family: var(--font-mono) !important;'));
  const o = json(imp);
  assert.equal(o.important.length, 1);
  assert.match(o.important[0].text, /font-family/);

  const ext = tmpFile(
    REF_TEXT.replace(
      '@import "@fontsource-variable/inter/wght.css";',
      '@import url("https://fonts.googleapis.com/css2?family=Inter");\n@import "//cdn.example.com/x.css";',
    ),
  );
  assert.equal(json(ext).external_imports.length, 2);
  assert.equal(check(ext).code, 1);
});

test('additions are info only', () => {
  const f = tmpFile(REF_TEXT.replace('--ease-out-quint:', '--color-brand: #123456;\n  --ease-out-quint:').replace('.mono {', '.badge-new { color: red; }\n  .mono {'));
  // a new colour token must also be overridden in dark
  const out = json(f);
  assert.deepEqual(out.added.tokens, ['--color-brand']);
  assert.deepEqual(out.added.classes, ['badge-new']);
  assert.deepEqual(out.dark_missing.data_theme, ['--color-brand']);
});

test('exit 2 on unreadable file', () => {
  assert.equal(run('contract.mjs', [REF, 'missing.css', '--check']).code, 2);
  assert.equal(run('contract.mjs', [REF]).code, 2);
});
