#!/usr/bin/env node
// tasteful — scripts/probe.mjs
//
// Probe a site for computed design facts (fonts, type scale, palette by area,
// radii, shadows, buttons, cards, rhythm, motion). Contract: docs/SCRIPTS.md.
//
// Modes:
//   --quick   plain fetch liveness (status, final_url, title, elapsed_ms)
//   default   headless Chromium; all facts computed in-page
//   --deep    default + desktop/mobile JPEG screenshots (≤ 300 KB each)
//   static    automatic fallback (no Playwright, or the site blocks headless):
//             fetch HTML + same-origin CSS, parse it, report what CSS says.
//
// Env hooks: TASTEFUL_FORCE_STATIC=1 skips the browser (used by tests).

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, fail, EXIT_OK, EXIT_FAIL, EXIT_USAGE } from './lib/args.mjs';
import { log } from './lib/log.mjs';
import { dataDir, loadPlaywright } from './lib/deps.mjs';
import { CHROME_UA, dismissCookieBanners, jpegUnder, newContext, waitForFonts, withBudget } from './lib/browser.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_SHOT = 300 * 1024;
const FETCH_MS = 8000;
const CHALLENGE_RE = /just a moment|access denied|verify you are human|attention required/i;
const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/145.0.0.0 Mobile/15E148 Safari/604.1';

const spec = {
  usage: 'probe.mjs <url> [--quick] [--deep] [--out <dir>] [--timeout <ms>] [--batch <file>] [--concurrency <n>]',
  description:
    'Probe a site for computed design facts with headless Chromium (falls back to fetch + CSS parsing\n' +
    'when Playwright is missing or the site blocks headless). --quick is a plain fetch liveness check.',
  positional: [{ name: 'url', required: false, help: 'Site to probe (required unless --batch)' }],
  flags: {
    quick: { type: 'boolean', default: false, help: 'Plain fetch liveness only (status, final_url, title, elapsed_ms)' },
    deep: { type: 'boolean', default: false, help: 'Also write desktop.jpg (1440x900) and mobile.jpg (390x844), each <= 300 KB' },
    out: { type: 'string', help: 'Screenshot directory (default: index/shots/<host>)' },
    timeout: { type: 'number', default: 30000, help: 'Per-page budget in ms; never hangs past it' },
    batch: { type: 'string', help: 'File of URLs (one per line, or JSONL with a "url" field); emits JSONL' },
    concurrency: { type: 'number', default: 3, help: 'Parallel pages in --batch mode' },
  },
};

// ---------------------------------------------------------------- helpers

function normalizeUrl(u) {
  let s = String(u ?? '').trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s;
  try {
    const url = new URL(s);
    if (!/^https?:$/.test(url.protocol)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function hostOf(u) {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return 'unknown';
  }
}

function netError(e) {
  if (e?.name === 'AbortError' || e?.name === 'TimeoutError') return 'timeout';
  const code = e?.cause?.code ?? e?.code;
  const msg = e?.cause?.message ?? e?.message ?? String(e);
  return code ? `${code}: ${msg}` : msg;
}

/** GET with a hard timeout covering headers and body; body capped at maxBytes. */
async function fetchText(url, { ms = FETCH_MS, maxBytes = 2 * 1024 * 1024, accept } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'user-agent': CHROME_UA,
        accept: accept ?? 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
      },
    });
    let text = '';
    if (res.body) {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        text += dec.decode(value, { stream: true });
        if (size >= maxBytes) {
          await reader.cancel().catch(() => {});
          break;
        }
      }
      text += dec.decode();
    }
    return { status: res.status, url: res.url || url, headers: res.headers, text };
  } finally {
    clearTimeout(timer);
  }
}

function htmlTitle(html) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html ?? '');
  return m ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim() || null : null;
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function baseResult(url, mode) {
  return {
    url,
    final_url: null,
    status: null,
    mode,
    probed_at: new Date().toISOString(),
    elapsed_ms: 0,
    title: null,
    lang: null,
    color_scheme: null,
    fonts: { loaded: [], computed: {}, faces: [], google_fonts: false, self_hosted: false },
    type: { h1: null, h2: null, body: null },
    colors: { backgrounds: [], texts: [], borders: [] },
    radii: { histogram: {} },
    shadows: [],
    buttons: [],
    cards: [],
    nav: { height: null },
    container: { maxWidth: null },
    rhythm: { section_gaps: [] },
    motion: { transition_durations: [], easings: [], animated_count: 0, canvas_count: 0, webgl: false, level_guess: 0 },
    cookie_banner_dismissed: false,
    partial: false,
    errors: [],
  };
}

const isDead = (r) => r.dead === true;

/** Stamp elapsed time; keep `dead` as a non-enumerable flag so it never reaches the JSON. */
function finalize(r, t0) {
  const dead = r.dead === true;
  delete r.dead;
  r.elapsed_ms = Date.now() - t0;
  Object.defineProperty(r, 'dead', { value: dead, enumerable: false, writable: true });
  return r;
}

// ---------------------------------------------------------------- quick

async function probeQuick(url, timeoutMs) {
  const t0 = Date.now();
  const r = { url, final_url: null, status: null, mode: 'quick', probed_at: new Date().toISOString(), elapsed_ms: 0, title: null, errors: [] };
  try {
    const res = await fetchText(url, { ms: Math.min(FETCH_MS, timeoutMs), maxBytes: 512 * 1024 });
    r.status = res.status;
    r.final_url = res.url;
    r.title = htmlTitle(res.text);
    if (res.status >= 400) {
      r.errors.push(`HTTP ${res.status}`);
      r.dead = true;
    }
  } catch (e) {
    r.errors.push(netError(e));
    r.dead = true;
  }
  return finalize(r, t0);
}

// ---------------------------------------------------------------- static fallback

const GENERIC_FAMILIES = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif',
  'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong', '-apple-system', 'blinkmacsystemfont',
  'inherit', 'initial', 'unset', 'revert', 'var', 'apple color emoji', 'segoe ui emoji', 'segoe ui symbol', 'noto color emoji',
]);

