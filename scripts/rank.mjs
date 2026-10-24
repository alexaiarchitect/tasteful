#!/usr/bin/env node
// tasteful — scripts/rank.mjs
// Rank live index entries against a brief using the weights in taste.md.
// Contract: docs/SCRIPTS.md → rank.mjs. Stdlib only. Deterministic.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs, EXIT_OK, EXIT_FAIL, EXIT_USAGE, fail } from './lib/args.mjs';
import { log } from './lib/log.mjs';
import { isMain } from './lib/fetch.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const spec = {
  usage: 'rank.mjs --brief <brief.json> [--index <path>] [--taste <path>] [--n <n>]',
  description:
    'Score every live index entry against a brief (tag overlap, taste weights, anchor bonus,\n' +
    'source score, recency, penalties), pick a diverse set with one safe and one bold pick,\n' +
    'and propose combinations. Prints JSON on stdout. Weights come from the ```json fence\n' +
    'under "## Weights" in taste.md.',
  flags: {
    brief: { type: 'string', help: 'Brief JSON (required)' },
    index: { type: 'string', default: `${ROOT}index/sites.json`, help: 'Index to rank' },
    taste: { type: 'string', default: `${ROOT}index/taste.md`, help: 'Taste profile with the Weights fence' },
    n: { type: 'number', default: 5, help: 'Number of candidates' },
  },
};

export class UsageError extends Error {}

/** Extract the weights object from the ```json fence under "## Weights". */
export function parseWeights(md) {
  const sec = String(md).split(/^## /m).find((s) => /^Weights\b/.test(s));
  if (!sec) throw new UsageError('taste.md has no "## Weights" section');
  const m = sec.match(/```json\s*\n([\s\S]*?)```/);
  if (!m) throw new UsageError('taste.md "## Weights" has no ```json fence');
  let w;
  try {
    w = JSON.parse(m[1]);
  } catch (e) {
    throw new UsageError(`taste.md weights fence is not valid JSON: ${e.message}`);
  }
  for (const k of ['tag_overlap', 'taste', 'penalty']) if (!w || typeof w[k] !== 'object') throw new UsageError(`weights missing "${k}"`);
  return w;
}

const DAY = 86400000;
const arr = (v) => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);
const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const inter = (a, b) => arr(a).filter((x) => arr(b).includes(x));
const round = (x) => Math.round(x * 100) / 100;
const num = (x, d = 0) => (typeof x === 'number' && Number.isFinite(x) ? x : d);

/** Taste matches: {prefer, avoid, matched:[...], avoided:[...]}. */
function tasteCounts(entry, taste) {
  const matched = [];
  const avoided = [];
  for (const [path, values] of Object.entries(taste.prefer ?? {})) for (const v of inter(get(entry, path), values)) matched.push(`${path}=${v}`);
  for (const [path, values] of Object.entries(taste.avoid ?? {})) for (const v of inter(get(entry, path), values)) avoided.push(`${path}=${v}`);
  return { matched, avoided };
}

const KIND_TAKES = {
  landing: ['hero', 'buttons'],
  product: ['hero', 'buttons'],
  editorial: ['type-pairing', 'section-rhythm', 'spacing-scale', 'chips'],
  docs: ['type-pairing', 'section-rhythm', 'spacing-scale', 'chips'],
  tool: ['buttons', 'chips', 'card-system', 'spacing-scale'],
  portfolio: ['type-pairing', 'hero', 'section-rhythm'],
  studio: ['type-pairing', 'hero', 'section-rhythm'],
  ecommerce: ['card-system', 'buttons', 'nav'],
};

export function takeFor(entry, brief) {
  const ex = arr(entry.extractable);
  const out = [];
  const add = (x) => {
    if (ex.includes(x) && !out.includes(x)) out.push(x);
  };
  arr(brief.must_have).forEach(add);
  for (const k of arr(brief.kind)) (KIND_TAKES[k] ?? []).forEach(add);
  add('palette');
  return out;
}

