#!/usr/bin/env node
// tasteful — scripts/validate-index.mjs
// Validate index/sites.json against index/schema.json plus cross-entry rules. See docs/SCRIPTS.md.

import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, fail, EXIT_OK, EXIT_FAIL } from './lib/args.mjs';
import { log, progress } from './lib/log.mjs';
import { loadSchema, validate } from './lib/schema.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fromRoot = (p) => (isAbsolute(p) ? p : resolve(process.cwd(), p));

const spec = {
  usage: 'validate-index.mjs [--index <path>] [--schema <path>] [--rejected <path>] [--live] [--json]',
  description:
    'Validate the reference index: schema conformance, unique id, unique canonical url, dead entries flagged,\n' +
    'and no url that is also in the rejected list. --live also runs probe.mjs --quick on every entry.',
  flags: {
    index: { type: 'string', default: 'index/sites.json', help: 'Index to validate (the default is relative to the plugin root)' },
    schema: { type: 'string', default: 'index/schema.json', help: 'JSON Schema (draft 2020-12 subset)' },
    rejected: { type: 'string', default: 'index/rejected.json', help: 'Rejected list to cross-check against' },
    live: { type: 'boolean', default: false, help: 'Also run probe.mjs --quick on every entry (sequential, 8 s each) and report dead ones' },
  },
};

const TRACKING = /^(utm_[a-z]+|gclid|fbclid|mc_cid|mc_eid|ref|ref_src|igshid|_ga)$/i;

/** Canonical url for comparisons: lowercase host, no www., no hash, no tracking params, no trailing slash. */
export function canonicalUrl(u) {
  try {
    const url = new URL(String(u).trim());
    url.hash = '';
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    for (const k of [...url.searchParams.keys()]) if (TRACKING.test(k)) url.searchParams.delete(k);
    url.searchParams.sort();
    let s = url.toString();
    if (url.pathname !== '/' && s.endsWith('/') && !url.search) s = s.slice(0, -1);
    if (url.pathname === '/' && !url.search) s = s.replace(/\/$/, '');
    return s.replace(/^http:/, 'https:');
  } catch {
    return String(u).trim().toLowerCase();
  }
}

// Defaults resolve against the plugin root; paths given on the command line against the cwd.
function locate(p, def) {
  if (isAbsolute(p)) return p;
  return p === def ? join(ROOT, p) : fromRoot(p);
}

function readJson(path, label, { emptyOk = false } = {}) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    fail(`cannot read ${label} ${path}: ${e.message}`);
  }
  if (emptyOk && !text.trim()) return [];
  try {
    return JSON.parse(text);
  } catch (e) {
    fail(`${label} ${path} is not valid JSON: ${e.message}`);
  }
}