function firstFamily(stack) {
  if (!stack) return null;
  for (const raw of String(stack).split(',')) {
    const f = raw.trim().replace(/^["']|["']$/g, '').trim();
    if (!f || f.startsWith('var(')) continue;
    if (GENERIC_FAMILIES.has(f.toLowerCase())) return null;
    return f;
  }
  return null;
}

const NAMED = { white: [255, 255, 255], black: [0, 0, 0], red: [255, 0, 0], blue: [0, 0, 255], green: [0, 128, 0], gray: [128, 128, 128], grey: [128, 128, 128], silver: [192, 192, 192], navy: [0, 0, 128], orange: [255, 165, 0], yellow: [255, 255, 0], purple: [128, 0, 128], teal: [0, 128, 128] };

/** Parse a literal CSS colour (#hex, rgb[a](), hsl[a](), a few names) → [r,g,b,a] or null. */
export function parseColor(v) {
  if (!v) return null;
  const s = String(v).trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  m = /^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(s);
  if (m) {
    const ch = (x) => (x.endsWith('%') ? (parseFloat(x) * 255) / 100 : parseFloat(x));
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return [ch(m[1]), ch(m[2]), ch(m[3]), a];
  }
  m = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(s);
  if (m) {
    const h = parseFloat(m[1]) / 360, sat = parseFloat(m[2]) / 100, l = parseFloat(m[3]) / 100;
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat, p = 2 * l - q;
    const f = (t) => {
      t = (t + 1) % 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255, a];
  }
  if (NAMED[s]) return [...NAMED[s], 1];
  return null;
}

const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
const toHex = ([r, g, b]) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;
const bucketKey = ([r, g, b]) => [r, g, b].map((v) => Math.round(v / 17).toString(16)).join('');

function topN(map, n) {
  return [...map.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, n);
}

function durationsMs(value) {
  const out = [];
  for (const m of String(value).matchAll(/(?<![\w-])(\d*\.?\d+)(ms|s)\b/g)) {
    const ms = m[2] === 's' ? parseFloat(m[1]) * 1000 : parseFloat(m[1]);
    if (ms > 0 && ms <= 60000) out.push(Math.round(ms));
  }
  return out;
}

function easingsOf(value) {
  const out = [];
  for (const m of String(value).matchAll(/cubic-bezier\([^)]*\)|steps\([^)]*\)|\b(ease-in-out|ease-in|ease-out|ease|linear)\b/g)) out.push(m[0].replace(/\s+/g, ' '));
  return out;
}

function levelGuess({ durations, beyondColor, animated, scrollLibs, webgl, canvas }) {
  if (webgl || (canvas >= 1 && animated > 0)) return 3;
  if (scrollLibs) return 2;
  if (!beyondColor && animated === 0) return 0;
  const max = durations.length ? Math.max(...durations) : 0;
  if (max <= 400 && animated <= 3) return 1;
  return animated > 3 ? 2 : 1;
}