/** Score one entry. Returns {score, reasons, taste_match, ...}. */
export function scoreEntry(entry, brief, w, now = Date.now()) {
  const reasons = [];
  let s = 0;
  const term = (value, label) => {
    if (!value) return;
    s += value;
    reasons.push(`${label} (${value > 0 ? '+' : ''}${round(value)})`);
  };
  const to = w.tag_overlap ?? {};
  const k = inter(entry.kind, brief.kind);
  term(num(to.kind) * k.length, `kind: ${k.join(', ')}`);
  const m = inter(entry.mood, brief.mood);
  term(num(to.mood) * m.length, `mood: ${m.join(', ')}`);
  const e = inter(entry.extractable, brief.must_have);
  term(num(to.extractable) * e.length, `covers must-have: ${e.join(', ')}`);

  const { matched, avoided } = tasteCounts(entry, w.taste ?? {});
  const tasteTerm = num(w.taste?.match) * (matched.length - avoided.length);
  if (tasteTerm) {
    const parts = [];
    if (matched.length) parts.push(`likes ${matched.join(', ')}`);
    if (avoided.length) parts.push(`dislikes ${avoided.join(', ')}`);
    term(tasteTerm, `taste: ${parts.join('; ')}`);
  }
  if (entry.anchor) term(num(w.anchor_bonus), 'anchor');
  const srcScore = entry.source_score ?? 5;
  term((num(w.source_score) * srcScore) / 10, `source score ${entry.source_score ?? 'n/a (5)'}`);
  const added = Date.parse(entry.added ?? '');
  const fresh = Number.isFinite(added) && now - added <= 365 * DAY;
  term(num(w.recency) * (fresh ? 1 : 0.5), fresh ? 'added within a year' : 'older than a year');

  const p = w.penalty ?? {};
  const over = Math.max(0, num(entry.motion) - num(brief.motion));
  if (over) term(-num(p.motion_over_budget) * over, `motion ${entry.motion} over budget ${brief.motion}`);
  if (entry.tentative) term(-num(p.tentative), 'tentative');
  const avoidWords = String(entry.avoid ?? '').toLowerCase().split(/[^a-z0-9-]+/).filter(Boolean);
  const conflicts = arr(brief.must_have).filter((x) => avoidWords.includes(String(x).toLowerCase()));
  if (conflicts.length) term(-num(p.avoid_conflict), `avoid note conflicts with must-have: ${conflicts.join(', ')}`);
  const darkOnly = get(entry, 'color.strategy') === 'dark-first' && brief.dark_mode !== 'dark-first';
  if (darkOnly) term(-num(p.dark_only_when_light_needed), 'dark-first palette, brief needs light');

  return { score: round(s), reasons, taste_match: matched.length - avoided.length, over, darkOnly };
}

function leaveFor(entry, sc, brief) {
  const parts = [];
  if (entry.avoid) parts.push(entry.avoid);
  if (sc.over) parts.push(`motion level ${entry.motion} above budget ${brief.motion}; keep transitions subtle`);
  if (sc.darkOnly) parts.push('dark-first palette; derive the light scheme instead of copying it');
  return parts.length ? parts.join('; ') : 'nothing specific; take only what is listed';
}

const an = (w) => (/^[aeiou]/i.test(String(w)) ? `an ${w}` : `a ${w}`);
const comboKey = (e) => `${arr(e.mood)[0] ?? '?'}+${get(e, 'typography.display') ?? '?'}`;
const byScore = (a, b) => b.score - a.score || (a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0);

function describe(e) {
  const mood = arr(e.mood)[0] ?? 'distinct';
  const display = get(e, 'typography.display') ?? 'mixed';
  const strat = get(e, 'color.strategy') ?? 'neutral';
  const density = get(e, 'layout.density') ?? 'balanced';
  return { mood, display, strat, density };
}

