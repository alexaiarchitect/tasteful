import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { glob, parseRecords } from '../scripts/index-edit.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = join(root, 'scripts/index-edit.mjs');
const MINI = join(root, 'tests/fixtures/rank/mini-index.json');

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'tasteful-index-'));
  copyFileSync(MINI, join(dir, 'sites.json'));
  writeFileSync(join(dir, 'rejected.json'), '[]\n');
  return dir;
}
const run = (dir, args, input) =>
  spawnSync(process.execPath, [SCRIPT, ...args, '--index', join(dir, 'sites.json'), '--rejected', join(dir, 'rejected.json')], { encoding: 'utf8', input });
const readIdx = (dir) => JSON.parse(readFileSync(join(dir, 'sites.json'), 'utf8'));
const base = () => JSON.parse(readFileSync(MINI, 'utf8'))[0];

test('upsert inserts a valid entry, keeps the file sorted by id with 2-space indent', () => {
  const dir = sandbox();
  const entry = { ...base(), id: 'aaa-new-site', url: 'https://new-site.example.org/?utm_source=x' };
  const r = run(dir, ['upsert', '--entry', '-', '--json'], JSON.stringify(entry));
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.changed, 1);
  const idx = readIdx(dir);
  assert.equal(idx[0].id, 'aaa-new-site');
  assert.equal(idx[0].url, 'https://new-site.example.org/');
  const ids = idx.map((e) => e.id);
  assert.deepEqual(ids, [...ids].sort());
  assert.match(readFileSync(join(dir, 'sites.json'), 'utf8'), /^\[\n  \{\n    "id"/);
});

test('upsert validates against the schema; nothing written on failure', () => {
  const dir = sandbox();
  const before = readFileSync(join(dir, 'sites.json'), 'utf8');
  const bad = { ...base(), id: 'bad-entry', url: 'https://bad.example.org/', motion: 7 };
  writeFileSync(join(dir, 'bad.json'), JSON.stringify(bad));
  const r = run(dir, ['upsert', '--entry', join(dir, 'bad.json')]);
  assert.equal(r.status, 1);
  assert.equal(readFileSync(join(dir, 'sites.json'), 'utf8'), before);
});

test('upsert refuses a url already indexed under another id', () => {
  const dir = sandbox();
  const dupe = { ...base(), id: 'zz-dupe', url: 'https://www.calm-serif-journal.example.com' };
  const r = run(dir, ['upsert', '--entry', '-'], JSON.stringify(dupe));
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /already indexed as calm-serif-journal/);
});

test('set-status updates status and last_checked; unknown id exits 1', () => {
  const dir = sandbox();
  const r = run(dir, ['set-status', '--id', 'retro-shop', '--status', 'dead']);
  assert.equal(r.status, 0, r.stderr);
  const e = readIdx(dir).find((x) => x.id === 'retro-shop');
  assert.equal(e.status, 'dead');
  assert.match(e.last_checked, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(run(dir, ['set-status', '--id', 'nope', '--status', 'live']).status, 1);
  assert.equal(run(dir, ['set-status', '--id', 'retro-shop', '--status', 'gone']).status, 2);
});

test('reject appends to rejected.json and removes the entry from the index', () => {
  const dir = sandbox();
  const r = run(dir, ['reject', '--url', 'https://retro-shop.example.com/#x', '--reason', 'template demo', '--json']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).removed, ['retro-shop']);
  const rej = JSON.parse(readFileSync(join(dir, 'rejected.json'), 'utf8'));
  assert.equal(rej.length, 1);
  assert.equal(rej[0].url, 'https://retro-shop.example.com/');
  assert.equal(rej[0].reason, 'template demo');
  assert.match(rej[0].date, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(!readIdx(dir).some((e) => e.id === 'retro-shop'));
  run(dir, ['reject', '--url', 'https://other.example.net', '--reason', 'dead']);
  assert.equal(JSON.parse(readFileSync(join(dir, 'rejected.json'), 'utf8')).length, 2);
});

test('diff excludes indexed and rejected urls and duplicates', () => {
  const dir = sandbox();
  writeFileSync(join(dir, 'rejected.json'), JSON.stringify([{ url: 'https://rejected.example.net/', reason: 'x', date: '2026-10-01' }]));
  const cands = [
    { url: 'https://www.calm-serif-journal.example.com/', source: 'awwwards' },
    { url: 'https://rejected.example.net', source: 'cssda' },
    { url: 'https://fresh.example.net/', source: 'cssda' },
    { url: 'https://www.fresh.example.net', source: 'awwwards' },
  ].map((c) => JSON.stringify(c)).join('\n');
  const r = run(dir, ['diff', '--candidates', '-'], cands);
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => l.url), ['https://fresh.example.net/']);
});

test('stats counts per source, status and anchors', () => {
  const dir = sandbox();
  const r = run(dir, ['stats', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const s = JSON.parse(r.stdout);
  assert.equal(s.entries, 6);
  assert.equal(s.anchors, 1);
  assert.equal(s.source.awwwards, 3);
  assert.equal(s.status.live, 6);
});

test('merge --from glob reads JSON arrays and JSONL, reports conflicts', () => {
  const dir = sandbox();
  mkdirSync(join(dir, 'batch'));
  const a = { ...base(), id: 'merged-one', url: 'https://merged-one.example.org/' };
  const b = { ...base(), id: 'merged-two', url: 'https://merged-two.example.org/' };
  const clash = { ...base(), id: 'merged-clash', url: 'https://calm-serif-journal.example.com/' };
  writeFileSync(join(dir, 'batch', 'a.json'), JSON.stringify([a]));
  writeFileSync(join(dir, 'batch', 'b.jsonl'), JSON.stringify(b) + '\n' + JSON.stringify(clash) + '\n');
  writeFileSync(join(dir, 'batch', 'ignore.txt'), 'nope');
  assert.deepEqual(glob(join(dir, 'batch', '*.json*')).map((p) => p.split('/').pop()), ['a.json', 'b.jsonl']);
  const r = run(dir, ['merge', '--from', join(dir, 'batch', '*.json*'), '--json']);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.inserted.sort(), ['merged-one', 'merged-two']);
  assert.equal(out.conflicts.length, 1);
  assert.equal(readIdx(dir).length, 8);
});

test('parseRecords accepts arrays, objects and JSONL', () => {
  assert.equal(parseRecords('[{"a":1},{"a":2}]').length, 2);
  assert.equal(parseRecords('{"a":1}').length, 1);
  assert.equal(parseRecords('{"a":1}\n{"a":2}\n').length, 2);
  assert.equal(parseRecords('').length, 0);
});
