// tasteful — scripts/lib/fetch.mjs
//
// Polite HTTP for crawlers (stdlib only):
//   politeFetch(url, {timeoutMs, headers})  per-host 1 req/s token bucket, real Chrome UA,
//                                           follows redirects, 429/403 backoff → BlockedError
//   robotsAllowed(url)                      cached per-host robots.txt check (we are "*")
//   parseRobots(text) / isAllowedBy(rules, path)   pure parser + matcher (exported for tests)
//   canonicalUrl(u) / hostKey(u)            canonical form and dedupe key
//   createBucket({rps, now, sleep})         token bucket (injectable clock for tests)

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { log } from './log.mjs';

export const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

export class BlockedError extends Error {
  constructor(message, { url, status } = {}) {
    super(message);
    this.name = 'BlockedError';
    this.url = url;
    this.status = status;
  }
}

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Per-key token bucket with capacity 1: successive take(key) calls for the
 * same key are spaced at least 1000/rps ms apart. Calls are serialised per key.
 */
export function createBucket({ rps = 1, now = () => Date.now(), sleep = realSleep } = {}) {
  const interval = 1000 / rps;
  const next = new Map(); // key -> earliest timestamp for the next request
  const chain = new Map(); // key -> promise tail (serialises callers)
  return {
    take(key) {
      const prev = chain.get(key) ?? Promise.resolve();
      const p = prev.then(async () => {
        const t = now();
        const at = next.get(key) ?? 0;
        if (at > t) await sleep(at - t);
        next.set(key, Math.max(now(), at) + interval);
      });
      chain.set(key, p.catch(() => {}));
      return p;
    },
  };
}

const bucket = createBucket({ rps: 1 });
const blocks = new Map(); // host -> consecutive 429/403 count
const BACKOFF_MS = Number(process.env.TASTEFUL_BACKOFF_MS ?? 30000);

/**
 * GET a URL politely. Returns {status, url, headers, text()} (text() is cached).
 * On 429/403 waits 30 s and retries; after 3 consecutive 429/403 responses
 * from the same host throws BlockedError. Network errors propagate.
 */
export async function politeFetch(url, { timeoutMs = 15000, headers = {}, retryBlocked = true } = {}) {
  const host = new URL(url).host.toLowerCase();
  for (;;) {
    await bucket.take(host);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(new Error(`timeout after ${timeoutMs} ms: ${url}`)), timeoutMs);
    let res;
    let body;
    try {
      res = await fetch(url, {
        redirect: 'follow',
        signal: ctl.signal,
        headers: {
          'user-agent': CHROME_UA,
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'en-US,en;q=0.9',
          ...headers,
        },
      });
      body = await res.text();
    } finally {
      clearTimeout(timer);
    }
    log.debug(`GET ${url} → ${res.status}`);
    if (res.status === 429 || res.status === 403) {
      const n = (blocks.get(host) ?? 0) + 1;
      blocks.set(host, n);
      if (n >= 3) throw new BlockedError(`blocked: ${n} consecutive ${res.status} responses from ${host}`, { url, status: res.status });
      if (!retryBlocked) return wrap(res, body);
      log.warn(`${res.status} from ${host}; backing off ${Math.round(BACKOFF_MS / 1000)} s`);
      await realSleep(BACKOFF_MS);
      continue;
    }
    blocks.set(host, 0);
    return wrap(res, body);
  }
}

function wrap(res, body) {
  return { status: res.status, url: res.url, headers: res.headers, text: async () => body };
}

// ---------------------------------------------------------------- robots.txt

/**
 * Parse robots.txt into groups: [{agents:[lowercased], rules:[{allow:boolean, path}]}].
 * Consecutive User-agent lines share one group.
 */
export function parseRobots(text) {
  const groups = [];
  let cur = null;
  let lastWasAgent = false;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === 'user-agent') {
      if (!lastWasAgent || !cur) {
        cur = { agents: [], rules: [] };
        groups.push(cur);
      }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (!cur) continue;
      if (key === 'allow' || key === 'disallow') {
        if (key === 'disallow' && val === '') continue; // empty Disallow = allow all
        cur.rules.push({ allow: key === 'allow', path: val });
      }
    }
  }
  return groups;
}

