import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { run, ROOT, tmpFile } from './_run.mjs';

const mini = () => JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/mini-index.json'), 'utf8'));
const vi = (args) => run('validate-index.mjs', args);

test('mini index is valid', () => {
  const r = vi(['--index', 'tests/fixtures/mini-index.json', '--rejected', '/dev/null', '--json']);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out, { ok: true, entries: 3, violations: [], dead: [] });
});

test('invalid index: duplicate id, bad hex, unknown source', () => {
  const r = vi(['--index', 'tests/fixtures/invalid-index.json', '--rejected', '/dev/null', '--json']);
  assert.equal(r.code, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.violations.length, 3);
  const rules = out.violations.map((v) => `${v.rule}:${v.message}`).join('\n');
  assert.match(rules, /unique-id:duplicate id "example-editorial-journal"/);
  assert.match(rules, /schema:\/2\/color\/accent/);
  assert.match(rules, /schema:\/2\/source/);
  const h = vi(['--index', 'tests/fixtures/invalid-index.json', '--rejected', '/dev/null']);
  assert.match(h.stdout, /FAIL: 3 entries, 3 violation\(s\)/);
});

test('duplicate canonical url, dead entry, rejected url', () => {
  const d = mini();
  d[1].url = 'https://www.editorial.example.com/?utm_source=x#top';
  d[2].status = 'dead';
  const idx = tmpFile(JSON.stringify(d), '.json');
  const rej = tmpFile(JSON.stringify([{ url: 'https://tool.example.org/app/', reason: 'template demo', date: '2026-10-24' }]), '.json');
  const r = vi(['--index', idx, '--rejected', rej, '--json']);
  assert.equal(r.code, 1);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.violations.map((v) => v.rule).sort(), ['dead', 'unique-url']);
  assert.deepEqual(out.dead, ['example-studio-portfolio']);
  d[1].url = 'https://tool.example.org/app';
  const r2 = JSON.parse(vi(['--index', tmpFile(JSON.stringify(d), '.json'), '--rejected', rej, '--json']).stdout);
  assert.ok(r2.violations.some((v) => v.rule === 'rejected' && /template demo/.test(v.message)));
});

test('exit 2 on unreadable index or invalid schema', () => {
  assert.equal(vi(['--index', 'nope.json']).code, 2);
  assert.equal(vi(['--index', tmpFile('{not json', '.json')]).code, 2);
  const badSchema = tmpFile(JSON.stringify({ type: 'array', contains: {} }), '.json');
  const r = vi(['--index', 'tests/fixtures/mini-index.json', '--schema', badSchema, '--rejected', '/dev/null']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /unsupported keyword/);
});

test('default paths resolve against the plugin root from any cwd', () => {
  const r = run('validate-index.mjs', ['--json'], { cwd: '/' });
  if (!existsSync(join(ROOT, 'index/sites.json'))) return;
  assert.notEqual(r.code, 2, r.stderr);
  assert.equal(typeof JSON.parse(r.stdout).entries, 'number');
});

test('--live without probe.mjs is an environment error', { skip: existsSync(join(ROOT, 'scripts/probe.mjs')) && 'probe.mjs exists' }, () => {
  const r = vi(['--index', 'tests/fixtures/mini-index.json', '--rejected', '/dev/null', '--live']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /probe\.mjs/);
});
