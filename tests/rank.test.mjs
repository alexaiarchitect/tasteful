import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { rank, parseWeights, scoreEntry } from '../scripts/rank.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const fx = (p) => join(root, p);
const index = JSON.parse(readFileSync(fx('tests/fixtures/rank/mini-index.json'), 'utf8'));
const weights = parseWeights(readFileSync(fx('tests/fixtures/rank/taste.md'), 'utf8'));
const brief = JSON.parse(readFileSync(fx('fixtures/briefs/piano-note-trainer.json'), 'utf8'));
const NOW = Date.parse('2026-10-24T12:00:00Z');

const runCli = (args) => spawnSync(process.execPath, [fx('scripts/rank.mjs'), ...args], { encoding: 'utf8' });

test('deterministic: same inputs, same output (and input order does not matter)', () => {
  const a = rank({ brief, index, weights, n: 5, now: NOW }).result;
  const b = rank({ brief, index: [...index].reverse(), weights, n: 5, now: NOW }).result;
  assert.deepEqual(a, b);
  const c1 = runCli(['--brief', fx('fixtures/briefs/piano-note-trainer.json'), '--index', fx('tests/fixtures/rank/mini-index.json'), '--taste', fx('tests/fixtures/rank/taste.md')]);
  const c2 = runCli(['--brief', fx('fixtures/briefs/piano-note-trainer.json'), '--index', fx('tests/fixtures/rank/mini-index.json'), '--taste', fx('tests/fixtures/rank/taste.md')]);
  assert.equal(c1.status, 0, c1.stderr);
  assert.equal(c1.stdout, c2.stdout);
  const out = JSON.parse(c1.stdout);
  assert.ok(Array.isArray(out.candidates) && Array.isArray(out.combinations) && Array.isArray(out.excluded));
});

test('diversity: never two candidates with the same mood[0]+typography.display; safe and bold present', () => {
  const { result } = rank({ brief, index, weights, n: 5, now: NOW });
  const byId = Object.fromEntries(index.map((e) => [e.id, e]));
  const combos = result.candidates.map((c) => `${byId[c.id].mood[0]}+${byId[c.id].typography.display}`);
  assert.equal(new Set(combos).size, combos.length);
  assert.ok(result.excluded.some((x) => x.id === 'bright-kids-lab' && /same mood\+typography/.test(x.reason)));
  assert.ok(result.candidates.some((c) => c.role === 'safe'));
  assert.ok(result.candidates.some((c) => c.role === 'bold'));
  for (const c of result.candidates) {
    assert.ok(c.reasons.length > 0);
    assert.equal(typeof c.leave, 'string');
    for (const t of c.take) assert.ok(byId[c.id].extractable.includes(t));
  }
  assert.equal(result.combinations[0].label, 'A');
  assert.ok(result.combinations.length >= 2 && result.combinations.length <= 3);
  for (const k of result.combinations) assert.match(k.character, /\.$/);
});

test('motion over budget is penalised: same entry ranks lower as motion grows', () => {
  const base = index.find((e) => e.id === 'playful-practice-app');
  const s1 = scoreEntry({ ...base, motion: 1 }, brief, weights, NOW).score;
  const s2 = scoreEntry({ ...base, motion: 2 }, brief, weights, NOW).score;
  const s3 = scoreEntry({ ...base, motion: 3 }, brief, weights, NOW).score;
  assert.ok(s1 > s2 && s2 > s3);
  assert.equal(Math.round((s1 - s2) * 100) / 100, weights.penalty.motion_over_budget);
  const { result } = rank({ brief, index, weights, n: 5, now: NOW });
  const ids = result.candidates.map((c) => c.id);
  assert.equal(ids[ids.length - 1], 'heavy-webgl-studio');
  const heavy = result.candidates.find((c) => c.id === 'heavy-webgl-studio');
  assert.match(heavy.leave, /motion level 3 above budget 1/);
});

test('ties broken by id', () => {
  const twin = (id) => ({ ...index[0], id, url: `https://${id}.example.com/` });
  const { result } = rank({ brief, index: [twin('b-twin'), twin('a-twin')], weights, n: 5, now: NOW });
  assert.equal(result.candidates[0].id, 'a-twin');
});

test('exit 1 with fewer than 3 eligible (live) entries', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tasteful-rank-'));
  const small = index.map((e, i) => (i < 2 ? e : { ...e, status: 'dead' }));
  writeFileSync(join(dir, 'index.json'), JSON.stringify(small));
  const r = runCli(['--brief', fx('fixtures/briefs/piano-note-trainer.json'), '--index', join(dir, 'index.json'), '--taste', fx('tests/fixtures/rank/taste.md')]);
  assert.equal(r.status, 1);
  const out = JSON.parse(r.stdout);
  assert.ok(out.excluded.filter((x) => x.reason === 'status: dead').length === 4);
});

test('exit 2 when the weights fence is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tasteful-rank-'));
  writeFileSync(join(dir, 'taste.md'), '# Taste\n\n## Weights\n\nno fence here\n');
  const r = runCli(['--brief', fx('fixtures/briefs/piano-note-trainer.json'), '--index', fx('tests/fixtures/rank/mini-index.json'), '--taste', join(dir, 'taste.md')]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Weights/);
  assert.throws(() => parseWeights('# nothing'), /Weights/);
});
