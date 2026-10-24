#!/usr/bin/env node
// tasteful — scripts/fonts.mjs
//
// Map observed font-family names (from probe.mjs) to self-hostable Fontsource
// packages using index/fonts.json. Proprietary faces map to the closest open
// alternative; variable packages are preferred. --verify checks every matched
// package against the npm registry and Fontsource's metadata.json (subsets).
// Contract: docs/SCRIPTS.md → fonts.mjs.

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, fail, EXIT_OK, EXIT_FAIL, EXIT_USAGE } from './lib/args.mjs';
import { log } from './lib/log.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36 tasteful-fonts';

const spec = {
  usage: 'fonts.mjs <family...> [--map <path>] [--verify]',
  description:
    'Map observed font-family names to Fontsource packages (open alternatives for proprietary faces,\n' +
    'variable packages preferred). Prints a JSON array on stdout.',
  positional: [{ name: 'family', required: true, help: 'One or more observed font-family names' }],
  flags: {
    map: { type: 'string', default: 'index/fonts.json', help: 'Proprietary -> open-alternative map' },
    verify: { type: 'boolean', default: false, help: 'Confirm each package on the npm registry and read its subsets (1 req/s)' },
  },
};

// ---------------------------------------------------------------- matching

const MODIFIERS = new Set([
  'thin', 'hairline', 'extralight', 'ultralight', 'light', 'regular', 'book', 'normal', 'roman', 'medium',
  'semibold', 'demibold', 'demi', 'bold', 'extrabold', 'ultrabold', 'black', 'heavy', 'italic', 'oblique',
  'standard', 'std', 'pro', 'display', 'text', 'headline', 'fine', 'web', 'webfont', 'var', 'variable', 'vf',
  'condensed', 'compressed', 'narrow', 'wide', 'extended', 'deck', 'micro', 'caption', 'fallback',
]);

