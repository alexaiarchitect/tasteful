#!/usr/bin/env node
// tasteful — scripts/preview.mjs
//
// Render a generated theme as a self-contained preview page (no external
// requests) with light and dark panels side by side, then screenshot each
// panel to preview-light.jpg / preview-dark.jpg (≤ 300 KB, 1280 px wide).
// Contract: docs/SCRIPTS.md → preview.mjs.
//
// The Tailwind 4 theme is flattened to plain CSS:
//   @theme {…}                → :root {…}
//   @layer base|components {…} → unwrapped
//   @utility x {…}            → .x {…}
//   @import / @source / @plugin / @custom-variant / @config / @apply → dropped
//   @media / @supports         → kept
// and, so both schemes render on one page, the dark selectors are scoped to
// the panels: :root[data-theme="dark"] → [data-theme="dark"],
// :root:not([data-theme="light"]) → [data-theme]:not([data-theme="light"]).

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs, fail, EXIT_OK, EXIT_FAIL, EXIT_USAGE } from './lib/args.mjs';
import { log } from './lib/log.mjs';
import { dataDir, loadPlaywright } from './lib/deps.mjs';
import { jpegUnder, withBudget } from './lib/browser.mjs';
import { parseCss } from './lib/css.mjs';

const MAX_SHOT = 300 * 1024;
const PANEL_W = 1280;

const spec = {
  usage: 'preview.mjs <theme.css> --out <dir> [--html-only]',
  description:
    'Write preview.html (self-contained: tokens and component classes inlined as plain CSS, light and dark\n' +
    'panels side by side) and screenshot each panel to preview-light.jpg / preview-dark.jpg (<= 300 KB).',
  positional: [{ name: 'theme', required: true, help: 'Generated theme.css' }],
  flags: {
    out: { type: 'string', help: 'Output directory (required)' },
    'html-only': { type: 'boolean', default: false, help: 'Write preview.html only; no Playwright needed' },
  },
};

// ---------------------------------------------------------------- CSS flattening