async function probeStatic(url, timeoutMs, reasons = []) {
  const t0 = Date.now();
  const r = baseResult(url, 'static');
  r.partial = true;
  r.errors.push(...reasons);
  const deadline = t0 + timeoutMs;
  let page;
  try {
    page = await fetchText(url, { ms: Math.min(FETCH_MS, timeoutMs) });
  } catch (e) {
    r.errors.push(`fetch failed: ${netError(e)}`);
    r.dead = true;
    return finalize(r, t0);
  }
  r.status = page.status;
  r.final_url = page.url;
  const html = page.text;
  r.title = htmlTitle(html);
  r.lang = /<html[^>]*\blang=["']?([\w-]+)/i.exec(html)?.[1] ?? null;
  const blocked = [403, 429, 503].includes(page.status) || CHALLENGE_RE.test(r.title ?? '');
  if (page.status >= 400 && !blocked) {
    r.errors.push(`HTTP ${page.status}`);
    r.dead = true;
    return finalize(r, t0);
  }
  if (blocked) r.errors.push(`static fetch also blocked (HTTP ${page.status})`);

  let css;
  try {
    css = await import('./lib/css.mjs');
  } catch (e) {
    r.errors.push(`css parser unavailable: ${e.message}`);
    return finalize(r, t0);
  }

  const pageHost = hostOf(page.url);
  const sources = [];
  for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) sources.push({ text: m[1], base: page.url });
  for (const m of html.matchAll(/style=["']([^"']{3,})["']/gi)) sources.push({ text: `x{${decodeEntities(m[1])}}`, base: page.url });
  const hrefs = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/rel=["']?[^"'>]*stylesheet/i.test(tag)) continue;
    const href = /href=["']?([^"'\s>]+)/i.exec(tag)?.[1];
    if (!href) continue;
    try {
      hrefs.push(new URL(decodeEntities(href), page.url).href);
    } catch {
      /* skip */
    }
  }
  r.fonts.google_fonts = /fonts\.(googleapis|gstatic)\.com/i.test(html);
  const sameOrigin = hrefs.filter((h) => hostOf(h) === pageHost).slice(0, 5);
  for (const h of sameOrigin) {
    if (Date.now() > deadline - 500) {
      r.errors.push('budget exhausted before all stylesheets were fetched');
      break;
    }
    try {
      const res = await fetchText(h, { ms: Math.min(FETCH_MS, deadline - Date.now()), maxBytes: 1024 * 1024, accept: 'text/css,*/*;q=0.1' });
      if (res.status < 400) sources.push({ text: res.text, base: res.url });
      else r.errors.push(`stylesheet HTTP ${res.status}: ${h}`);
    } catch (e) {
      r.errors.push(`stylesheet failed: ${h} (${netError(e)})`);
    }
  }
  if (hrefs.length > sameOrigin.length) r.errors.push(`${hrefs.length - sameOrigin.length} cross-origin or extra stylesheet(s) skipped`);

  const vars = new Map();
  const decls = [];
  const fontFaces = [];
  for (const src of sources) {
    let parsed;
    try {
      parsed = css.parseCss(src.text);
    } catch (e) {
      r.errors.push(`css parse failed: ${e.message}`);
      continue;
    }
    css.walkDeclarations(parsed.nodes, (d, node) => {
      const prop = String(d.prop).toLowerCase();
      if (prop.startsWith('--')) vars.set(prop, d.value);
      if (node?.type === 'at' && String(node.name).toLowerCase() === 'font-face') fontFaces.push({ prop, value: d.value, base: src.base });
      else decls.push({ prop, value: String(d.value), base: src.base });
    });
    if (/@import\s+(url\()?["']?[^"')]*fonts\.googleapis/i.test(src.text)) r.fonts.google_fonts = true;
  }
  const resolveVars = (v, depth = 0) =>
    depth > 4 ? v : v.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/g, (_, name, fb) => resolveVars(vars.get(name.toLowerCase()) ?? fb ?? '', depth + 1));

  const families = new Map();
  const bgs = new Map();
  const texts = new Map();
  const borders = new Map();
  const radii = new Map();
  const shadows = new Map();
  const maxW = new Map();
  const durs = new Set();
  const eases = new Set();
  let beyondColor = false;
  let animated = 0;
  const bump = (m, k, n = 1) => m.set(k, (m.get(k) ?? 0) + n);
  const colorBump = (m, raw) => {
    const c = parseColor(raw);
    if (c && c[3] >= 0.5) bump(m, toHex(c));
  };
  for (const { prop, value: raw } of decls) {
    const value = resolveVars(raw).trim();
    if (!value) continue;
    switch (prop) {
      case 'font-family': {
        const f = firstFamily(value);
        if (f) bump(families, f);
        break;
      }
      case 'font': {
        const f = firstFamily(value.replace(/^.*?\d[\w.%/]*\s+(?=["'a-z])/i, ''));
        if (f && !/^\d/.test(f)) bump(families, f);
        break;
      }
      case 'color':
        colorBump(texts, value);
        break;
      case 'background-color':
        colorBump(bgs, value);
        break;
      case 'background': {
        const m = /(#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\))/i.exec(value);
        if (m && !/gradient|url\(/i.test(value.slice(0, m.index))) colorBump(bgs, m[1]);
        else if (/^(white|black)$/i.test(value)) colorBump(bgs, value);
        break;
      }
      case 'border':
      case 'border-top':
      case 'border-bottom':
      case 'border-left':
      case 'border-right':
      case 'border-color': {
        const m = /(#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\))/i.exec(value);
        if (m) colorBump(borders, m[1]);
        break;
      }
      case 'border-radius':
        if (!/^0(px)?$/.test(value)) bump(radii, value.split(/\s+/)[0]);
        break;
      case 'box-shadow':
        if (value !== 'none') bump(shadows, value.replace(/\s+/g, ' '));
        break;
      case 'max-width':
        if (/^\d/.test(value) && !/%$/.test(value)) {
          const px = value.endsWith('rem') || value.endsWith('em') ? parseFloat(value) * 16 : parseFloat(value);
          if (px >= 480) bump(maxW, value);
        }
        break;
      case 'transition':
      case 'transition-duration':
        for (const d of durationsMs(value)) durs.add(d);
        for (const e of easingsOf(value)) eases.add(e);
        if (prop === 'transition' && !/^(none|0s?)$/.test(value)) {
          for (const part of value.split(/,(?![^(]*\))/)) {
            const p = part.trim().split(/\s+/)[0];
            if (p && !/^(color|background-color|border-color|background|fill|stroke|outline-color|text-decoration-color)$/.test(p) && durationsMs(part).length) beyondColor = true;
          }
        }
        break;
      case 'transition-property':
        if (!/^(color|background-color|border-color|background|fill|stroke|outline-color|text-decoration-color)(\s*,\s*(color|background-color|border-color|background|fill|stroke|outline-color|text-decoration-color))*$/.test(value) && value !== 'none') beyondColor = true;
        break;
      case 'transition-timing-function':
        for (const e of easingsOf(value)) eases.add(e);
        break;
      case 'animation':
      case 'animation-name':
        if (!/^none\b/.test(value)) animated++;
        if (prop === 'animation') for (const d of durationsMs(value)) durs.add(d);
        break;
      case 'animation-duration':
        for (const d of durationsMs(value)) durs.add(d);
        break;
      default:
    }
  }
  let selfHosted = false;
  const faceFamilies = new Set();
  for (const f of fontFaces) {
    if (f.prop === 'font-family') faceFamilies.add(firstFamily(f.value) ?? f.value.replace(/["']/g, ''));
    if (f.prop === 'src') {
      for (const m of String(f.value).matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
        try {
          if (hostOf(new URL(m[1], f.base).href) === pageHost) selfHosted = true;
        } catch {
          /* skip */
        }
      }
    }
  }
  r.fonts.self_hosted = selfHosted;
  const famTop = topN(families, 12).map(([f]) => f);
  r.fonts.faces = [...new Set([...famTop, ...faceFamilies].filter(Boolean))];
  r.fonts.computed = { body: famTop[0] ?? null, h1: null, h2: null, p: null, nav: null, button: null };
  r.fonts.family_counts = Object.fromEntries(topN(families, 12));
  r.type = { h1: null, h2: null, body: null };
  r.colors.backgrounds = topN(bgs, 8).map(([hex, count]) => ({ hex, area_pct: null, count }));
  const tTotal = [...texts.values()].reduce((a, b) => a + b, 0) || 1;
  r.colors.texts = topN(texts, 8).map(([hex, n]) => ({ hex, weight: Math.round((n / tTotal) * 1000) / 1000 }));
  r.colors.borders = topN(borders, 5).map(([hex, count]) => ({ hex, count }));
  r.radii.histogram = Object.fromEntries(topN(radii, 16));
  r.shadows = topN(shadows, 5).map(([value, count]) => ({ value, count }));
  r.container.maxWidth = topN(maxW, 1)[0]?.[0] ?? null;
  const canvas = (html.match(/<canvas\b/gi) ?? []).length;
  const scrollLibs = /gsap|scrolltrigger|lenis|locomotive/i.test(html);
  const webgl = /three(\.module)?(\.min)?\.js|\bthree@|webgl/i.test(html);
  const durations = [...durs].sort((a, b) => a - b);
  r.motion = {
    transition_durations: durations,
    easings: [...eases].slice(0, 12),
    animated_count: animated,
    canvas_count: canvas,
    webgl,
    libs: ['gsap', 'ScrollTrigger', 'lenis', 'locomotive'].filter((l) => new RegExp(l, 'i').test(html)),
    level_guess: levelGuess({ durations, beyondColor, animated, scrollLibs, webgl, canvas }),
  };
  r.stylesheets = { inline: sources.filter((s) => s.base === page.url).length, fetched: sources.length - sources.filter((s) => s.base === page.url).length };
  return finalize(r, t0);
}

// ---------------------------------------------------------------- in-page collector

/* Runs inside the page (serialised by Playwright). Must be self-contained. */
function collectFacts({ maxEls, vpCount }) {
  const vw = innerWidth;
  const vh = innerHeight;
  const sy = scrollY;
  const limitY = vh * vpCount;
  const docH = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0);
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const cache = new Map();
  const rgba = (str) => {
    if (!str) return null;
    if (cache.has(str)) return cache.get(str);
    let out = null;
    const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(str);
    if (m) {
      const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
      out = [+m[1], +m[2], +m[3], a];
    } else if (str === 'transparent') out = [0, 0, 0, 0];
    else {
      try {
        cx.clearRect(0, 0, 1, 1);
        cx.fillStyle = '#000';
        cx.fillStyle = str;
        cx.fillRect(0, 0, 1, 1);
        const d = cx.getImageData(0, 0, 1, 1).data;
        out = [d[0], d[1], d[2], d[3] / 255];
      } catch {
        out = null;
      }
    }
    cache.set(str, out);
    return out;
  };
  const h2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  const hex = (c) => (c ? `#${h2(c[0])}${h2(c[1])}${h2(c[2])}` : null);
  const bkey = (c) => c.slice(0, 3).map((v) => Math.round(v / 17).toString(16)).join('');
  const opaque = (c) => c && c[3] >= 0.9;
  const visibleColor = (c) => c && c[3] >= 0.1;
  const csOf = new Map();
  const cs = (el) => {
    let s = csOf.get(el);
    if (!s) {
      s = getComputedStyle(el);
      csOf.set(el, s);
    }
    return s;
  };

  // Effective background (first opaque bg up the tree; canvas = html → body → white).
  const effMemo = new Map();
  const html = document.documentElement;
  const body = document.body ?? html;
  const rootBg = (() => {
    const a = rgba(cs(html).backgroundColor);
    if (opaque(a)) return a;
    const b = rgba(cs(body).backgroundColor);
    if (opaque(b)) return b;
    return [255, 255, 255, 1];
  })();
  const eff = (el) => {
    if (!el || el === html || el === body || el.nodeType !== 1) return rootBg;
    if (effMemo.has(el)) return effMemo.get(el);
    const own = rgba(cs(el).backgroundColor);
    const v = opaque(own) ? own : eff(el.parentElement);
    effMemo.set(el, v);
    return v;
  };

  // Elements intersecting the first vpCount viewports (document coordinates).
  const els = [];
  for (const el of body.querySelectorAll('*')) {
    if (els.length >= maxEls) break;
    const tag = el.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEMPLATE' || tag === 'LINK' || tag === 'META') continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const top = r.top + sy;
    if (top >= limitY || r.bottom + sy <= 0) continue;
    const s = cs(el);
    if (s.visibility === 'hidden' || s.display === 'none' || parseFloat(s.opacity) < 0.05) continue;
    els.push({ el, r, top, s });
  }

  // Sampled box: full width × min(3 viewports, page height). Page height is the larger of
  // scrollHeight and the lowest sampled element (inner scroll containers keep scrollHeight = vh).
  let maxBottom = vh;
  for (const { r, top } of els) maxBottom = Math.max(maxBottom, top + r.height);
  const boxH = Math.min(limitY, Math.max(docH, maxBottom));
  const clipArea = (r, top) => {
    const x0 = Math.max(0, r.left), x1 = Math.min(vw, r.right);
    const y0 = Math.max(0, top), y1 = Math.min(boxH, top + r.height);
    return x1 > x0 && y1 > y0 ? (x1 - x0) * (y1 - y0) : 0;
  };

  // --- colours
  const bgArea = new Map(); // bucket -> {area, hexes: Map}
  const addBg = (c, area) => {
    const k = bkey(c);
    let b = bgArea.get(k);
    if (!b) bgArea.set(k, (b = { area: 0, hexes: new Map() }));
    b.area += area;
    const hx = hex(c);
    b.hexes.set(hx, (b.hexes.get(hx) ?? 0) + Math.max(area, 0));
  };
  const pageArea = vw * boxH;
  addBg(rootBg, pageArea);
  const textW = new Map();
  const borderN = new Map();
  const radiiN = new Map();
  const shadowN = new Map();
  const cards = [];
  const cardSig = new Set();
  const durs = new Set();
  const eases = new Set();
  const COLORISH = /^(color|background-color|border-color|background|fill|stroke|outline-color|text-decoration-color|border-(top|right|bottom|left)-color|caret-color|accent-color)$/;
  let beyondColor = false;
  let animated = 0;
  const families = new Map();
  const bump = (m, k, n = 1) => m.set(k, (m.get(k) ?? 0) + n);

  const parseDur = (v) => String(v).split(',').map((x) => (x.trim().endsWith('ms') ? parseFloat(x) : parseFloat(x) * 1000));

  for (const { el, r, top, s } of els) {
    const own = rgba(s.backgroundColor);
    const parentEff = eff(el.parentElement);
    const differs = opaque(own) && hex(own) !== hex(parentEff);
    if (differs) {
      const a = clipArea(r, top);
      if (a > 0) {
        addBg(own, a);
        addBg(parentEff, -a);
      }
    }
    // text colour: direct text nodes only (no double counting through ancestors)
    let len = 0;
    for (const n of el.childNodes) if (n.nodeType === 3) len += n.textContent.trim().length;
    if (len > 0) {
      const c = rgba(s.color);
      if (visibleColor(c)) bump(textW, hex(c), len * parseFloat(s.fontSize || '16'));
      const fam = s.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');
      if (fam) bump(families, fam, len);
    }
    // borders
    let border = null;
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      if (parseFloat(s[`border${side}Width`]) > 0 && s[`border${side}Style`] !== 'none' && s[`border${side}Style`] !== 'hidden') {
        const c = rgba(s[`border${side}Color`]);
        if (visibleColor(c)) {
          border = `${s[`border${side}Width`]} ${s[`border${side}Style`]} ${hex(c)}`;
          bump(borderN, hex(c));
          break;
        }
      }
    }
    // radii
    const rad = s.borderTopLeftRadius;
    if ((border || visibleColor(own)) && rad && rad !== '0px') bump(radiiN, rad);
    // shadows
    const sh = s.boxShadow;
    if (sh && sh !== 'none') bump(shadowN, sh);
    // cards
    if ((differs || border || (sh && sh !== 'none')) && r.width >= 240 && r.width <= 720 && r.height >= 120 && r.height <= 720 && cards.length < 5) {
      const card = { bg: opaque(own) ? hex(own) : visibleColor(own) ? s.backgroundColor : null, border, radius: rad, shadow: sh === 'none' ? null : sh, width: Math.round(r.width), height: Math.round(r.height) };
      const sig = `${card.bg}|${card.border}|${card.radius}|${card.shadow}`;
      if (!cardSig.has(sig)) {
        cardSig.add(sig);
        cards.push(card);
      }
    }
    // motion (computed)
    const tds = parseDur(s.transitionDuration);
    const tps = s.transitionProperty.split(',').map((x) => x.trim());
    const tfs = s.transitionTimingFunction.split(/,(?![^(]*\))/).map((x) => x.trim());
    tds.forEach((d, i) => {
      if (d > 0 && d <= 60000) {
        durs.add(Math.round(d));
        const p = tps[i % tps.length];
        if (!COLORISH.test(p)) beyondColor = true;
        const f = tfs[i % tfs.length];
        if (f) eases.add(f);
      }
    });
    if (s.animationName && s.animationName !== 'none') {
      animated++;
      for (const d of parseDur(s.animationDuration)) if (d > 0 && d <= 60000) durs.add(Math.round(d));
    }
  }

  // stylesheet rules (same-origin only)
  const fontFaceSrcs = [];
  let googleImport = false;
  const walk = (rules, depth) => {
    if (!rules || depth > 6) return;
    for (const rule of rules) {
      try {
        if (rule.type === 3 /* IMPORT */ && /fonts\.googleapis/i.test(rule.href ?? '')) googleImport = true;
        if (rule.type === 5 /* FONT_FACE */) {
          fontFaceSrcs.push({ src: rule.style.getPropertyValue('src'), base: rule.parentStyleSheet?.href ?? location.href });
          continue;
        }
        if (rule.style) {
          const td = rule.style.getPropertyValue('transition-duration');
          if (td) {
            const ds = parseDur(td);
            const tp = rule.style.getPropertyValue('transition-property').split(',').map((x) => x.trim());
            ds.forEach((d, i) => {
              if (d > 0 && d <= 60000) {
                durs.add(Math.round(d));
                const p = tp[i % tp.length];
                if (p && !COLORISH.test(p)) beyondColor = true;
              }
            });
          }
          const tf = rule.style.getPropertyValue('transition-timing-function');
          if (tf) for (const f of tf.split(/,(?![^(]*\))/)) if (f.trim() && f.trim() !== 'initial') eases.add(f.trim());
        }
        if (rule.cssRules) walk(rule.cssRules, depth + 1);
      } catch {
        /* skip rule */
      }
    }
  };
  for (const sheet of document.styleSheets) {
    try {
      walk(sheet.cssRules, 0);
    } catch {
      /* cross-origin */
    }
  }

  // --- fonts
  const loaded = [];
  const seenFace = new Set();
  try {
    for (const f of document.fonts) {
      if (f.status !== 'loaded') continue;
      const family = f.family.replace(/^["']|["']$/g, '');
      const k = `${family}|${f.weight}|${f.style}`;
      if (seenFace.has(k)) continue;
      seenFace.add(k);
      loaded.push({ family, weight: f.weight, style: f.style });
    }
  } catch {
    /* ignore */
  }
  const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace|ui-rounded|emoji|math|fangsong|-apple-system|blinkmacsystemfont|apple color emoji|segoe ui emoji|segoe ui symbol|noto color emoji)$/i;
  const firstFam = (stack) => {
    const f = String(stack ?? '').split(',')[0]?.trim().replace(/^["']|["']$/g, '');
    return f && !GENERIC.test(f) ? f : f || null;
  };
  const computed = {};
  const typeOf = (el) => {
    if (!el) return null;
    const s = getComputedStyle(el);
    return { size: s.fontSize, lineHeight: s.lineHeight, letterSpacing: s.letterSpacing, weight: s.fontWeight, family: firstFam(s.fontFamily) };
  };
  for (const sel of ['body', 'h1', 'h2', 'p', 'nav', 'button']) {
    const el = document.querySelector(sel);
    computed[sel] = el ? firstFam(getComputedStyle(el).fontFamily) : null;
  }
  const faces = [];
  for (const f of [...[...families.entries()].sort((a, b) => b[1] - a[1]).map(([f]) => f), ...Object.values(computed), ...loaded.map((l) => l.family)]) {
    if (f && !GENERIC.test(f) && !faces.includes(f)) faces.push(f);
  }
  const resources = performance.getEntriesByType('resource').map((e) => e.name);
  const googleFonts = googleImport || !!document.querySelector('link[href*="fonts.googleapis"], link[href*="fonts.gstatic"]') || resources.some((n) => /fonts\.(googleapis|gstatic)\.com/.test(n));
  let selfHosted = false;
  for (const { src, base } of fontFaceSrcs) {
    for (const m of String(src).matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
      try {
        if (new URL(m[1], base).hostname === location.hostname) selfHosted = true;
      } catch {
        /* skip */
      }
    }
  }
  if (!selfHosted) selfHosted = resources.some((n) => /\.(woff2?|ttf|otf)(\?|$)/i.test(n) && (() => { try { return new URL(n).hostname === location.hostname; } catch { return false; } })());

  // --- type
  const type = { h1: typeOf(document.querySelector('h1')), h2: typeOf(document.querySelector('h2')), body: typeOf(document.body) };

  // --- buttons
  const buttons = [];
  const btnSig = new Set();
  for (const el of document.querySelectorAll('button, a[role=button], a.btn, [class*="btn" i]')) {
    if (buttons.length >= 5) break;
    const r = el.getBoundingClientRect();
    if (r.width < 16 || r.height < 16 || r.top + sy >= limitY) continue;
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none') continue;
    const bg = rgba(s.backgroundColor);
    const b = {
      text: (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 40),
      bg: visibleColor(bg) ? hex(bg) : null,
      color: hex(rgba(s.color)),
      radius: s.borderTopLeftRadius,
      padding: s.padding,
      border: parseFloat(s.borderTopWidth) > 0 && s.borderTopStyle !== 'none' ? `${s.borderTopWidth} ${s.borderTopStyle} ${hex(rgba(s.borderTopColor))}` : null,
      fontFamily: firstFam(s.fontFamily),
      fontWeight: s.fontWeight,
      fontSize: s.fontSize,
      height: Math.round(r.height),
    };
    const sig = `${b.bg}|${b.color}|${b.radius}|${b.padding}|${b.fontFamily}|${b.fontSize}`;
    if (btnSig.has(sig)) continue;
    btnSig.add(sig);
    buttons.push(b);
  }

  // --- nav
  let navHeight = null;
  for (const el of document.querySelectorAll('header, nav')) {
    const r = el.getBoundingClientRect();
    if (r.height > 0 && r.width > 0) {
      navHeight = Math.round(r.height);
      break;
    }
  }

  // --- container max-width (top-level wrappers: depth ≤ 8 under body)
  const maxW = new Map();
  const depthOf = (el) => {
    let d = 0;
    for (let p = el; p && p !== body; p = p.parentElement) d++;
    return d;
  };
  let scanned = 0;
  for (const el of body.querySelectorAll('*')) {
    if (++scanned > maxEls) break;
    const s = cs(el);
    const mw = s.maxWidth;
    if (!mw || mw === 'none' || !mw.endsWith('px')) continue;
    if (parseFloat(mw) < 480 || depthOf(el) > 8) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0) continue;
    bump(maxW, mw);
  }
  const maxWidth = [...maxW.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  // --- rhythm: gaps between consecutive leaf-most section blocks, incl. their paddings
  const cand = [...new Set(document.querySelectorAll('main > *, section'))].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.height > 40 && r.width > vw * 0.5;
  });
  const leaf = cand.filter((el) => !cand.some((o) => o !== el && el.contains(o)));
  leaf.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
  const gaps = [];
  for (let i = 1; i < leaf.length && gaps.length < 10; i++) {
    const a = leaf[i - 1].getBoundingClientRect();
    const b = leaf[i].getBoundingClientRect();
    if (b.top < a.bottom - 1) continue; // overlapping / side by side
    const pa = parseFloat(getComputedStyle(leaf[i - 1]).paddingBottom) || 0;
    const pb = parseFloat(getComputedStyle(leaf[i]).paddingTop) || 0;
    gaps.push(Math.round(b.top - a.bottom + pa + pb));
  }

  // --- motion globals
  const canvases = document.querySelectorAll('canvas');
  const ctxLog = window.__tastefulCtx ?? { webgl: 0 };
  const scripts = [...document.scripts].map((s) => s.src).join(' ') + ' ' + resources.join(' ');
  const libs = [];
  if (window.gsap || /gsap/i.test(scripts)) libs.push('gsap');
  if (window.ScrollTrigger || /scrolltrigger/i.test(scripts)) libs.push('ScrollTrigger');
  if (window.Lenis || window.lenis || html.classList.contains('lenis') || /lenis/i.test(scripts)) libs.push('lenis');
  if (window.LocomotiveScroll || html.classList.contains('has-scroll-smooth') || document.querySelector('[data-scroll-container]') || /locomotive/i.test(scripts)) libs.push('locomotive');
  const revealEls = document.querySelectorAll('[data-aos],[data-scroll],[data-animate],[data-sal],.aos-init,.wow,[data-framer-appear-id]').length;
  const three = !!(window.THREE || window.__THREE__ || /three(\.module)?(\.min)?\.js|\/three@/i.test(scripts));
  let webglCanvas = ctxLog.webgl > 0;
  if (!webglCanvas) {
    for (const c of canvases) {
      try {
        // Only returns non-null when the canvas already holds a WebGL context of that kind
        // (a canvas with a 2d context returns null); our init-script recorder covers the rest.
        if (c.__tastefulKind === 'webgl') webglCanvas = true;
      } catch {
        /* ignore */
      }
    }
  }

  // --- colour-scheme
  const meta = document.querySelector('meta[name="color-scheme"]')?.content ?? '';
  const csRoot = cs(html).colorScheme;
  const lum = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
  // Buckets can go negative when overlapping/overflowing children subtract more than their
  // parent covered: clamp at 0 and normalise so the shares never sum past 100.
  const bgPositive = [...bgArea.values()].reduce((a, b) => a + Math.max(0, b.area), 0);
  const bgDenom = Math.max(pageArea, bgPositive) || 1;
  const bgList = [...bgArea.values()].map((b) => ({ hex: [...b.hexes.entries()].sort((x, y) => y[1] - x[1])[0][0], area: Math.max(0, b.area) })).sort((a, b) => b.area - a.area);
  const dominant = bgList[0] ? rgba(bgList[0].hex) : rootBg;
  const scheme = /dark/.test(csRoot) && !/light/.test(csRoot) ? 'dark' : /dark/.test(meta) && !/light/.test(meta) ? 'dark' : lum(dominant) < 0.35 ? 'dark' : 'light';
  const tTotal = [...textW.values()].reduce((a, b) => a + b, 0) || 1;
  const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

  return {
    title: document.title || null,
    lang: html.lang || null,
    color_scheme: scheme,
    sampled: els.length,
    fonts: { loaded, computed, faces, google_fonts: googleFonts, self_hosted: selfHosted },
    type,
    colors: {
      backgrounds: bgList.filter((b) => b.area > 0).slice(0, 8).map((b) => ({ hex: b.hex, area_pct: Math.round((b.area / bgDenom) * 1000) / 10 })),
      texts: top(textW, 8).map(([hx, w]) => ({ hex: hx, weight: Math.round((w / tTotal) * 1000) / 1000 })),
      borders: top(borderN, 5).map(([hx, count]) => ({ hex: hx, count })),
    },
    radii: { histogram: Object.fromEntries(top(radiiN, 16)) },
    shadows: top(shadowN, 5).map(([value, count]) => ({ value, count })),
    buttons,
    cards,
    nav: { height: navHeight },
    container: { maxWidth },
    rhythm: { section_gaps: gaps },
    motion: {
      transition_durations: [...durs].sort((a, b) => a - b),
      easings: [...eases].slice(0, 12),
      animated_count: animated,
      canvas_count: canvases.length,
      webgl: webglCanvas || three,
      libs,
      reveal_count: revealEls,
      beyond_color: beyondColor,
    },
  };
}

/* Init script: records which canvas contexts the page creates (WebGL detection without side effects). */
function canvasRecorder() {
  try {
    window.__tastefulCtx = { webgl: 0, '2d': 0 };
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
      const ctx = orig.call(this, kind, ...rest);
      try {
        if (ctx && /webgl/i.test(kind)) {
          window.__tastefulCtx.webgl++;
          this.__tastefulKind = 'webgl';
        } else if (ctx && kind === '2d') window.__tastefulCtx['2d']++;
      } catch {
        /* ignore */
      }
      return ctx;
    };
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------- browser probe

/**
 * Probe one URL in an already-launched browser. Fills `r` progressively so a
 * budget timeout can still report what was collected.
 * Returns 'ok' | 'blocked' | 'dead'.
 */
async function browserWork(browser, url, opts, r, ctxs) {
  const context = await newContext(browser);
  ctxs.push(context);
  await context.addInitScript(canvasRecorder);
  const page = await context.newPage();
  ctxs.page = page;
  // Track the main-document status even when the page never reaches DOMContentLoaded.
  page.on('response', (res) => {
    try {
      if (res.request().isNavigationRequest() && res.frame() === page.mainFrame()) {
        r.status = res.status();
        r.final_url = res.url();
      }
    } catch {
      /* ignore */
    }
  });
  let resp;
  try {
    resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: Math.max(5000, opts.timeout - 6000) });
  } catch (e) {
    r.errors.push(`navigation failed: ${String(e.message).split('\n')[0]}`);
    return /ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_REFUSED|ERR_ADDRESS_UNREACHABLE|ERR_CERT|ERR_SSL|ERR_TIMED_OUT|ERR_CONNECTION_RESET|ERR_INTERNET_DISCONNECTED|ERR_EMPTY_RESPONSE/.test(e.message) ? 'dead' : 'blocked';
  }
  r.status = resp?.status() ?? null;
  r.final_url = page.url();
  await page.waitForLoadState('load', { timeout: 6000 }).catch(() => {});
  const challenge = async () => {
    const t = await page.title().catch(() => '');
    const txt = await page.evaluate(() => (document.body?.innerText ?? '').slice(0, 1500)).catch(() => '');
    return CHALLENGE_RE.test(t) || (txt.length < 1500 && CHALLENGE_RE.test(txt));
  };
  if ([403, 429, 503].includes(r.status) || (await challenge())) {
    // Interstitials (Cloudflare etc.) sometimes clear by themselves.
    await page.waitForTimeout(4000);
    if (await challenge()) {
      r.errors.push(`blocked headless (HTTP ${r.status}, challenge page)`);
      return 'blocked';
    }
    r.status = 200;
  } else if (r.status >= 400) {
    r.errors.push(`HTTP ${r.status}`);
    return 'dead';
  }
  // Let intro loaders and late network settle (bounded), then dismiss banners and wait for fonts.
  await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(1500);
  r.cookie_banner_dismissed = await dismissCookieBanners(page);
  await waitForFonts(page, 5000);
  // Scroll through the sampled viewports so lazy content and reveal-on-scroll settle, then back to top.
  await page
    .evaluate(async () => {
      const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
      for (let i = 1; i <= 3; i++) {
        window.scrollTo(0, innerHeight * i);
        await sleep(200);
      }
      window.scrollTo(0, 0);
      await sleep(350);
    })
    .catch(() => {});
  if (r.cookie_banner_dismissed === false) r.cookie_banner_dismissed = await dismissCookieBanners(page);
  const facts = await page.evaluate(collectFacts, { maxEls: 4000, vpCount: 3 });
  ctxs.factsDone = true;
  applyFacts(r, facts);
  r.title = r.title ?? (await page.title().catch(() => null));
  r.final_url = page.url();
  if (opts.deep) await deepShots(browser, page, url, opts, r, ctxs);
  return 'ok';
}

/** Merge collectFacts() output into the result and derive the motion level. */
function applyFacts(r, facts) {
  const { motion, sampled, ...rest } = facts;
  Object.assign(r, rest);
  r.sampled_elements = sampled;
  r.motion = {
    transition_durations: motion.transition_durations,
    easings: motion.easings,
    animated_count: motion.animated_count,
    canvas_count: motion.canvas_count,
    webgl: motion.webgl,
    libs: motion.libs,
    level_guess: levelGuess({
      durations: motion.transition_durations,
      beyondColor: motion.beyond_color,
      animated: motion.animated_count,
      scrollLibs: motion.libs.length > 0 || (motion.reveal_count > 5 && motion.animated_count > 3),
      webgl: motion.webgl,
      canvas: motion.canvas_count,
    }),
  };
}

/** Desktop + mobile viewport screenshots, each ≤ 300 KB. */
async function deepShots(browser, page, url, opts, r, ctxs) {
  const dir = opts.out ?? join(ROOT, 'index', 'shots', hostOf(r.final_url || url));
  await mkdir(dir, { recursive: true });
  r.screenshots = { desktop: null, mobile: null };
  const desktop = await jpegUnder(page, MAX_SHOT);
  const dPath = join(dir, 'desktop.jpg');
  await writeFile(dPath, desktop);
  r.screenshots.desktop = dPath;
  if (desktop.length > MAX_SHOT) r.errors.push(`desktop.jpg is ${desktop.length} bytes (> 300 KB at quality 40)`);
  await page.close().catch(() => {});
  const mctx = await newContext(browser, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: MOBILE_UA });
  ctxs.push(mctx);
  const mpage = await mctx.newPage();
  await mpage.goto(r.final_url || url, { waitUntil: 'domcontentloaded', timeout: 12000 });
  await mpage.waitForLoadState('load', { timeout: 5000 }).catch(() => {});
  await dismissCookieBanners(mpage);
  await mpage.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
  await waitForFonts(mpage, 3000);
  await mpage.waitForTimeout(1500);
  let mobile = await jpegUnder(mpage, MAX_SHOT);
  if (mobile.length > MAX_SHOT) mobile = await jpegUnder(mpage, MAX_SHOT, { scale: 'css' });
  const mPath = join(dir, 'mobile.jpg');
  await writeFile(mPath, mobile);
  r.screenshots.mobile = mPath;
  if (mobile.length > MAX_SHOT) r.errors.push(`mobile.jpg is ${mobile.length} bytes (> 300 KB)`);
}

async function probeBrowser(browser, url, opts) {
  const t0 = Date.now();
  const r = baseResult(url, 'browser');
  const ctxs = [];
  let outcome;
  const work = browserWork(browser, url, opts, r, ctxs);
  work.catch(() => {}); // late rejections after a budget timeout are expected
  try {
    // Reserve up to 3 s of the budget to salvage facts from a page that is still loading.
    const reserve = Math.min(3000, Math.max(1000, Math.round(opts.timeout * 0.2)));
    outcome = await withBudget(work, Math.max(1000, opts.timeout - reserve), () => 'timeout');
    if (outcome === 'timeout' && ctxs.page && !ctxs.factsDone) {
      const page = ctxs.page;
      await withBudget(
        (async () => {
          r.title = (await page.title().catch(() => null)) || r.title;
          const facts = await page.evaluate(collectFacts, { maxEls: 4000, vpCount: 3 });
          applyFacts(r, facts);
          r.errors.push('facts collected before the page finished loading');
        })(),
        reserve - 500,
        () => null,
      ).catch(() => {});
    }
  } catch (e) {
    r.errors.push(`probe error: ${String(e.message).split('\n')[0]}`);
    r.partial = true;
    outcome = r.status && r.status < 400 ? 'ok' : 'error';
  } finally {
    for (const c of ctxs) await withBudget(c.close(), 3000, () => null).catch(() => {});
  }
  if (outcome === 'timeout') {
    r.partial = true;
    r.errors.push(`budget of ${opts.timeout} ms exhausted; partial result`);
    if (r.status == null) r.dead = true; // no response at all within the budget
  }
  if (outcome === 'dead') {
    r.dead = true;
    r.partial = true;
  }
  if (outcome === 'blocked') {
    if (opts.deep) r.errors.push('screenshots skipped: site blocks headless');
    const left = Math.max(4000, opts.timeout - (Date.now() - t0));
    const s = await probeStatic(url, left, r.errors);
    s.elapsed_ms = Date.now() - t0;
    if (opts.deep) s.screenshots = { desktop: null, mobile: null };
    return s;
  }
  if (outcome === 'error' && !r.status) {
    const left = Math.max(4000, opts.timeout - (Date.now() - t0));
    return probeStatic(url, left, r.errors);
  }
  return finalize(r, t0);
}

// ---------------------------------------------------------------- orchestration

async function launchBrowser(data) {
  if (process.env.TASTEFUL_FORCE_STATIC === '1') return { browser: null, reason: 'TASTEFUL_FORCE_STATIC=1' };
  const pw = loadPlaywright(data);
  if (!pw) return { browser: null, reason: 'playwright unavailable (run ensure-deps.sh)' };
  try {
    const browser = await withBudget(pw.chromium.launch({ headless: true }), 20000);
    return { browser };
  } catch (e) {
    return { browser: null, reason: `chromium failed to launch: ${String(e.message).split('\n')[0]}` };
  }
}

async function probeOne(browser, reason, url, opts) {
  if (opts.quick) return probeQuick(url, opts.timeout);
  if (!browser) return probeStatic(url, opts.timeout, [reason]);
  return probeBrowser(browser, url, opts);
}

function human(r) {
  const lines = [];
  const kv = (k, v) => v !== undefined && v !== null && v !== '' && lines.push(`${k.padEnd(14)} ${v}`);
  kv('url', r.url);
  kv('final_url', r.final_url);
  kv('status', r.status);
  kv('mode', r.mode + (r.partial ? ' (partial)' : ''));
  kv('elapsed_ms', r.elapsed_ms);
  kv('title', r.title);
  if (r.mode !== 'quick') {
    kv('lang', r.lang);
    kv('color_scheme', r.color_scheme);
    kv('faces', r.fonts?.faces?.join(', '));
    kv('google_fonts', r.fonts?.google_fonts);
    kv('self_hosted', r.fonts?.self_hosted);
    if (r.type?.h1) kv('h1', `${r.type.h1.size}/${r.type.h1.lineHeight} ${r.type.h1.weight} ${r.type.h1.letterSpacing}`);
    if (r.type?.body) kv('body', `${r.type.body.size}/${r.type.body.lineHeight} ${r.type.body.weight}`);
    kv('backgrounds', r.colors?.backgrounds?.map((b) => `${b.hex}${b.area_pct != null ? ` ${b.area_pct}%` : ''}`).join(' '));
    kv('texts', r.colors?.texts?.map((t) => t.hex).join(' '));
    kv('radii', Object.entries(r.radii?.histogram ?? {}).map(([k, v]) => `${k}:${v}`).join(' '));
    kv('nav.height', r.nav?.height);
    kv('container', r.container?.maxWidth);
    kv('section_gaps', r.rhythm?.section_gaps?.join(' '));
    kv('motion', r.motion && `level ${r.motion.level_guess}, durations ${r.motion.transition_durations.join('/')}ms, animated ${r.motion.animated_count}, webgl ${r.motion.webgl}`);
    if (r.screenshots) kv('screenshots', [r.screenshots.desktop, r.screenshots.mobile].filter(Boolean).join(' '));
  }
  if (r.errors?.length) kv('errors', r.errors.join(' | '));
  return lines.join('\n') + '\n';
}

async function readBatch(file) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (e) {
    fail(`cannot read --batch file: ${e.message}`);
  }
  const urls = [];
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    let u = s;
    if (s.startsWith('{')) {
      try {
        u = JSON.parse(s).url;
      } catch {
        log.warn(`skipping unparseable JSONL line: ${s.slice(0, 80)}`);
        continue;
      }
    }
    const n = normalizeUrl(u);
    if (n) urls.push(n);
    else log.warn(`skipping invalid url: ${String(u).slice(0, 80)}`);
  }
  return urls;
}

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2), spec);
  const data = dataDir(flags);
  if (flags.timeout <= 0) fail('--timeout must be > 0');
  if (flags.concurrency < 1) fail('--concurrency must be >= 1');
  if (flags.quick && flags.deep) fail('--quick and --deep are mutually exclusive');
  const opts = { quick: flags.quick, deep: flags.deep, timeout: flags.timeout, out: flags.out ? resolve(flags.out) : null };

  let urls;
  if (flags.batch) urls = await readBatch(flags.batch);
  else {
    if (!positional.url) fail(`missing required argument <url>\n\n${(await import('./lib/args.mjs')).usageText(spec)}`);
    const u = normalizeUrl(positional.url);
    if (!u) fail(`invalid url: ${positional.url}`);
    urls = [u];
  }
  if (flags.batch && opts.out && urls.length > 1) log.warn('--out with --batch: screenshots go to <out>/<host>/');

  let browser = null;
  let reason = null;
  if (!opts.quick) {
    ({ browser, reason } = await launchBrowser(data));
    if (!browser) {
      if (opts.deep) fail(`--deep requires Playwright: ${reason}`, EXIT_USAGE);
      log.warn(`${reason}; using static fallback`);
    }
  }

  // Hard watchdog: never hang past the budget (plus slack for browser shutdown).
  const perUrl = opts.quick ? Math.min(FETCH_MS, opts.timeout) + 2000 : opts.timeout + 15000;
  const watchdogMs = perUrl * Math.ceil(urls.length / (flags.batch ? flags.concurrency : 1)) + 10000;
  const watchdog = setTimeout(() => {
    log.error(`watchdog: exceeded ${watchdogMs} ms, exiting`);
    process.exit(EXIT_FAIL);
  }, watchdogMs);
  watchdog.unref();

  let anyDead = false;
  try {
    if (!flags.batch) {
      const r = await probeOne(browser, reason, urls[0], opts);
      anyDead = isDead(r);
      process.stdout.write(flags.json ? JSON.stringify(r, null, 2) + '\n' : human(r));
    } else {
      let next = 0;
      let done = 0;
      const worker = async () => {
        while (next < urls.length) {
          const u = urls[next++];
          const o = { ...opts, out: opts.out ? join(opts.out, hostOf(u)) : null };
          let r;
          try {
            r = await probeOne(browser, reason, u, o);
          } catch (e) {
            r = finalize({ ...baseResult(u, opts.quick ? 'quick' : 'browser'), partial: true, errors: [String(e.message)] }, Date.now());
          }
          if (isDead(r)) anyDead = true;
          process.stdout.write(JSON.stringify(r) + '\n');
          log.info(`[${++done}/${urls.length}] ${u} → ${r.mode} ${r.status ?? 'error'}`);
        }
      };
      await Promise.all(Array.from({ length: Math.min(flags.concurrency, urls.length) }, worker));
    }
  } finally {
    if (browser) await withBudget(browser.close(), 5000, () => null).catch(() => {});
    clearTimeout(watchdog);
  }
  process.exitCode = anyDead ? EXIT_FAIL : EXIT_OK;
}

main().catch((e) => {
  log.error(e);
  process.exit(EXIT_USAGE);
});