/** Normalise a family name: strip quotes, Next.js hashes, diacritics, punctuation, case. */
export function normalizeFamily(name) {
  let s = String(name ?? '').trim().replace(/^["']+|["']+$/g, '').trim();
  s = s.replace(/^_+/, '').replace(/_(fallback_)?[0-9a-f]{5,8}$/i, ''); // __Inter_d65c78 / __Inter_Fallback_d65c78
  s = s.replace(/\s*:\s*[A-Za-z0-9 ]+$/, ''); // Framer "Inter:Regular", "Inter Display:Medium"
  s = s.replace(/(^|\s+)placeholder$/i, ''); // Framer fallback faces "Placeholder", "Inter Placeholder"
  s = s.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  s = s.replace(/[’']/g, '').replace(/[-_]+/g, ' ');
  s = s.replace(/([a-z])([A-Z])/g, '$1 $2'); // DMSans → DM Sans, InterVariable → Inter Variable
  s = s.replace(/\b\d{3}\b/g, ' '); // weights like 400
  return s.toLowerCase().replace(/[^a-z0-9.+ ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Compact key: normalised, with spaces and hyphens removed ("PP Neue Montreal" ≡ "Ppneuemontreal"). */
export const compactFamily = (name) => normalizeFamily(name).replace(/[\s-]+/g, '');

function buildIndex(map) {
  const idx = new Map();
  const add = (k, entry, i, own) => {
    const prev = idx.get(k);
    // prefer variable packages, then the entry whose own family is this alias
    if (prev === undefined || (entry.variable && !map[prev].variable) || (own(entry) && !own(map[prev]) && entry.variable === map[prev].variable)) idx.set(k, i);
  };
  map.forEach((entry, i) => {
    for (const alias of [entry.family, ...(entry.observed ?? [])]) {
      const k = normalizeFamily(alias);
      add(k, entry, i, (e) => normalizeFamily(e.family) === k);
      const c = 'compact:' + k.replace(/[\s-]+/g, '');
      add(c, entry, i, (e) => 'compact:' + compactFamily(e.family) === c);
    }
  });
  return idx;
}

/** Find the map entry for an observed name; strips trailing weight/width words one by one. */
export function matchFamily(name, map, idx = buildIndex(map)) {
  const exact = matchKeys(name, (k) => idx.get(k));
  if (exact) return { entry: map[exact.i], key: exact.key };
  // Webflow-style concatenations: compare without spaces and hyphens
  const loose = matchKeys(name, (k) => idx.get('compact:' + k.replace(/[\s-]+/g, '')));
  if (loose) {
    const e = map[loose.i];
    return { entry: e, key: compactFamily(e.family) === loose.key.replace(/[\s-]+/g, '') ? normalizeFamily(e.family) : loose.key };
  }
  return null;
}

/** Try the normalised name, then with trailing and inner modifier words removed; lookup(k) → map index. */
function matchKeys(name, lookup) {
  const hit = (k) => {
    const i = lookup(k);
    return i === undefined ? null : { i, key: k };
  };
  let k = normalizeFamily(name);
  if (!k) return null;
  let h = hit(k);
  if (h) return h;
  const words = k.split(' ');
  while (words.length > 1) {
    const last = words[words.length - 1];
    if (!MODIFIERS.has(last) && !/^\d+$/.test(last)) break;
    words.pop();
    k = words.join(' ');
    if ((h = hit(k))) return h;
  }
  // modifiers in the middle ("GT America Standard Bold Italic" handled above; "Helvetica Neue LT Pro")
  const filtered = normalizeFamily(name).split(' ').filter((w) => !MODIFIERS.has(w) && w !== 'lt' && w !== 'w01' && w !== 'w02');
  for (let n = filtered.length; n >= 1; n--) {
    if ((h = hit(filtered.slice(0, n).join(' ')))) return h;
  }
  return null;
}

// ---------------------------------------------------------------- verify

const lastHit = new Map();
async function politeGet(url, ms = 10000) {
  const host = new URL(url).host;
  const wait = (lastHit.get(host) ?? 0) + 1000 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastHit.set(host, Date.now());
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': UA, accept: 'application/json' } });
    const text = await res.text();
    return { status: res.status, text };
  } finally {
    clearTimeout(timer);
  }
}

class Unreachable extends Error {}
const verifyCache = new Map();

/** {exists, latest, subsets, cyrillic, latin_ext, variable_axes, error} for a package. */
async function verifyPackage(pkg) {
  if (verifyCache.has(pkg)) return verifyCache.get(pkg);
  const out = { exists: false, latest: null, subsets: null, cyrillic: null, latin_ext: null, variable_axes: null, error: null };
  let reg;
  try {
    reg = await politeGet(`https://registry.npmjs.org/${pkg.replace('/', '%2F')}`);
  } catch (e) {
    throw new Unreachable(`registry unreachable: ${e.cause?.code ?? e.name ?? e.message}`);
  }
  if (reg.status === 404) {
    out.error = 'package not found on npm';
    verifyCache.set(pkg, out);
    return out;
  }
  if (reg.status >= 400) throw new Unreachable(`registry HTTP ${reg.status}`);
  let meta;
  try {
    meta = JSON.parse(reg.text);
  } catch {
    throw new Unreachable('registry returned invalid JSON');
  }
  out.exists = true;
  out.latest = meta['dist-tags']?.latest ?? null;
  const ver = meta.versions?.[out.latest] ?? {};
  const fsMeta = ver.fontsource ?? meta.fontsource;
  let subsets = fsMeta?.subsets ?? null;
  let axes = fsMeta?.variable ?? null;
  if (!subsets) {
    try {
      const md = await politeGet(`https://cdn.jsdelivr.net/npm/${pkg}@${out.latest ?? 'latest'}/metadata.json`);
      if (md.status < 400) {
        const j = JSON.parse(md.text);
        subsets = j.subsets ?? null;
        axes = j.variable && typeof j.variable === 'object' ? j.variable : axes;
      } else out.error = `metadata.json HTTP ${md.status}`;
    } catch (e) {
      out.error = `metadata.json unavailable: ${e.message}`;
    }
  }
  if (subsets) {
    out.subsets = subsets;
    out.cyrillic = subsets.includes('cyrillic');
    out.latin_ext = subsets.includes('latin-ext');
  }
  if (axes && typeof axes === 'object') out.variable_axes = Object.keys(axes);
  verifyCache.set(pkg, out);
  return out;
}

// ---------------------------------------------------------------- main

async function main() {
  const { flags, positional, rest } = parseArgs(process.argv.slice(2), spec);
  const names = [positional.family, ...rest].filter(Boolean);
  // The default map lives in the plugin root; an explicit --map is relative to the cwd.
  const mapPath = flags.map === spec.flags.map.default ? join(ROOT, flags.map) : resolve(flags.map);
  let map;
  try {
    map = JSON.parse(await readFile(mapPath, 'utf8'));
    if (!Array.isArray(map)) throw new Error('map must be a JSON array');
  } catch (e) {
    fail(`cannot read map ${flags.map}: ${e.message}`);
  }
  const idx = buildIndex(map);
  const results = [];
  let failed = false;
  for (const name of names) {
    if (!normalizeFamily(name)) {
      // Framer "Placeholder" fallback faces (and empty names) are not fonts: report, do not fail.
      results.push({ observed: name, family: null, package: null, variable: null, cyrillic: null, import: null, alternative: null, verified: null, skipped: 'placeholder' });
      continue;
    }
    const m = matchFamily(name, map, idx);
    if (!m) {
      failed = true;
      results.push({ observed: name, family: null, package: null, variable: null, cyrillic: null, import: null, alternative: null, verified: flags.verify ? false : null, error: 'unmapped' });
      continue;
    }
    const e = m.entry;
    const r = {
      observed: name,
      family: e.family,
      package: e.package,
      variable: !!e.variable,
      cyrillic: !!e.cyrillic,
      latin_ext: e.latin_ext ?? null,
      import: e.import,
      alternative: normalizeFamily(e.family) !== m.key,
      verified: null,
    };
    if (e.note) r.note = e.note;
    if (flags.verify) {
      let v;
      try {
        v = await verifyPackage(e.package);
      } catch (err) {
        if (err instanceof Unreachable) {
          log.error(err.message);
          process.stdout.write(JSON.stringify(results, null, 2) + '\n');
          process.exit(EXIT_USAGE);
        }
        throw err;
      }
      const problems = [];
      if (!v.exists) problems.push(v.error ?? 'package missing');
      if (v.cyrillic !== null && v.cyrillic !== r.cyrillic) problems.push(`cyrillic is ${v.cyrillic} on Fontsource, map says ${r.cyrillic}`);
      if (v.latin_ext !== null && r.latin_ext !== null && v.latin_ext !== r.latin_ext) problems.push(`latin_ext is ${v.latin_ext} on Fontsource, map says ${r.latin_ext}`);
      if (r.variable && v.variable_axes && !v.variable_axes.includes('wght')) problems.push(`no wght axis (axes: ${v.variable_axes.join(', ')})`);
      if (v.subsets === null && v.exists) problems.push(v.error ?? 'subsets unknown');
      r.verified = problems.length === 0;
      r.registry = { latest: v.latest, subsets: v.subsets, variable_axes: v.variable_axes };
      if (problems.length) {
        r.problems = problems;
        failed = true;
      }
    }
    results.push(r);
  }

  // JSON on stdout regardless of --json (contract).
  process.stdout.write(JSON.stringify(results, null, 2) + '\n');
  for (const r of results) {
    if (r.error) log.warn(`${r.observed}: unmapped`);
    else if (r.problems) log.warn(`${r.observed} → ${r.package}: ${r.problems.join('; ')}`);
  }
  process.exitCode = failed ? EXIT_FAIL : EXIT_OK;
}

main().catch((e) => {
  log.error(e);
  process.exit(EXIT_USAGE);
});
