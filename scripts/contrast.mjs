#!/usr/bin/env node
// tasteful — scripts/contrast.mjs
// WCAG 2.x contrast check of a theme.css in both schemes. See docs/SCRIPTS.md.

import { readFileSync } from 'node:fs';
import { parseArgs, fail, EXIT_OK, EXIT_FAIL } from './lib/args.mjs';
import { log } from './lib/log.mjs';
import { parseCss, themeDeclarations, darkBlocks, declMap, rootDeclarations } from './lib/css.mjs';
import { parseColor, toHex, contrastRatio, rawContrast, nearestPassing } from './lib/color.mjs';

const spec = {
  usage: 'contrast.mjs <theme.css> [--overlay <site.css>] [--extended] [--suggest] [--json]',
  description:
    'Compute WCAG 2.x contrast for the required token pairs in the light (@theme) and dark (:root[data-theme="dark"]) schemes,\n' +
    'and check that the prefers-color-scheme fallback block declares the same dark values.\n' +
    'With --overlay, check the theme with a site layer applied: light = @theme + the layer\'s :root, dark = light + the\n' +
    'base dark block + the layer\'s dark block (the layer wins); the dark-block agreement check runs on the layer.',
  positional: [{ name: 'theme', required: true, help: 'Theme file to check' }],
  flags: {
    extended: { type: 'boolean', default: false, help: 'Also report advisory pairs (never affect the exit code)' },
    suggest: { type: 'boolean', default: false, help: 'For each failing pair, print the nearest passing colour (same hue, adjusted lightness)' },
    overlay: { type: 'string', help: 'Site layer (site.css) applied on top of <theme.css>' },
  },
};

export const REQUIRED_PAIRS = [
  ['--color-ink', '--color-bg', 7],
  ['--color-muted', '--color-bg', 4.5],
  ['--color-accent-ink', '--color-accent', 4.5],
  ['--color-accent', '--color-bg', 3],
];
export const ADVISORY_PAIRS = [
  ['--color-ink', '--color-panel', 7],
  ['--color-muted', '--color-panel', 4.5],
  ['--color-ok', '--color-ok-soft', 4.5],
  ['--color-bad', '--color-bad-soft', 4.5],
  ['--color-warn', '--color-warn-soft', 4.5],
  ['--color-accent', '--color-panel', 3],
];

function resolve(map, value, depth = 0) {
  if (depth > 10 || value === undefined) return undefined;
  const m = /^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]+))?\)$/.exec(value.trim());
  if (!m) return value;
  const next = map.get(m[1]);
  if (next !== undefined) return resolve(map, next, depth + 1);
  return m[2] !== undefined ? resolve(map, m[2], depth + 1) : undefined;
}

const short = (t) => t.replace(/^--color-/, '');

function load(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    fail(`cannot read ${file}: ${e.message}`);
  }
  try {
    return parseCss(text).nodes;
  } catch (e) {
    fail(`cannot parse ${file}: ${e.message}`);
  }
}

