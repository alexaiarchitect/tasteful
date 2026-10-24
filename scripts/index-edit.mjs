#!/usr/bin/env node
// tasteful — scripts/index-edit.mjs
// Edit index/sites.json and index/rejected.json safely.
// Contract: docs/SCRIPTS.md → index-edit.mjs. Stdlib only.

import { readFileSync, writeFileSync, renameSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, basename, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, EXIT_OK, EXIT_FAIL, EXIT_USAGE, fail } from './lib/args.mjs';
import { log } from './lib/log.mjs';
import { loadSchema, validate } from './lib/schema.mjs';
import { canonicalUrl, hostKey, today, isMain } from './lib/fetch.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const COMMANDS = ['upsert', 'set-status', 'reject', 'diff', 'stats', 'merge'];

const spec = {
  usage: 'index-edit.mjs <command> [options] [--index <path>] [--rejected <path>]',
  description:
    'Commands:\n' +
    '  upsert --entry <file|->            insert or replace an entry by id (schema-validated)\n' +
    '  set-status --id <id> --status <s>  live | dead | unchecked; sets last_checked to today\n' +
    '  reject --url <u> --reason <text>   append to rejected.json, remove from the index\n' +
    '  diff --candidates <jsonl|->        print (JSONL) candidates in neither index nor rejected\n' +
    '  stats                              counts per source, kind, mood, status, anchors\n' +
    '  merge --from <glob>                upsert every entry in matching JSON/JSONL files\n' +
    'Writes are atomic and keep the index sorted by id (2-space JSON).',
  positional: [{ name: 'command', required: true, help: COMMANDS.join(' | ') }],
  flags: {
    index: { type: 'string', default: join(ROOT, 'index/sites.json'), help: 'Index file' },
    rejected: { type: 'string', default: join(ROOT, 'index/rejected.json'), help: 'Rejected list' },
    schema: { type: 'string', default: join(ROOT, 'index/schema.json'), help: 'JSON Schema for the index' },
    entry: { type: 'string', help: 'upsert: entry JSON file or - for stdin' },
    id: { type: 'string', help: 'set-status: entry id' },
    status: { type: 'string', help: 'set-status: live | dead | unchecked' },
    url: { type: 'string', help: 'reject: url to reject' },
    reason: { type: 'string', help: 'reject: one-line reason' },
    candidates: { type: 'string', help: 'diff: candidate JSONL file or -' },
    from: { type: 'string', help: 'merge: glob of JSON/JSONL entry files (* within one path segment)' },
  },
};

// ---------------------------------------------------------------- io helpers

function readText(path) {
  return path === '-' ? readFileSync(0, 'utf8') : readFileSync(path, 'utf8');
}

/** Parse a JSON array/object or JSONL text into an array of objects. */
export function parseRecords(text) {
  const t = String(text).trim();
  if (!t) return [];
  try {
    const v = JSON.parse(t);
    return Array.isArray(v) ? v : [v];
  } catch {
    return t.split(/\r?\n/).filter((l) => l.trim()).map((l, i) => {
      try {
        return JSON.parse(l);
      } catch (e) {
        throw new Error(`line ${i + 1}: ${e.message}`);
      }
    });
  }
}

function readArray(path, what, { missingOk = true } = {}) {
  if (!existsSync(path)) {
    if (missingOk) return [];
    fail(`${what} not found: ${path}`);
  }
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    fail(`cannot read ${what} ${path}: ${e.message}`);
  }
  if (!text.trim()) return [];
  let v;
  try {
    v = JSON.parse(text);
  } catch (e) {
    fail(`${what} ${path} is not valid JSON: ${e.message}`);
  }
  if (!Array.isArray(v)) fail(`${what} ${path} is not a JSON array`);
  return v;
}

/** Atomic write: temp file in the same dir, then rename. */
export function writeJsonAtomic(path, data) {
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  renameSync(tmp, path);
}

