#!/usr/bin/env node
// tasteful — scripts/overlay.mjs
// Derive a per-site layer (site.css) from a base theme and a full generated theme. See docs/SCRIPTS.md.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs, fail, EXIT_OK, EXIT_FAIL, EXIT_USAGE } from './lib/args.mjs';
import { log } from './lib/log.mjs';
import { parseCss, firstStatements } from './lib/css.mjs';
import { buildOverlay, compareOverlay } from './lib/overlay.mjs';

const spec = {
  usage: 'overlay.mjs <base.css> <full.css> --out <site.css> [--site <name>] [--slug <slug>] [--approval <text>] [--allow-empty] [--json]',
  description:
    'Write a site layer: only what the full generated theme changes against the shared base theme, as plain CSS\n' +
    '(new @fontsource imports, unlayered :root tokens, both dark selectors, @layer base and @layer components rules).\n' +
    'The result is self-checked with the same rules as contract.mjs --overlay before it is written.',
  positional: [
    { name: 'base', required: true, help: 'Shared theme the app already loads (project theme.css or fixtures/theme.reference.css)' },
    { name: 'full', required: true, help: 'Full generated theme (theme.<slug>.css)' },
  ],
  flags: {
    out: { type: 'string', help: 'Where to write the site layer (required; parent directories are created)' },
    site: { type: 'string', help: 'App name under apps/, used in the header comment' },
    slug: { type: 'string', help: 'Brief slug, used in the header comment' },
    approval: { type: 'string', help: 'Approval text, used in the header comment' },
    'allow-empty': { type: 'boolean', default: false, help: 'Write a comment-only layer when nothing differs (exit 0 instead of 1)' },
  },
};

const EXPECTED_FIRST = ['@import "tailwindcss";', '@source "../";'];

function read(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch (e) {
    fail(`cannot read ${path}: ${e.message}`);
  }
}

function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2), spec);
  if (!flags.out) fail('--out <site.css> is required');
  const baseText = read(positional.base);
  const fullText = read(positional.full);
  for (const [path, text] of [
    [positional.base, baseText],
    [positional.full, fullText],
  ]) {
    try {
      parseCss(text);
    } catch (e) {
      fail(`cannot parse ${path}: ${e.message}`);
    }
  }
  const first = firstStatements(fullText, 2);
  if (!(first.length === 2 && first.every((s, i) => s.replace(/'/g, '"') === EXPECTED_FIRST[i]))) {
    fail(`${positional.full} is not a full theme: its first statements must be @import "tailwindcss"; and @source "../"; (found ${first.map((s) => JSON.stringify(s)).join(', ') || 'nothing'})`);
  }

  const { css, report } = buildOverlay(baseText, fullText, { site: flags.site, slug: flags.slug, approval: flags.approval });

  const check = compareOverlay(baseText, css);
  if (!check.ok) {
    const { ok, empty, unknown_selectors, new_selectors, ...findings } = check;
    void ok, empty, unknown_selectors, new_selectors;
    fail(`self-check of the generated layer failed (nothing written):\n${JSON.stringify(findings, null, 2)}`, EXIT_USAGE);
  }

  for (const r of report.removed) log.info(`note: ${r.selector}: ${r.props.join(', ')} reset to unset (removed in the full theme)`);
  if (report.inlined.length) log.info(`note: inlined new-token values in ${report.inlined.length} declaration(s) (${[...new Set(report.inlined.flatMap((x) => x.tokens))].join(', ')})`);
  for (const u of report.skipped.utility) log.warn(`@utility ${u} differs from the base; utilities are Tailwind-only and are not emitted`);
  for (const t of report.skipped.tokens) log.warn(`${t} is not a base token; a layer cannot add tokens, it is not emitted (any var() reference to it is inlined)`);

  if (report.empty && !flags.allowEmpty) {
    log.info('nothing differs from the base theme; no file written (use --allow-empty for a comment-only layer)');
    if (flags.json) process.stdout.write(JSON.stringify({ out: null, ...report }, null, 2) + '\n');
    process.exit(EXIT_FAIL);
  }

  try {
    mkdirSync(dirname(flags.out), { recursive: true });
    writeFileSync(flags.out, css);
  } catch (e) {
    fail(`cannot write ${flags.out}: ${e.message}`);
  }

  if (flags.json) {
    process.stdout.write(JSON.stringify({ out: flags.out, ...report }, null, 2) + '\n');
  } else {
    const L = [`overlay: ${positional.base} + ${positional.full} -> ${flags.out}`];
    const list = (a) => (a.length ? a.join(', ') : '(none)');
    L.push(`  imports:      ${list(report.imports)}`);
    L.push(`  :root:        ${report.tokens.light.length} token(s) ${report.tokens.light.length ? '(' + report.tokens.light.join(' ') + ')' : ''}`.trimEnd());
    L.push(`  dark blocks:  ${report.tokens.dark.length} token(s) each`);
    L.push(`  @layer base:  ${report.rules.base.length} rule(s) ${report.rules.base.length ? '(' + report.rules.base.join(' · ') + ')' : ''}`.trimEnd());
    L.push(`  @layer components: ${report.rules.components.length} rule(s)`);
    if (report.newSelectors.length) L.push(`  new selectors (not in base): ${report.newSelectors.join(' · ')}`);
    if (report.removed.length) L.push(`  reset to unset (removed in the full theme): ${report.removed.map((r) => `${r.selector} (${r.props.join(', ')})`).join('; ')}`);
    if (report.inlined.length) L.push(`  inlined new tokens: ${report.inlined.map((r) => `${r.selector} ${r.prop} (${r.tokens.join(', ')})`).join('; ')}`);
    if (report.skipped.utility.length) L.push(`  skipped @utility: ${report.skipped.utility.join(', ')}`);
    if (report.skipped.tokens.length) L.push(`  skipped tokens not in base: ${report.skipped.tokens.join(', ')}`);
    L.push(`  unchanged rules: ${report.skipped.unchanged}`);
    L.push('', report.empty ? 'ok: comment-only layer written (nothing differs)' : 'ok: layer written and self-check passed');
    process.stdout.write(L.join('\n') + '\n');
  }
  process.exit(EXIT_OK);
}

main();
