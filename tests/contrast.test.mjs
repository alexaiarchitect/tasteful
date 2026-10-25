import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, REF, REF_TEXT, tmpFile } from './_run.mjs';

const json = (r) => JSON.parse(r.stdout);
const pair = (out, scheme, fg, bg) => out.pairs.find((p) => p.scheme === scheme && p.fg === fg && p.bg === bg);

test('reference passes with the expected ratios', () => {
  const r = run('contrast.mjs', [REF, '--json']);
  assert.equal(r.code, 0, r.stderr);
  const out = json(r);
  assert.equal(out.ok, true);
  assert.deepEqual(out.errors, []);
  assert.equal(out.pairs.length, 8);
  const near = (v, want, tol = 0.35) => assert.ok(Math.abs(v - want) <= tol, `${v} vs ${want}`);
  near(pair(out, 'light', '--color-ink', '--color-bg').ratio, 16.5, 0.6);
  near(pair(out, 'light', '--color-muted', '--color-bg').ratio, 5.6);
  near(pair(out, 'light', '--color-accent', '--color-bg').ratio, 5.3);
  near(pair(out, 'light', '--color-accent-ink', '--color-accent').ratio, 5.8);
  near(pair(out, 'dark', '--color-muted', '--color-bg').ratio, 8.2);
  near(pair(out, 'dark', '--color-accent', '--color-bg').ratio, 7.8, 0.3);
  near(pair(out, 'dark', '--color-accent-ink', '--color-accent').ratio, 7.8, 0.3);
  assert.equal(pair(out, 'dark', '--color-ink', '--color-bg').fg_hex, '#e9ecf1');
});

test('human table on stdout, nothing else', () => {
  const r = run('contrast.mjs', [REF]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /scheme \| pair/);
  assert.match(r.stdout, /dark\s+\| muted \/ bg\s+\| 8\.19/);
});

test('bad contrast fails and --suggest proposes a passing colour', () => {
  const r = run('contrast.mjs', ['tests/fixtures/bad-contrast.css', '--suggest', '--json']);
  assert.equal(r.code, 1);
  const out = json(r);
  const p = pair(out, 'light', '--color-muted', '--color-bg');
  assert.equal(p.pass, false);
  assert.equal(p.fg_hex, '#9a9a9a');
  assert.ok(p.suggest.ratio >= 4.5);
  assert.equal(out.pairs.filter((x) => !x.pass).length, 1);
  const h = run('contrast.mjs', ['tests/fixtures/bad-contrast.css', '--suggest']);
  assert.equal(h.code, 1);
  assert.match(h.stdout, /light: --color-muted #9a9a9a -> #[0-9a-f]{6}/);
});

test('dark blocks must agree', () => {
  const f = tmpFile(REF_TEXT.replace(/(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{[\s\S]*?)--color-muted: #a2aab6;/, '$1--color-muted: #a2aab7;'));
  const r = run('contrast.mjs', [f, '--json']);
  assert.equal(r.code, 1);
  assert.match(json(r).errors.join('\n'), /--color-muted is #a2aab6 .* but #a2aab7/);
});

test('dark inherits unset tokens from @theme', () => {
  const f = tmpFile(REF_TEXT.replace(/\n\s*--color-accent-ink: #0b1020;/g, ''));
  const out = json(run('contrast.mjs', [f, '--json']));
  const p = pair(out, 'dark', '--color-accent-ink', '--color-accent');
  assert.equal(p.fg_hex, '#ffffff');
  assert.equal(p.pass, false);
});

test('--extended adds advisory pairs that never change the exit code', () => {
  const r = run('contrast.mjs', [REF, '--extended', '--json']);
  assert.equal(r.code, 0);
  const out = json(r);
  assert.equal(out.pairs.length, 20);
  assert.ok(out.pairs.some((p) => !p.required && !p.pass)); // warn/warn-soft light is 4.39
});

test('exit 2: missing file, unparseable file, missing required token', () => {
  assert.equal(run('contrast.mjs', ['nope.css']).code, 2);
  assert.equal(run('contrast.mjs', [tmpFile('@theme { --color-bg: #fff;')]).code, 2);
  const r = run('contrast.mjs', [tmpFile(REF_TEXT.replace('--color-muted: #5c6370;', ''))]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--color-muted/);
  assert.equal(run('contrast.mjs', []).code, 2);
});

const LAYER = (muted) => `/* Site layer */
:root { --color-muted: ${muted}; }
:root[data-theme="dark"] { --color-muted: #a2aab6; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --color-muted: #a2aab6; } }
`;

test('--overlay: merged schemes pass, JSON names the overlay', () => {
  const r = run('contrast.mjs', [REF, '--overlay', 'fixtures/runs/ai-architect-blog/site.ai-architect-blog.css', '--json']);
  assert.equal(r.code, 0, r.stdout);
  const out = json(r);
  assert.equal(out.overlay, 'fixtures/runs/ai-architect-blog/site.ai-architect-blog.css');
  assert.equal(pair(out, 'light', '--color-ink', '--color-bg').fg_hex, '#3a3934');
  assert.equal(pair(out, 'dark', '--color-ink', '--color-bg').bg_hex, '#262521');
  const h = run('contrast.mjs', [REF, '--overlay', 'fixtures/runs/ai-architect-blog/site.ai-architect-blog.css']);
  assert.match(h.stdout, /^contrast: \S+theme\.reference\.css \+ fixtures\/runs\/ai-architect-blog\/site\.ai-architect-blog\.css\n/);
});

test('--overlay: low-contrast --color-muted on :root fails in light only', () => {
  const r = run('contrast.mjs', [REF, '--overlay', tmpFile(LAYER('#a0a0a0')), '--json']);
  assert.equal(r.code, 1);
  const out = json(r);
  assert.equal(pair(out, 'light', '--color-muted', '--color-bg').pass, false);
  assert.equal(pair(out, 'dark', '--color-muted', '--color-bg').pass, true);
  assert.equal(run('contrast.mjs', [REF, '--overlay', tmpFile(LAYER('#555555'))]).code, 0);
});

test('--overlay: no dark block is fine, one of two is an error, a mismatch is an error', () => {
  assert.equal(run('contrast.mjs', [REF, '--overlay', tmpFile(':root { --color-bg: #ffffff; }\n')]).code, 0);
  assert.equal(run('contrast.mjs', [REF, '--overlay', tmpFile('/* empty layer */\n')]).code, 0);
  const one = run('contrast.mjs', [REF, '--overlay', 'tests/fixtures/overlay-missing-dark.css', '--json']);
  assert.equal(one.code, 1);
  assert.match(json(one).errors.join('\n'), /no @media \(prefers-color-scheme: dark\)/);
  const mm = run('contrast.mjs', [REF, '--overlay', tmpFile(LAYER('#555555').replace(/(:root:not[^{]*\{ --color-muted: )#a2aab6/, '$1#a2aab7')), '--json']);
  assert.equal(mm.code, 1);
  assert.match(json(mm).errors.join('\n'), /--color-muted is #a2aab6 .* but #a2aab7/);
  assert.equal(run('contrast.mjs', [REF, '--overlay', 'missing.css']).code, 2);
});