const sortById = (arr) => [...arr].sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
const safeKey = (u) => {
  try {
    return hostKey(u);
  } catch {
    return null;
  }
};

/** Tiny glob: `*` and `?` match within one path segment. Returns sorted file paths. */
export function glob(pattern) {
  const abs = isAbsolute(pattern) ? pattern : resolve(process.cwd(), pattern);
  const segs = abs.split('/').filter((s, i) => s !== '' || i === 0);
  const toRe = (s) => new RegExp('^' + s.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]') + '$');
  let paths = ['/'];
  for (let i = 1; i < segs.length; i++) {
    const seg = segs[i];
    const last = i === segs.length - 1;
    const next = [];
    for (const base of paths) {
      if (!/[*?]/.test(seg)) {
        const p = join(base, seg);
        if (existsSync(p)) next.push(p);
        continue;
      }
      let names = [];
      try {
        names = readdirSync(base);
      } catch {
        continue;
      }
      const re = toRe(seg);
      for (const n of names.sort()) if (re.test(n) && !n.startsWith('.')) next.push(join(base, n));
    }
    paths = last ? next : next.filter((p) => {
      try {
        return statSync(p).isDirectory();
      } catch {
        return false;
      }
    });
  }
  return paths.filter((p) => {
    try {
      return statSync(p).isFile();
    } catch {
      return false;
    }
  }).sort();
}

// ---------------------------------------------------------------- commands

class Ctx {
  constructor(flags) {
    this.flags = flags;
    this.index = readArray(flags.index, 'index');
    this.rejected = readArray(flags.rejected, 'rejected list');
  }
  schema() {
    if (!this._schema) {
      try {
        this._schema = loadSchema(this.flags.schema);
      } catch (e) {
        fail(`cannot load schema ${this.flags.schema}: ${e.message}`);
      }
    }
    return this._schema;
  }
  check(index) {
    const r = validate(this.schema(), index);
    const errors = [...r.errors];
    const ids = new Map();
    const urls = new Map();
    for (const e of index) {
      if (ids.has(e.id)) errors.push({ path: `id=${e.id}`, message: 'duplicate id' });
      ids.set(e.id, true);
      const k = safeKey(e.url);
      if (k && urls.has(k)) errors.push({ path: `id=${e.id}`, message: `duplicate url (also ${urls.get(k)})` });
      if (k) urls.set(k, e.id);
    }
    return errors;
  }
  /** Validate then write the index; returns errors (nothing written when non-empty). */
  saveIndex(index) {
    const sorted = sortById(index);
    const errors = this.check(sorted);
    if (errors.length) return errors;
    writeJsonAtomic(this.flags.index, sorted);
    this.index = sorted;
    return [];
  }
}

function out(flags, obj, human) {
  if (flags.json) process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
  else process.stdout.write(human + '\n');
}

function reportErrors(flags, errors, extra = {}) {
  for (const e of errors.slice(0, 50)) log.error(`${e.path || '(root)'}: ${e.message}`);
  out(flags, { ok: false, changed: 0, errors, ...extra }, `validation failed (${errors.length} error${errors.length === 1 ? '' : 's'}); nothing written`);
  return EXIT_FAIL;
}

/** Upsert entries into an index array. Returns {index, inserted, replaced, conflicts}. */
export function upsertAll(index, entries) {
  const next = [...index];
  const res = { inserted: [], replaced: [], unchanged: [], conflicts: [] };
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string') {
      res.conflicts.push({ id: entry?.id ?? null, reason: 'entry has no string id' });
      continue;
    }
    if (typeof entry.url === 'string') {
      try {
        entry.url = canonicalUrl(entry.url);
      } catch {}
    }
    const k = safeKey(entry.url);
    const clash = k && next.find((e) => e.id !== entry.id && safeKey(e.url) === k);
    if (clash) {
      res.conflicts.push({ id: entry.id, reason: `url already indexed as ${clash.id}` });
      continue;
    }
    const i = next.findIndex((e) => e.id === entry.id);
    if (i === -1) {
      next.push(entry);
      res.inserted.push(entry.id);
    } else if (JSON.stringify(next[i]) === JSON.stringify(entry)) {
      res.unchanged.push(entry.id);
    } else {
      next[i] = entry;
      res.replaced.push(entry.id);
    }
  }
  return { index: next, ...res };
}