function probeQuick(url) {
  const script = join(ROOT, 'scripts', 'probe.mjs');
  if (!existsSync(script)) fail(`--live needs ${script}, which does not exist yet`);
  const r = spawnSync(process.execPath, [script, url, '--quick', '--json', '--timeout', '8000'], {
    encoding: 'utf8',
    timeout: 10000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (r.error?.code === 'ETIMEDOUT' || r.signal) return { dead: true, reason: 'probe timed out' };
  if (r.status === 2) fail(`probe.mjs failed for ${url} (exit 2): ${(r.stderr || '').trim().split('\n').pop()}`);
  let out = null;
  try {
    out = JSON.parse(r.stdout);
  } catch {
    out = null;
  }
  if (r.status === 1) {
    const bits = [out?.status ? `HTTP ${out.status}` : null, out?.errors?.[0] ?? null].filter(Boolean);
    return { dead: true, reason: bits.join(': ') || 'probe reported the site unreachable' };
  }
  return { dead: false, status: out?.status };
}

function main() {
  const { flags } = parseArgs(process.argv.slice(2), spec);
  const indexPath = locate(flags.index, spec.flags.index.default);
  const schemaPath = locate(flags.schema, spec.flags.schema.default);
  const rejectedPath = locate(flags.rejected, spec.flags.rejected.default);

  let schema;
  try {
    schema = loadSchema(schemaPath);
  } catch (e) {
    fail(e.message);
  }
  const index = readJson(indexPath, 'index');
  const rejected = existsSync(rejectedPath) ? readJson(rejectedPath, 'rejected list', { emptyOk: true }) : (log.warn(`no rejected list at ${rejectedPath}`), []);
  if (!Array.isArray(rejected)) fail(`rejected list ${rejectedPath} must be a JSON array`);

  const violations = [];
  const add = (entry, rule, message) => violations.push({ id: entry?.id ?? null, url: entry?.url ?? null, rule, message });

  const res = validate(schema, index);
  if (!Array.isArray(index)) {
    for (const e of res.errors) add(null, 'schema', `${e.path}: ${e.message}`);
  } else {
    for (const e of res.errors) {
      const m = /^\/(\d+)(\/.*)?$/.exec(e.path);
      const entry = m ? index[Number(m[1])] : null;
      add(entry && typeof entry === 'object' ? entry : null, 'schema', `${e.path}: ${e.message}`);
    }
  }
  const entries = Array.isArray(index) ? index.filter((e) => e && typeof e === 'object') : [];

  const ids = new Map();
  const urls = new Map();
  for (const e of entries) {
    if (typeof e.id === 'string') {
      if (ids.has(e.id)) add(e, 'unique-id', `duplicate id "${e.id}" (also entry #${ids.get(e.id)})`);
      else ids.set(e.id, entries.indexOf(e));
    }
    if (typeof e.url === 'string') {
      const c = canonicalUrl(e.url);
      if (urls.has(c)) add(e, 'unique-url', `duplicate url ${c} (also id "${urls.get(c)}")`);
      else urls.set(c, e.id);
    }
  }

  const rejectedUrls = new Map();
  for (const r of rejected) {
    const u = typeof r === 'string' ? r : r?.url;
    if (u) rejectedUrls.set(canonicalUrl(u), typeof r === 'object' ? r.reason : undefined);
  }
  for (const e of entries) {
    if (typeof e.url === 'string' && rejectedUrls.has(canonicalUrl(e.url))) {
      const why = rejectedUrls.get(canonicalUrl(e.url));
      add(e, 'rejected', `url is in the rejected list${why ? ` (${why})` : ''}`);
    }
  }

  const dead = new Set();
  for (const e of entries) {
    if (e.status === 'dead') {
      dead.add(e.id);
      add(e, 'dead', 'status is "dead": remove it or re-check it');
    }
  }

  let liveChecked;
  if (flags.live) {
    liveChecked = 0;
    const todo = entries.filter((e) => typeof e.url === 'string' && e.status !== 'dead');
    for (const e of todo) {
      progress(liveChecked + 1, todo.length, e.url);
      const r = probeQuick(e.url);
      liveChecked++;
      if (r.dead) {
        dead.add(e.id);
        add(e, 'live', `site looks dead: ${r.reason}`);
      }
    }
  }

  const ok = violations.length === 0;
  const out = { ok, entries: Array.isArray(index) ? index.length : 0, violations, dead: [...dead] };
  if (liveChecked !== undefined) out.live_checked = liveChecked;

  if (flags.json) {
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  } else {
    const lines = [];
    if (violations.length) {
      const rows = [['id', 'rule', 'message'], ...violations.map((v) => [String(v.id ?? '-'), v.rule, v.message])];
      const w = [0, 1].map((i) => Math.max(...rows.map((r) => r[i].length)));
      rows.forEach((r, i) => {
        lines.push(`${r[0].padEnd(w[0])} | ${r[1].padEnd(w[1])} | ${r[2]}`);
        if (i === 0) lines.push(`${'-'.repeat(w[0])}-|-${'-'.repeat(w[1])}-|-${'-'.repeat(7)}`);
      });
      lines.push('');
    }
    lines.push(
      `${ok ? 'ok' : 'FAIL'}: ${out.entries} entr${out.entries === 1 ? 'y' : 'ies'}, ${violations.length} violation(s), ${dead.size} dead` +
        (liveChecked !== undefined ? `, ${liveChecked} checked live` : '') +
        ` (${indexPath})`,
    );
    process.stdout.write(lines.join('\n') + '\n');
  }
  process.exit(ok ? EXIT_OK : EXIT_FAIL);
}

main();
