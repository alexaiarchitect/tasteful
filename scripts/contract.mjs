#!/usr/bin/env node
// tasteful — scripts/contract.mjs
// Compare a candidate theme.css against the reference token/class contract. See docs/SCRIPTS.md.

import { readFileSync } from 'node:fs';
import { parseArgs, fail, EXIT_OK, EXIT_FAIL } from './lib/args.mjs';
import {
  parseCss,
  walkRules,
  walkDeclarations,
  firstStatements,
  darkBlocks,
  themeTokens as tokens,
  layerClasses,
  allClasses,
  tokenPrefix as prefixOf,
} from './lib/css.mjs';
import { compareOverlay } from './lib/overlay.mjs';

const spec = {
  usage: 'contract.mjs <reference.css> <candidate.css> [--check] [--json]\n       contract.mjs <base.css> <overlay.css> --overlay [--check] [--json]',
  description:
    'Check that a generated theme keeps the reference contract: @theme tokens, component/base classes, @utility names,\n' +
    'dark-mode coverage, the first two statements, !important only under prefers-reduced-motion, and no external @import.\n' +
    'With --overlay, check a site layer (site.css) against the base theme instead: tokens exist in the base, dark symmetry,\n' +
    'both dark blocks agree, no Tailwind-only statements, no external or late @import, !important, selectors exist in the base.',
  positional: [
    { name: 'reference', required: true, help: 'Contract source (project theme.css or fixtures/theme.reference.css)' },
    { name: 'candidate', required: true, help: 'Generated theme to compare (with --overlay: the site layer)' },
  ],
  flags: {
    check: { type: 'boolean', default: false, help: 'Exit 1 if anything is missing or any rule is broken' },
    overlay: { type: 'boolean', default: false, help: 'Candidate is a site layer (site.css) that overrides the reference' },
  },
};

export { TOKEN_PREFIXES } from './lib/css.mjs';
const EXPECTED_FIRST = ['@import "tailwindcss";', '@source "../";'];

const norm = (v) => String(v).replace(/\s+/g, ' ').trim().toLowerCase();

function load(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    fail(`cannot read ${path}: ${e.message}`);
  }
  try {
    return { text, nodes: parseCss(text).nodes };
  } catch (e) {
    fail(`cannot parse ${path}: ${e.message}`);
  }
}

function utilities(nodes) {
  const out = new Set();
  walkRules(nodes, (node) => {
    if (node.type === 'at' && node.name === 'utility') out.add(node.params.trim());
  });
  return out;
}