const DROP_AT = new Set(['import', 'source', 'plugin', 'custom-variant', 'config', 'apply', 'reference', 'tailwind', 'variant', 'charset', 'namespace']);
const EXTERNAL_URL = /url\(\s*["']?(https?:)?\/\//i;

function rewriteSelector(sel) {
  return sel
    .split(/,(?![^(]*\))/)
    .map((part) => {
      let p = part.trim();
      p = p.replace(/:root\[data-theme=(["']?)dark\1\]/g, '[data-theme="dark"]');
      p = p.replace(/:root\[data-theme=(["']?)light\1\]/g, '[data-theme="light"]');
      p = p.replace(/:root:not\(\[data-theme=(["']?)light\1\]\)/g, '[data-theme]:not([data-theme="light"])');
      p = p.replace(/:root:not\(\[data-theme=(["']?)dark\1\]\)/g, '[data-theme]:not([data-theme="dark"])');
      if (p === 'html' || p === ':root') return `${p}, [data-theme]`;
      return p;
    })
    .join(', ');
}

function declsCss(decls, indent, warnings) {
  const out = [];
  for (const d of decls ?? []) {
    if (EXTERNAL_URL.test(d.value)) {
      warnings.push(`line ${d.line}: dropped ${d.prop} with an external url()`);
      continue;
    }
    out.push(`${indent}${d.prop}: ${d.value}${d.important ? ' !important' : ''};`);
  }
  return out;
}

function nodesCss(nodes, depth, warnings, stats) {
  const ind = '  '.repeat(depth);
  const out = [];
  for (const n of nodes ?? []) {
    if (n.type === 'comment') continue;
    if (n.type === 'rule') {
      const inner = [...declsCss(n.declarations, ind + '  ', warnings), ...nodesCss(n.children, depth + 1, warnings, stats)];
      if (inner.length) out.push(`${ind}${rewriteSelector(n.selector)} {`, ...inner, `${ind}}`);
      continue;
    }
    const name = String(n.name).toLowerCase();
    if (DROP_AT.has(name)) {
      stats.dropped[name] = (stats.dropped[name] ?? 0) + 1;
      continue;
    }
    if (name === 'theme') {
      stats.theme++;
      const inner = declsCss(n.declarations, ind + '  ', warnings);
      if (inner.length) out.push(`${ind}:root, [data-theme] {`, ...inner, `${ind}}`);
      out.push(...nodesCss(n.children, depth, warnings, stats));
      continue;
    }
    if (name === 'layer') {
      if (n.children?.length || n.declarations?.length) {
        stats.layers.push(n.params || '(anonymous)');
        out.push(...nodesCss(n.children, depth, warnings, stats));
      }
      continue;
    }
    if (name === 'utility') {
      const cls = String(n.params).trim().replace(/-\*$/, '');
      if (!cls || /[^\w-]/.test(cls)) {
        warnings.push(`line ${n.line}: skipped @utility ${n.params}`);
        continue;
      }
      stats.utilities.push(cls);
      const inner = [...declsCss(n.declarations, ind + '  ', warnings), ...nodesCss(n.children, depth + 1, warnings, stats)];
      if (inner.length) out.push(`${ind}.${cls} {`, ...inner, `${ind}}`);
      continue;
    }
    if (name === 'font-face') {
      // Fonts are never fetched in the preview; the token fallback stacks render instead.
      stats.dropped['font-face'] = (stats.dropped['font-face'] ?? 0) + 1;
      continue;
    }
    // @media, @supports, @container, @keyframes, …: keep, recurse.
    const inner = [...declsCss(n.declarations, ind + '  ', warnings), ...nodesCss(n.children, depth + 1, warnings, stats)];
    if (inner.length) out.push(`${ind}@${n.name}${n.params ? ' ' + n.params : ''} {`, ...inner, `${ind}}`);
    else if (!n.children && !n.declarations?.length) warnings.push(`line ${n.line}: dropped @${n.name} statement`);
  }
  return out;
}

export function flattenTheme(text) {
  const { nodes } = parseCss(text);
  const warnings = [];
  const stats = { theme: 0, layers: [], utilities: [], dropped: {} };
  const css = nodesCss(nodes, 0, warnings, stats).join('\n');
  return { css, warnings, stats, nodes };
}

/** Collect --font-* token values from @theme for the font note. */
function fontTokens(nodes) {
  const out = {};
  for (const n of nodes) {
    if (n.type === 'at' && String(n.name).toLowerCase() === 'theme') {
      for (const d of n.declarations ?? []) if (d.prop.startsWith('--font-')) out[d.prop] = d.value;
    }
  }
  return out;
}

function colorTokens(nodes) {
  const out = [];
  for (const n of nodes) {
    if (n.type === 'at' && String(n.name).toLowerCase() === 'theme') {
      for (const d of n.declarations ?? []) if (d.prop.startsWith('--color-')) out.push(d.prop);
    }
  }
  return out;
}

// ---------------------------------------------------------------- page

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function panel(scheme, fonts, colors) {
  const label = scheme === 'light' ? 'Light' : 'Dark';
  const swatches = colors
    .map((c) => `<span class="tf-swatch" title="${esc(c)}"><i style="background: var(${esc(c)})"></i>${esc(c.replace('--color-', ''))}</span>`)
    .join('');
  const fontNote = Object.entries(fonts)
    .map(([k, v]) => `<li><code>${esc(k)}</code>: <span style="font-family: var(${esc(k)})">${esc(v)}</span></li>`)
    .join('');
  return `
  <section data-theme="${scheme}" class="tf-panel" id="panel-${scheme}" aria-label="${label} scheme">
    <div class="container-site">
      <div class="tf-scheme mono">${label} scheme</div>
      <header class="tf-hero hero-wash">
        <span class="eyebrow">Field notes · Issue 12</span>
        <h1 class="display tf-display">Calm interfaces for careful readers</h1>
        <p class="lead">A theme preview: tokens, components and long-form text rendered with plain CSS, so the palette, type and rhythm can be judged before anything ships.</p>
        <div class="tf-row">
          <a class="btn" href="#panel-${scheme}">Read the notes</a>
          <a class="btn btn-primary" href="#panel-${scheme}">Start a project</a>
          <button class="btn btn-sm" type="button">Small</button>
        </div>
        <div class="tf-row">
          <span class="chip">Default</span>
          <span class="chip chip-accent">Accent</span>
          <span class="chip chip-ok">Shipped</span>
          <span class="chip chip-warn">In review</span>
          <span class="chip chip-outline">Outline</span>
          <span class="value-pill">42 ms</span>
        </div>
      </header>

      <div class="tf-cards">
        <article class="card card-link">
          <span class="icon-tile" aria-hidden="true">✦</span>
          <h3 class="tf-card-title">Design tokens</h3>
          <p class="tf-muted">Colour, radius, shadow and easing live in one place and switch with the scheme.</p>
          <a class="stretched" href="#panel-${scheme}">Open tokens</a>
        </article>
        <article class="card card-link">
          <span class="num-badge">2</span>
          <h3 class="tf-card-title">Components</h3>
          <p class="tf-muted">Buttons, chips, cards and badges keep their roles while the look changes.</p>
          <a class="stretched" href="#panel-${scheme}">See components</a>
        </article>
        <article class="card card-link">
          <span class="icon-tile" aria-hidden="true">¶</span>
          <h3 class="tf-card-title">Long-form text</h3>
          <p class="tf-muted">Headings, lists, quotes, code and tables set for reading, not skimming.</p>
          <a class="stretched" href="#panel-${scheme}">Read a sample</a>
        </article>
      </div>

      <div class="panel tf-swatches">${swatches}</div>

      <article class="prose container-prose tf-prose">
        <h2>Why a theme needs a preview</h2>
        <p>Contrast ratios and token names can be checked by a script, but <strong>rhythm and tone</strong> need eyes. This block uses every element the <a href="#panel-${scheme}">prose styles</a> cover, including <code>inline code</code>.</p>
        <p lang="ru">Хорошая типографика незаметна: читатель видит смысл, а не шрифт.</p>
        <p lang="es">La buena tipografía pasa desapercibida: el lector ve las ideas, no la letra.</p>
        <h3>What to look at</h3>
        <ul>
          <li>Heading weight against body text</li>
          <li>Link colour on the background</li>
          <li>Card lift on hover</li>
        </ul>
        <ol>
          <li>Open the light panel</li>
          <li>Compare with the dark panel</li>
        </ol>
        <blockquote>Typography exists to honour content.</blockquote>
        <pre><code>@import "tailwindcss";
@source "../";
:root { --color-accent: oklch(0.55 0.2 265); }</code></pre>
        <table>
          <thead><tr><th>Token</th><th>Role</th><th>Minimum</th></tr></thead>
          <tbody>
            <tr><td>ink / bg</td><td>Body text</td><td>7:1</td></tr>
            <tr><td>muted / bg</td><td>Secondary text</td><td>4.5:1</td></tr>
            <tr><td>accent / bg</td><td>Links, focus</td><td>3:1</td></tr>
          </tbody>
        </table>
        <hr>
        <p class="tf-muted">Font stacks (no web fonts are loaded in the preview; the first installed family renders):</p>
        <ul class="tf-fonts">${fontNote}</ul>
      </article>
    </div>
  </section>`;
}

const PREVIEW_CSS = `
/* preview scaffolding (not part of the theme) */
html, body { margin: 0; padding: 0; }
body { display: block; min-height: 0; }
.tf-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 560px), 1fr)); }
[data-theme] { background: var(--color-bg); color: var(--color-ink); font-family: var(--font-sans); }
.tf-panel { padding-block: 2rem 3rem; min-width: 0; }
.tf-scheme { color: var(--color-muted); margin-bottom: 1.5rem; }
.tf-hero { padding-block: 1rem 2rem; }
.tf-display { font-size: clamp(2.25rem, 4vw, 3.5rem); margin: 0.75rem 0 1rem; }
.tf-row { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: center; margin-top: 1.25rem; }
.tf-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-block: 1rem 2rem; }
.tf-card-title { margin: 1rem 0 0.25rem; font-size: 1.125rem; }
.tf-muted { color: var(--color-muted); margin: 0; }
.card a.stretched { margin-top: 0.75rem; font-weight: 600; }
.tf-swatches { display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; font-size: 0.75rem; color: var(--color-muted); }
.tf-swatch { display: inline-flex; align-items: center; gap: 0.375rem; }
.tf-swatch i { width: 1rem; height: 1rem; border-radius: 0.25rem; border: 1px solid var(--color-line); display: inline-block; }
.tf-prose { margin-top: 1rem; padding-inline: 0; }
.tf-fonts { font-size: 0.875rem; }
`;

export function buildHtml(themeCss, nodes, sourceName) {
  const fonts = fontTokens(nodes);
  const colors = colorTokens(nodes);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Theme preview — ${esc(sourceName)}</title>
<style>
/* ===== theme (flattened from ${esc(sourceName)}) ===== */
${themeCss}
${PREVIEW_CSS}
</style>
</head>
<body>
<main class="tf-grid">
${panel('light', fonts, colors)}
${panel('dark', fonts, colors)}
</main>
</body>
</html>
`;
}

// ---------------------------------------------------------------- main

async function screenshots(htmlPath, html, outDir, data) {
  const pw = loadPlaywright(data);
  if (!pw) return { error: 'playwright unavailable (run ensure-deps.sh)', usage: true };
  let browser;
  try {
    browser = await withBudget(pw.chromium.launch({ headless: true }), 20000);
  } catch (e) {
    return { error: `chromium failed to launch: ${String(e.message).split('\n')[0]}`, usage: true };
  }
  const blocked = [];
  try {
    const context = await browser.newContext({ viewport: { width: PANEL_W * 2, height: 1000 }, deviceScaleFactor: 1, reducedMotion: 'reduce', colorScheme: 'light' });
    const page = await context.newPage();
    await page.route('**/*', (route) => {
      const u = route.request().url();
      if (u.startsWith('data:') || u.startsWith('about:')) return route.continue();
      blocked.push(u);
      return route.abort();
    });
    await withBudget(page.setContent(html, { waitUntil: 'load', timeout: 15000 }), 20000);
    await page.evaluate(() => document.fonts.ready).catch(() => {});
    const out = {};
    for (const scheme of ['light', 'dark']) {
      const el = await page.$(`#panel-${scheme}`);
      if (!el) throw new Error(`panel ${scheme} missing`);
      const box = await el.boundingBox();
      if (!box || box.width < 100 || box.height < 100) throw new Error(`panel ${scheme} did not render`);
      const buf = await jpegUnder(page, MAX_SHOT, { clip: { x: box.x, y: box.y, width: Math.min(box.width, PANEL_W), height: Math.min(box.height, 8000) }, fullPage: true });
      const p = join(outDir, `preview-${scheme}.jpg`);
      await writeFile(p, buf);
      if (buf.length > MAX_SHOT) log.warn(`preview-${scheme}.jpg is ${buf.length} bytes (> 300 KB at quality 40)`);
      out[scheme] = p;
    }
    if (blocked.length) log.warn(`preview tried ${blocked.length} external request(s), all blocked: ${blocked.slice(0, 3).join(', ')}`);
    return out;
  } catch (e) {
    return { error: `render failed: ${String(e.message).split('\n')[0]}` };
  } finally {
    await withBudget(browser.close(), 5000, () => null).catch(() => {});
  }
}

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2), spec);
  if (!flags.out) fail('--out <dir> is required');
  const themePath = resolve(positional.theme);
  let text;
  try {
    text = await readFile(themePath, 'utf8');
  } catch (e) {
    fail(`cannot read ${positional.theme}: ${e.message}`);
  }
  let flat;
  try {
    flat = flattenTheme(text);
  } catch (e) {
    log.error(`theme could not be parsed: ${e.message}`);
    process.exit(EXIT_FAIL);
  }
  if (!flat.stats.theme) log.warn('no @theme block found; tokens may be missing');
  for (const w of flat.warnings) log.warn(w);
  const outDir = resolve(flags.out);
  await mkdir(outDir, { recursive: true });
  const html = buildHtml(flat.css, flat.nodes, positional.theme.split('/').pop());
  const htmlPath = join(outDir, 'preview.html');
  await writeFile(htmlPath, html);
  const result = { html: htmlPath, light: null, dark: null };

  if (!flags.htmlOnly) {
    const shots = await screenshots(htmlPath, html, outDir, dataDir(flags));
    if (shots.error) {
      log.error(shots.error);
      process.stdout.write(flags.json ? JSON.stringify(result) + '\n' : `html   ${htmlPath}\n`);
      process.exit(shots.usage ? EXIT_USAGE : EXIT_FAIL);
    }
    result.light = shots.light;
    result.dark = shots.dark;
  }
  if (flags.json) process.stdout.write(JSON.stringify(result) + '\n');
  else {
    process.stdout.write(`html   ${result.html}\n`);
    if (result.light) process.stdout.write(`light  ${result.light}\ndark   ${result.dark}\n`);
  }
  process.exitCode = EXIT_OK;
}

main().catch((e) => {
  log.error(e);
  process.exit(EXIT_USAGE);
});