/** Rules that apply to us: groups for "*" plus any group naming one of `agents`. */
export function rulesFor(groups, agents = ['*']) {
  const want = agents.map((a) => a.toLowerCase());
  const named = groups.filter((g) => g.agents.some((a) => a !== '*' && want.includes(a)));
  const pick = named.length ? named : groups.filter((g) => g.agents.includes('*'));
  return pick.flatMap((g) => g.rules);
}

function patternToRegex(p) {
  const anchored = p.endsWith('$');
  const body = (anchored ? p.slice(0, -1) : p)
    .split('*')
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp('^' + body + (anchored ? '$' : ''));
}

/** Longest matching rule wins; on equal length Allow wins; no match → allowed. */
export function isAllowedBy(rules, pathAndQuery) {
  let best = null;
  for (const r of rules) {
    if (!r.path) continue;
    if (!patternToRegex(r.path).test(pathAndQuery)) continue;
    const len = r.path.length;
    if (!best || len > best.len || (len === best.len && r.allow && !best.allow)) best = { len, allow: r.allow };
  }
  return best ? best.allow : true;
}

const robotsCache = new Map(); // origin -> Promise<rules>

/** True when robots.txt of the URL's host allows us ("*") to fetch it. Unreachable robots → allowed. */
export async function robotsAllowed(url) {
  const u = new URL(url);
  const origin = u.origin;
  if (!robotsCache.has(origin)) {
    robotsCache.set(
      origin,
      (async () => {
        try {
          const res = await politeFetch(`${origin}/robots.txt`, { timeoutMs: 10000, retryBlocked: false });
          if (res.status >= 400) return [];
          return rulesFor(parseRobots(await res.text()));
        } catch (e) {
          if (e instanceof BlockedError) throw e;
          log.warn(`robots.txt unreachable for ${origin}: ${e.message}`);
          return [];
        }
      })(),
    );
  }
  const rules = await robotsCache.get(origin);
  return isAllowedBy(rules, u.pathname + u.search);
}

// ---------------------------------------------------------------- URLs

const TRACKING = /^(utm_.*|fbclid|gclid|ref)$/i;

/** Canonical URL: lowercase host, no tracking params, no hash, no trailing slash (except root). */
export function canonicalUrl(u) {
  const url = new URL(u);
  url.hostname = url.hostname.toLowerCase();
  url.hash = '';
  for (const k of [...url.searchParams.keys()]) if (TRACKING.test(k)) url.searchParams.delete(k);
  let s = url.toString();
  if (!url.search && url.pathname !== '/' && s.endsWith('/')) s = s.replace(/\/+$/, '');
  else if (url.search && url.pathname !== '/' && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '');
    s = url.toString();
  }
  return s;
}

/** Dedupe key: canonical URL without scheme and without a leading "www.". */
export function hostKey(u) {
  const c = new URL(canonicalUrl(u));
  const host = c.hostname.replace(/^www\./, '');
  const path = c.pathname === '/' ? '' : c.pathname;
  return host + (c.port ? `:${c.port}` : '') + path + c.search;
}

// ---------------------------------------------------------------- HTML helpers

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/** Decode the HTML entities that appear in attribute values and text nodes. */
export function decodeEntities(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

/** Strip tags and collapse whitespace. */
export function textOf(html) {
  return decodeEntities(String(html ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** "Web & Interactive" → "web-interactive". */
export function slugTag(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** ISO date from month name + day + year, or null. */
export function isoDate(year, month, day) {
  const m = MONTHS[String(month).slice(0, 3).toLowerCase()];
  const y = Number(year);
  const d = Number(day);
  if (!m || !y || !d || d > 31) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Today as YYYY-MM-DD (local time). */
export function today(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** True when this module file is the script being executed (main guard for importable scripts). */
export function isMain(importMetaUrl) {
  try {
    if (!process.argv[1]) return false;
    return realpathSync(fileURLToPath(importMetaUrl)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}