export function compare(ref, cand) {
  const refTokens = tokens(ref.nodes);
  const candTokens = tokens(cand.nodes);
  const missingTokens = [...refTokens.keys()].filter((t) => !candTokens.has(t));
  const addedTokens = [...candTokens.keys()].filter((t) => !refTokens.has(t));

  // Likely renames: same prefix, preferring an identical value; then 1:1 by prefix in order.
  const renamed = [];
  const free = new Set(addedTokens);
  for (const pass of ['value', 'prefix']) {
    for (const from of missingTokens) {
      if (renamed.some((r) => r.from === from)) continue;
      const p = prefixOf(from);
      const to = [...free].find((t) => prefixOf(t) === p && (pass === 'prefix' || norm(candTokens.get(t)) === norm(refTokens.get(from))));
      if (to) {
        renamed.push({ from, to });
        free.delete(to);
      }
    }
  }

  const refClasses = layerClasses(ref.nodes);
  const candAll = allClasses(cand.nodes);
  const missingClasses = [...refClasses].filter((c) => !candAll.has(c));
  const addedClasses = [...layerClasses(cand.nodes)].filter((c) => !refClasses.has(c) && !allClasses(ref.nodes).has(c));

  const refUtils = utilities(ref.nodes);
  const candUtils = utilities(cand.nodes);
  const missingUtilities = [...refUtils].filter((u) => !candUtils.has(u));

  // Dark coverage on the candidate: every --color-*/--shadow-* of the candidate's @theme
  // (tokens missing from the candidate are already reported by check 1).
  const darkTokens = [...candTokens.keys()].filter((t) => /^--(color|shadow)-/.test(t));
  const { dataTheme, media } = darkBlocks(cand.nodes);
  const dt = new Set(dataTheme.decls.map((d) => d.prop));
  const md = new Set(media.decls.map((d) => d.prop));
  const dark_missing = { data_theme: darkTokens.filter((t) => !dt.has(t)), media: darkTokens.filter((t) => !md.has(t)) };

  const first = firstStatements(cand.text, 2);
  const first_lines_ok = first.length === 2 && first.every((s, i) => s.replace(/'/g, '"') === EXPECTED_FIRST[i]);

  const important = [];
  walkDeclarations(cand.nodes, (d, _node, ancestors) => {
    if (!d.important) return;
    const reduced = ancestors.some((a) => a.type === 'at' && a.name === 'media' && /prefers-reduced-motion/i.test(a.params));
    if (!reduced) important.push({ line: d.line, text: `${d.prop}: ${d.value} !important` });
  });

  const external_imports = [];
  walkRules(cand.nodes, (node) => {
    if (node.type === 'at' && node.name === 'import' && /http|\/\/|fonts\.googleapis/i.test(node.params)) external_imports.push(node.params);
  });

  const ok =
    !missingTokens.length &&
    !missingClasses.length &&
    !missingUtilities.length &&
    !dark_missing.data_theme.length &&
    !dark_missing.media.length &&
    first_lines_ok &&
    !important.length &&
    !external_imports.length;

  return {
    ok,
    missing: { tokens: missingTokens, classes: missingClasses, utilities: missingUtilities },
    renamed,
    dark_missing,
    first_lines_ok,
    first_statements: first,
    important,
    external_imports,
    added: { tokens: addedTokens, classes: addedClasses },
    _dark_found: { data_theme: dataTheme.found, media: media.found },
  };
}

function human(r, refPath, candPath) {
  const L = [`contract: ${refPath} -> ${candPath}`, ''];
  const status = (bad) => (bad ? 'FAIL' : 'ok  ');
  const renameOf = (t) => r.renamed.find((x) => x.from === t)?.to;

  L.push(`${status(r.missing.tokens.length)} 1. @theme tokens`);
  for (const t of r.missing.tokens) {
    const to = renameOf(t);
    L.push(`       missing ${t}${to ? ` (likely renamed to ${to})` : ''}`);
  }
  L.push(`${status(r.missing.classes.length)} 2. classes from @layer components / @layer base`);
  for (const c of r.missing.classes) L.push(`       missing .${c}`);
  L.push(`${status(r.missing.utilities.length)} 3. @utility names`);
  for (const u of r.missing.utilities) L.push(`       missing @utility ${u}`);
  const dm = r.dark_missing;
  L.push(`${status(dm.data_theme.length || dm.media.length)} 4. dark coverage (--color-*, --shadow-*)`);
  if (!r._dark_found.data_theme) L.push('       no :root[data-theme="dark"] block');
  else for (const t of dm.data_theme) L.push(`       ${t} not overridden in :root[data-theme="dark"]`);
  if (!r._dark_found.media) L.push('       no @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) } block');
  else for (const t of dm.media) L.push(`       ${t} not overridden in the prefers-color-scheme fallback`);
  L.push(`${status(!r.first_lines_ok)} 5. first two statements are @import "tailwindcss"; and @source "../";`);
  if (!r.first_lines_ok) L.push(`       found: ${r.first_statements.map((s) => JSON.stringify(s)).join(', ') || '(nothing)'}`);
  L.push(`${status(r.important.length)} 6. !important only inside prefers-reduced-motion`);
  for (const i of r.important) L.push(`       line ${i.line}: ${i.text}`);
  L.push(`${status(r.external_imports.length)} 7. no external @import`);
  for (const e of r.external_imports) L.push(`       @import ${e}`);

  if (r.added.tokens.length || r.added.classes.length) {
    L.push('', 'info (additions are allowed):');
    if (r.added.tokens.length) L.push(`  added tokens: ${r.added.tokens.join(', ')}`);
    if (r.added.classes.length) L.push(`  added classes: ${r.added.classes.map((c) => '.' + c).join(', ')}`);
  }
  L.push('', r.ok ? 'ok: contract preserved' : 'FAIL: contract broken (see findings above)');
  return L.join('\n') + '\n';
}

function humanOverlay(r, basePath, ovPath) {
  const L = [`contract (overlay): ${basePath} + ${ovPath}`, ''];
  const status = (bad) => (bad ? 'FAIL' : 'ok  ');
  const dm = r.dark_missing;
  const where = { root: ':root', data_theme: ':root[data-theme="dark"]', media: 'the prefers-color-scheme fallback (:root:not([data-theme="light"]))' };
  L.push(`${status(r.unknown_tokens.length)} 1. tokens set in the layer exist in the base`);
  for (const t of r.unknown_tokens) L.push(`       ${t} is not a base token (a layer redeclares tokens, it never adds or renames them)`);
  L.push(`${status(dm.root.length || dm.data_theme.length || dm.media.length)} 2. dark symmetry (--color-*, --shadow-* set in :root and both dark selectors)`);
  for (const k of ['root', 'data_theme', 'media']) for (const t of dm[k]) L.push(`       ${t} not set in ${where[k]}`);
  L.push(`${status(r.dark_mismatch.length)} 3. both dark blocks agree`);
  for (const m of r.dark_mismatch) L.push(`       ${m.prop} is ${m.data_theme} in :root[data-theme="dark"] but ${m.media} in the prefers-color-scheme fallback`);
  L.push(`${status(r.forbidden.length)} 4. no Tailwind-only statements (@import "tailwindcss", @source, @theme, @apply, @utility, @variant, …, bare @layer, theme())`);
  for (const f of r.forbidden) L.push(`       line ${f.line}: ${f.text}`);
  L.push(`${status(r.external_imports.length || r.imports_after_rules.length)} 5. no external @import, @import before any rule`);
  for (const e of r.external_imports) L.push(`       external @import ${e}`);
  for (const e of r.imports_after_rules) L.push(`       line ${e.line}: ${e.text} comes after a rule`);
  L.push(`${status(r.important.length)} 6. !important only inside prefers-reduced-motion`);
  for (const i of r.important) L.push(`       line ${i.line}: ${i.text}`);
  L.push(`ok   7. selectors exist in the base${r.new_selectors.length || r.unknown_selectors.length ? ' (new ones listed below as info)' : ''}`);
  L.push(`${status(r.unknown_var_refs.length)} 8. var() references resolve (base tokens or declared in the layer)`);
  for (const v of r.unknown_var_refs) L.push(`       line ${v.line}: ${v.selector} { ${v.prop} } uses var(${v.token}), defined neither in the base nor in the layer`);
  if (r.new_selectors.length || r.unknown_selectors.length || r.empty) {
    L.push('', 'info:');
    if (r.empty) L.push('  comment-only layer: the site uses the shared theme unchanged');
    if (r.new_selectors.length) L.push(`  new classes (not in the base): ${r.new_selectors.join(', ')}`);
    if (r.unknown_selectors.length) L.push(`  new selectors (no base rule in the same context): ${r.unknown_selectors.join(', ')}`);
  }
  L.push('', r.ok ? 'ok: overlay valid' : 'FAIL: overlay invalid (see findings above)');
  return L.join('\n') + '\n';
}

function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2), spec);
  const ref = load(positional.reference);
  const cand = load(positional.candidate);
  if (flags.overlay) {
    const r = compareOverlay(ref.text, cand.text);
    if (flags.json) process.stdout.write(JSON.stringify(r, null, 2) + '\n');
    else process.stdout.write(humanOverlay(r, positional.reference, positional.candidate));
    process.exit(flags.check && !r.ok ? EXIT_FAIL : EXIT_OK);
  }
  const r = compare(ref, cand);
  if (flags.json) {
    const { _dark_found, first_statements, ...out } = r;
    void _dark_found;
    void first_statements;
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  } else {
    process.stdout.write(human(r, positional.reference, positional.candidate));
  }
  process.exit(flags.check && !r.ok ? EXIT_FAIL : EXIT_OK);
}

main();