function cmdUpsert(ctx) {
  const { flags } = ctx;
  if (!flags.entry) fail('upsert needs --entry <file|->');
  let entries;
  try {
    entries = parseRecords(readText(flags.entry));
  } catch (e) {
    fail(`cannot read entry ${flags.entry}: ${e.message}`);
  }
  if (!entries.length) fail('no entry found in --entry input');
  const r = upsertAll(ctx.index, entries);
  if (r.conflicts.length) {
    for (const c of r.conflicts) log.error(`${c.id}: ${c.reason}`);
    out(flags, { ok: false, changed: 0, conflicts: r.conflicts }, `conflict: ${r.conflicts.map((c) => `${c.id} (${c.reason})`).join('; ')}; nothing written`);
    return EXIT_FAIL;
  }
  const changed = r.inserted.length + r.replaced.length;
  if (changed) {
    const errors = ctx.saveIndex(r.index);
    if (errors.length) return reportErrors(flags, errors);
  }
  out(flags, { ok: true, changed, inserted: r.inserted, replaced: r.replaced, unchanged: r.unchanged },
    `upsert: ${r.inserted.length} inserted, ${r.replaced.length} replaced, ${r.unchanged.length} unchanged`);
  return EXIT_OK;
}

function cmdSetStatus(ctx) {
  const { flags } = ctx;
  if (!flags.id) fail('set-status needs --id <id>');
  if (!['live', 'dead', 'unchecked'].includes(flags.status)) fail('set-status needs --status live|dead|unchecked');
  const i = ctx.index.findIndex((e) => e.id === flags.id);
  if (i === -1) {
    out(flags, { ok: false, changed: 0, error: `id not found: ${flags.id}` }, `id not found: ${flags.id}`);
    return EXIT_FAIL;
  }
  const next = [...ctx.index];
  const before = next[i].status;
  next[i] = { ...next[i], status: flags.status, last_checked: today() };
  const errors = ctx.saveIndex(next);
  if (errors.length) return reportErrors(flags, errors);
  out(flags, { ok: true, changed: 1, id: flags.id, from: before, to: flags.status }, `${flags.id}: ${before} → ${flags.status}`);
  return EXIT_OK;
}

function cmdReject(ctx) {
  const { flags } = ctx;
  if (!flags.url) fail('reject needs --url <u>');
  if (!flags.reason || !flags.reason.trim()) fail('reject needs --reason <text>');
  let url;
  try {
    url = canonicalUrl(flags.url);
  } catch {
    fail(`invalid url: ${flags.url}`);
  }
  const key = hostKey(url);
  const removed = ctx.index.filter((e) => safeKey(e.url) === key).map((e) => e.id);
  if (removed.length) {
    const errors = ctx.saveIndex(ctx.index.filter((e) => safeKey(e.url) !== key));
    if (errors.length) return reportErrors(flags, errors);
  }
  const already = ctx.rejected.some((r) => safeKey(r.url) === key);
  if (!already) {
    writeJsonAtomic(flags.rejected, [...ctx.rejected, { url, reason: flags.reason.trim().replace(/\s+/g, ' '), date: today() }]);
  }
  out(flags, { ok: true, changed: removed.length + (already ? 0 : 1), url, removed, already_rejected: already },
    `${url}: ${already ? 'already rejected' : 'rejected'}${removed.length ? `; removed from index: ${removed.join(', ')}` : ''}`);
  return EXIT_OK;
}