/** Rank. Returns {result, eligible}. */
export function rank({ brief, index, weights, n = 5, now = Date.now() }) {
  const excluded = [];
  const scored = [];
  for (const entry of [...index].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (entry.status !== 'live') {
      excluded.push({ id: entry.id, reason: `status: ${entry.status ?? 'missing'}` });
      continue;
    }
    scored.push({ entry, ...scoreEntry(entry, brief, weights, now) });
  }
  scored.sort(byScore);

  // Diversity: keep the best entry per mood[0]+typography.display combination.
  const reps = [];
  const repOf = new Map();
  for (const s of scored) {
    const key = comboKey(s.entry);
    if (repOf.has(key)) {
      excluded.push({ id: s.entry.id, reason: `same mood+typography (${key}) as ${repOf.get(key)}` });
      continue;
    }
    repOf.set(key, s.entry.id);
    reps.push(s);
  }
  let picks = reps.slice(0, n);
  const roles = new Map();

  if (scored.length >= 4 && reps.length >= 2 && n >= 2) {
    const preferMood = arr(weights.taste?.prefer?.mood);
    const safe = [...reps].sort((a, b) => b.taste_match - a.taste_match || byScore(a, b))[0];
    const boldPool = reps.filter(
      (s) => s !== safe && (!inter(s.entry.mood, preferMood).length || num(s.entry.motion) === num(brief.motion) + 1),
    );
    const bold = boldPool[0] ?? null; // reps are already sorted by score
    const ensure = (x, keep) => {
      if (!x || picks.includes(x)) return;
      // Replace the lowest-scored pick that is not the top pick or `keep`.
      for (let i = picks.length - 1; i >= 0; i--) {
        if (i === 0 || picks[i] === keep) continue;
        picks[i] = x;
        return;
      }
      if (picks.length < n) picks.push(x);
    };
    ensure(safe, bold);
    ensure(bold, safe);
    picks.sort(byScore);
    roles.set(safe.entry.id, 'safe');
    if (bold) roles.set(bold.entry.id, roles.has(bold.entry.id) ? roles.get(bold.entry.id) : 'bold');
  }

  const candidates = picks.map((s) => ({
    id: s.entry.id,
    score: s.score,
    role: roles.get(s.entry.id) ?? null,
    reasons: s.reasons,
    take: takeFor(s.entry, brief),
    leave: leaveFor(s.entry, s, brief),
  }));

  // Combinations.
  const combinations = [];
  const P = picks.map((s) => s.entry);
  const takeOf = (id) => candidates.find((c) => c.id === id).take;
  if (P.length) {
    const d = describe(P[0]);
    combinations.push({
      label: 'A',
      parts: [{ id: P[0].id, take: takeOf(P[0].id) }],
      character: `${P[0].title ?? P[0].id} as-is: ${d.mood} with ${d.display} display type, ${an(d.strat)} palette and ${d.density} spacing.`,
    });
  }
  const preferDisplay = arr(weights.taste?.prefer?.['typography.display']);
  const preferColor = arr(weights.taste?.prefer?.['color.strategy']);
  const scoreOf = (e) => picks.find((s) => s.entry === e).score;
  const best = (pool, bonus) => [...pool].sort((a, b) => scoreOf(b) + bonus(b) - (scoreOf(a) + bonus(a)) || (a.id < b.id ? -1 : 1))[0];
  const has = (e, x) => arr(e.extractable).includes(x);
  if (P.length >= 3) {
    const typo = best(P.filter((e) => has(e, 'type-pairing')), (e) => (preferDisplay.includes(get(e, 'typography.display')) ? 2 : 0));
    const col = typo && best(P.filter((e) => e !== typo && has(e, 'palette')), (e) => (preferColor.includes(get(e, 'color.strategy')) ? 2 : 0));
    const third = col && best(P.filter((e) => e !== typo && e !== col && (has(e, 'card-system') || has(e, 'hero'))), () => 0);
    if (typo && col && third) {
      const dt = describe(typo);
      const dc = describe(col);
      const dx = describe(third);
      combinations.push({
        label: 'B',
        parts: [
          { id: typo.id, take: ['type-pairing'] },
          { id: col.id, take: ['palette'] },
          { id: third.id, take: ['card-system', 'hero'].filter((x) => has(third, x)) },
        ],
        character: `${dt.display[0].toUpperCase() + dt.display.slice(1)} typography from ${typo.title ?? typo.id} over ${an(dc.strat)} palette from ${col.title ?? col.id}, with the ${dx.density} card and hero rhythm of ${third.title ?? third.id}.`,
      });
    }
  }
  if (P.length >= 2) {
    const first = P[0];
    const boldId = [...roles].find(([, r]) => r === 'bold')?.[0];
    const second = P.find((e) => e.id === boldId && e !== first) ?? P[1];
    const t1 = takeOf(first.id).filter((x) => x !== 'palette');
    const t2 = has(second, 'palette') ? ['palette'] : takeOf(second.id).slice(0, 1);
    const d1 = describe(first);
    const d2 = describe(second);
    combinations.push({
      label: combinations.length === 2 ? 'C' : 'B',
      parts: [
        { id: first.id, take: t1.length ? t1 : takeOf(first.id) },
        { id: second.id, take: t2 },
      ],
      character: `The ${d1.mood} structure of ${first.title ?? first.id} with the ${d2.strat} colour of ${second.title ?? second.id}: familiar layout, ${an(d2.mood)} accent.`,
    });
  }

  return { result: { candidates, combinations, excluded }, eligible: scored.length };
}

function readJson(path, what) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    fail(`cannot read ${what} ${path}: ${e.message}`, EXIT_USAGE);
  }
}

function main() {
  const { flags } = parseArgs(process.argv.slice(2), spec);
  if (!flags.brief) fail('--brief <brief.json> is required');
  if (!(flags.n >= 1)) fail('--n must be >= 1');
  const brief = readJson(flags.brief, 'brief');
  const index = readJson(flags.index, 'index');
  if (!Array.isArray(index)) fail(`index ${flags.index} is not a JSON array`);
  let md;
  try {
    md = readFileSync(flags.taste, 'utf8');
  } catch (e) {
    fail(`cannot read taste ${flags.taste}: ${e.message}`);
  }
  let weights;
  try {
    weights = parseWeights(md);
  } catch (e) {
    fail(`${flags.taste}: ${e.message}`);
  }
  const { result, eligible } = rank({ brief, index, weights, n: flags.n });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (eligible < 3) {
    log.warn(`only ${eligible} eligible (live) entries; need at least 3`);
    process.exit(EXIT_FAIL);
  }
  log.info(`ranked ${eligible} live entries → ${result.candidates.length} candidates`);
  process.exit(EXIT_OK);
}

if (isMain(import.meta.url)) main();
