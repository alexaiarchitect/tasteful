// tasteful — tests/fonts.test.mjs
//
// fonts.mjs name matching against index/fonts.json, without network (no --verify):
// Next.js hashed names, Framer ":Weight" suffixes, Webflow lowercase concatenations,
// proprietary faces, unmapped names (exit 1) and --help (exit 0).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FONTS = join(ROOT, 'scripts', 'fonts.mjs');

function run(args) {
  const r = spawnSync(process.execPath, [FONTS, ...args], { encoding: 'utf8', env: { ...process.env, TASTEFUL_DEBUG: '0' }, timeout: 15000 });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

test('maps hashed, suffixed, concatenated and proprietary names; exit 0', () => {
  const r = run(['__Inter_d65c78', 'Inter:Regular', 'Ppneuemontreal', 'Atlasgrotesk Web', 'Reckless Neue', 'Switzer', '--json']);
  assert.equal(r.code, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  const by = Object.fromEntries(j.map((x) => [x.observed, x]));
  assert.equal(by['__Inter_d65c78'].package, '@fontsource-variable/inter');
  assert.equal(by['__Inter_d65c78'].alternative, false);
  assert.equal(by['Inter:Regular'].package, '@fontsource-variable/inter');
  assert.equal(by['Inter:Regular'].alternative, false);
  assert.ok(by['Ppneuemontreal'].family, 'Webflow concatenation matches the PP Neue Montreal alias');
  assert.equal(by['Ppneuemontreal'].alternative, true);
  assert.equal(by['Atlasgrotesk Web'].family, 'Inter');
  assert.equal(by['Reckless Neue'].family, 'Fraunces');
  assert.equal(by['Reckless Neue'].alternative, true);
  assert.equal(by['Reckless Neue'].cyrillic, false);
  assert.match(by['Reckless Neue'].note, /Newsreader/);
  assert.equal(by['Switzer'].family, 'Manrope');
  for (const x of j) assert.equal(x.verified, null, 'no network without --verify');
});

test('Placeholder entries are skipped, not failed', () => {
  const r = run(['Placeholder', 'Inter', '--json']);
  assert.equal(r.code, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j[0].skipped, 'placeholder');
  assert.equal(j[1].family, 'Inter');
});

test('an unmapped name exits 1 with error "unmapped"', () => {
  const r = run(['Zzyzx Grotesk Nonexistent', 'Inter', '--json']);
  assert.equal(r.code, 1);
  const j = JSON.parse(r.stdout);
  assert.equal(j[0].family, null);
  assert.equal(j[0].error, 'unmapped');
  assert.equal(j[1].family, 'Inter');
});

test('--help exits 0 and prints usage', () => {
  const r = run(['--help']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /fonts\.mjs <family\.\.\.>/);
});