function cmdDiff(ctx) {
  const { flags } = ctx;
  if (!flags.candidates) fail('diff needs --candidates <jsonl|->');
  let cands;
  try {
    cands = parseRecords(readText(flags.candidates));
  } catch (e) {
    fail(`cannot read candidates ${flags.candidates}: ${e.message}`);
  }
  const known = new Set([...ctx.index, ...ctx.rejected].map((e) => safeKey(e.url)).filter(Boolean));
  let fresh = 0;
  let skipped = 0;
  for (const c of cands) {
    const k = safeKey(c?.url);
    if (!k || known.has(k)) {
      skipped++;
      continue;
    }
    known.add(k);
    fresh++;
    process.stdout.write(JSON.stringify(c) + '\n');
  }
  log.info(`diff: ${fresh} new, ${skipped} known, rejected or duplicate (of ${cands.length})`);
  return EXIT_OK;
}

/** Counts per source, kind, mood, status and anchors. */
export function stats(index, rejected = []) {
  const count = (vals) => {
    const m = {};
    for (const v of vals) m[v] = (m[v] ?? 0) + 1;
    return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)));
  };
  return {
    entries: index.length,
    rejected: rejected.length,
    anchors: index.filter((e) => e.anchor).length,
    tentative: index.filter((e) => e.tentative).length,
    source: count(index.map((e) => e.source)),
    status: count(index.map((e) => e.status)),
    kind: count(index.flatMap((e) => e.kind ?? [])),
    mood: count(index.flatMap((e) => e.mood ?? [])),
  };
}

function cmdStats(ctx) {
  const s = stats(ctx.index, ctx.rejected);
  const fmt = (o) => Object.entries(o).map(([k, v]) => `${k} ${v}`).join(', ') || '-';
  out(ctx.flags, { ok: true, changed: 0, ...s }, [
    `entries   ${s.entries} (anchors ${s.anchors}, tentative ${s.tentative}, rejected ${s.rejected})`,
    `source    ${fmt(s.source)}`,
    `status    ${fmt(s.status)}`,
    `kind      ${fmt(s.kind)}`,
    `mood      ${fmt(s.mood)}`,
  ].join('\n'));
  return EXIT_OK;
}

function cmdMerge(ctx) {
  const { flags } = ctx;
  if (!flags.from) fail('merge needs --from <glob>');
  const files = glob(flags.from).filter((f) => resolve(f) !== resolve(flags.index) && resolve(f) !== resolve(flags.rejected));
  if (!files.length) fail(`no files match ${flags.from}`);
  const entries = [];
  for (const f of files) {
    try {
      entries.push(...parseRecords(readFileSync(f, 'utf8')));
    } catch (e) {
      fail(`cannot parse ${f}: ${e.message}`);
    }
  }
  // Within the batch, a later file wins for the same id.
  const r = upsertAll(ctx.index, entries);
  for (const c of r.conflicts) log.warn(`conflict: ${c.id}: ${c.reason}`);
  const changed = r.inserted.length + r.replaced.length;
  if (changed) {
    const errors = ctx.saveIndex(r.index);
    if (errors.length) return reportErrors(flags, errors, { files });
  }
  out(flags, { ok: true, changed, files, inserted: r.inserted, replaced: r.replaced, unchanged: r.unchanged, conflicts: r.conflicts },
    `merge: ${files.length} file(s), ${r.inserted.length} inserted, ${r.replaced.length} replaced, ${r.unchanged.length} unchanged, ${r.conflicts.length} conflict(s)`);
  return EXIT_OK;
}

function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2), spec);
  const cmd = positional.command;
  if (!COMMANDS.includes(cmd)) fail(`unknown command "${cmd}" (expected ${COMMANDS.join(', ')})`);
  const ctx = new Ctx(flags);
  const run = { upsert: cmdUpsert, 'set-status': cmdSetStatus, reject: cmdReject, diff: cmdDiff, stats: cmdStats, merge: cmdMerge }[cmd];
  process.exit(run(ctx));
}

if (isMain(import.meta.url)) {
  try {
    main();
  } catch (e) {
    log.error(e);
    process.exit(EXIT_USAGE);
  }
}