function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2), spec);
  const file = positional.theme;
  const nodes = load(file);
  const overlay = flags.overlay;
  const ovNodes = overlay ? load(overlay) : null;

  const errors = [];
  let light = declMap(themeDeclarations(nodes));
  const base = darkBlocks(nodes);
  let { dataTheme, media } = base;
  let dark = new Map([...light, ...declMap(dataTheme.decls)]);
  let checkBlocks = true;
  if (ovNodes) {
    // light = base @theme ∪ layer :root; dark = light ∪ base dark ∪ layer dark (later wins)
    light = new Map([...light, ...declMap(rootDeclarations(ovNodes))]);
    const ov = darkBlocks(ovNodes);
    dark = new Map([...light, ...declMap(base.dataTheme.decls), ...declMap(ov.dataTheme.decls)]);
    ({ dataTheme, media } = ov);
    if (dataTheme.found !== media.found) {
      errors.push(
        dataTheme.found
          ? `${overlay}: the layer sets :root[data-theme="dark"] but has no @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) } block`
          : `${overlay}: the layer sets the prefers-color-scheme dark fallback but has no :root[data-theme="dark"] block`,
      );
    }
    checkBlocks = false; // a layer without dark blocks keeps the base's dark scheme
  }

  if (checkBlocks && !dataTheme.found) errors.push('dark block :root[data-theme="dark"] not found');
  if (checkBlocks && !media.found) errors.push('dark fallback @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) } not found');
  if (dataTheme.found && media.found) {
    const a = declMap(dataTheme.decls.filter((d) => d.prop !== 'color-scheme'));
    const b = declMap(media.decls.filter((d) => d.prop !== 'color-scheme'));
    for (const [k, v] of a) {
      if (!b.has(k)) errors.push(`dark mismatch: ${k} is set in :root[data-theme="dark"] but not in the prefers-color-scheme fallback`);
      else if (b.get(k).toLowerCase() !== v.toLowerCase()) errors.push(`dark mismatch: ${k} is ${v} in :root[data-theme="dark"] but ${b.get(k)} in the prefers-color-scheme fallback`);
    }
    for (const k of b.keys()) {
      if (!a.has(k)) errors.push(`dark mismatch: ${k} is set in the prefers-color-scheme fallback but not in :root[data-theme="dark"]`);
    }
  }

  const required = new Set(REQUIRED_PAIRS.flat().filter((x) => typeof x === 'string'));
  const missing = [...required].filter((t) => !light.has(t));
  if (missing.length) fail(`${file}: required token(s) missing from @theme: ${missing.join(', ')}`);

  const schemes = [
    ['light', light],
    ['dark', dark],
  ];
  const pairs = [];
  const list = [...REQUIRED_PAIRS.map((p) => [...p, true]), ...(flags.extended ? ADVISORY_PAIRS.map((p) => [...p, false]) : [])];
  for (const [scheme, map] of schemes) {
    for (const [fg, bg, min, isRequired] of list) {
      const fv = resolve(map, map.get(fg));
      const bv = resolve(map, map.get(bg));
      if (fv === undefined || bv === undefined) {
        if (isRequired) fail(`${file}: ${scheme}: cannot resolve ${fv === undefined ? fg : bg}`);
        log.warn(`${scheme}: skipping advisory pair ${fg}/${bg} (token missing)`);
        continue;
      }
      const fc = parseColor(fv);
      const bc = parseColor(bv);
      if (!fc || !bc) {
        const what = !fc ? `${fg}: ${fv}` : `${bg}: ${bv}`;
        if (isRequired) fail(`${file}: ${scheme}: cannot compute a colour from ${what}`);
        log.warn(`${scheme}: skipping advisory pair ${fg}/${bg} (cannot parse ${what})`);
        continue;
      }
      if ((fc.a ?? 1) < 1 || (bc.a ?? 1) < 1) log.warn(`${scheme}: ${fg}/${bg} uses a translucent colour; alpha is ignored`);
      const pass = rawContrast(fc, bc) >= min;
      const row = { scheme, fg, bg, fg_hex: toHex(fc), bg_hex: toHex(bc), ratio: contrastRatio(fc, bc), min, pass, required: isRequired };
      if (!pass && flags.suggest) row.suggest = nearestPassing(fc, bc, min, { adjust: 'fg' });
      pairs.push(row);
    }
  }

  const ok = errors.length === 0 && pairs.every((p) => p.pass || !p.required);

  if (flags.json) {
    process.stdout.write(JSON.stringify({ file, ...(overlay ? { overlay } : {}), ok, pairs, errors }, null, 2) + '\n');
  } else {
    const rows = [['scheme', 'pair', 'ratio', 'min', 'pass']];
    for (const p of pairs) {
      rows.push([
        p.scheme,
        `${short(p.fg)} / ${short(p.bg)}${p.required ? '' : ' (advisory)'}`,
        p.ratio.toFixed(2),
        `${p.min}:1`,
        p.pass ? 'yes' : 'NO',
      ]);
    }
    const w = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
    const out = rows.map((r) => r.map((c, i) => c.padEnd(w[i])).join(' | ').trimEnd());
    out.splice(1, 0, w.map((n) => '-'.repeat(n)).join('-|-'));
    const lines = [`contrast: ${file}${overlay ? ` + ${overlay}` : ''}`, ...out];
    if (flags.suggest) {
      const failing = pairs.filter((p) => !p.pass);
      if (failing.length) lines.push('', 'suggestions (foreground adjusted, same hue):');
      for (const p of failing) {
        lines.push(
          p.suggest
            ? `  ${p.scheme}: ${p.fg} ${p.fg_hex} -> ${p.suggest.hex} (${p.suggest.ratio.toFixed(2)}:1 on ${p.bg} ${p.bg_hex})`
            : `  ${p.scheme}: ${p.fg} on ${p.bg}: no lightness of this hue reaches ${p.min}:1`,
        );
      }
    }
    if (errors.length) lines.push('', 'errors:', ...errors.map((e) => `  ${e}`));
    const failed = pairs.filter((p) => p.required && !p.pass);
    lines.push(
      '',
      ok
        ? 'ok: all required pairs pass in both schemes and the dark blocks agree'
        : `FAIL: ${failed.length} required pair(s) below minimum${failed.length ? ` (${failed.map((p) => `${p.scheme} ${short(p.fg)}/${short(p.bg)}`).join(', ')})` : ''}, ${errors.length} error(s)`,
    );
    process.stdout.write(lines.join('\n') + '\n');
  }
  process.exit(ok ? EXIT_OK : EXIT_FAIL);
}

main();
