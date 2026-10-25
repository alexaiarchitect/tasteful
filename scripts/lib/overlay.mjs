// tasteful — scripts/lib/overlay.mjs
//
// Site-layer ("overlay") logic shared by overlay.mjs (build) and
// contract.mjs --overlay (check). Stdlib only: imports node: modules and the
// sibling lib files, nothing else, so the sites repo can vendor it as-is.
//
//   buildOverlay(baseText, fullText, { site, slug, approval }) → { css, report }
//   compareOverlay(baseText, overlayText) → { ok, unknown_tokens, dark_missing, … }
//
// The overlay file layout (docs/SCRIPTS.md → overlay.mjs):
//   header comment → new @fontsource @import lines → unlayered :root →
//   :root[data-theme="dark"] + @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }
//   (identical) → @layer base { } → @layer components { }

import {
  parseCss,
  walkRules,
  walkDeclarations,
  themeDeclarations,
  rootDeclarations,
  darkBlocks,
  selectorClasses,
  allClasses,
  tokenPrefix,
  normSelector,
  atLabel,
  DARK_DATA_SELECTOR,
  DARK_MEDIA_SELECTOR,
} from './css.mjs';

const norm = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const isPaired = (p) => /^--(color|shadow)-/.test(p);
const isRootSel = (sel) => normSelector(sel) === ':root';
const isRootish = (sel) => String(sel).split(',').every((s) => /^:root(?![\w-])/.test(s.trim()));
const isDarkMedia = (n) => n.type === 'at' && n.name === 'media' && /prefers-color-scheme\s*:\s*dark/i.test(n.params);
const isReducedMotion = (n) => n.type === 'at' && n.name === 'media' && /prefers-reduced-motion/i.test(n.params);
const declKey = (d) => `${norm(d.value)}${d.important ? ' !important' : ''}`;

const FORBIDDEN_AT = new Set(['source', 'theme', 'apply', 'utility', 'variant', 'custom-variant', 'plugin', 'config', 'reference']);
const EXTERNAL_IMPORT = /http|\/\/|fonts\.googleapis/i;
const TAILWIND_IMPORT = /^(url\(\s*)?["']?tailwindcss["']?/i;

// ---------------------------------------------------------------------------
// helpers

/** Every custom property a theme declares on :root-ish rules (any layer) and in @theme. */
function knownTokens(nodes) {
  const out = new Set(themeDeclarations(nodes).map((d) => d.prop));
  walkRules(nodes, (node) => {
    if (node.type === 'rule' && isRootish(node.selector)) for (const d of node.declarations) if (d.prop.startsWith('--')) out.add(d.prop);
  });
  return out;
}

/** Custom properties on plain :root rules that are not dark blocks (any layer). */
function rootExtras(nodes) {
  const m = new Map();
  walkRules(nodes, (node, ancestors) => {
    if (node.type !== 'rule' || !isRootSel(node.selector) || ancestors.some(isDarkMedia)) return;
    for (const d of node.declarations) if (d.prop.startsWith('--')) m.set(d.prop, d);
  });
  return m;
}

const byProp = (decls) => {
  const m = new Map();
  for (const d of decls) m.set(d.prop, d);
  return m;
};

/**
 * Returns inline(decl, selector) → decl: every var(--x) whose --x is in `tokens` (Map prop → value)
 * is replaced by that value (nested var() resolved, up to 10 levels; a fallback is dropped).
 * The comment gets "inlined --x"; each inlining is recorded in `log`.
 */
function makeInliner(tokens, log) {
  const VAR = /var\(\s*(--[\w-]+)\s*(?:,[^()]*(?:\([^()]*\)[^()]*)*)?\)/g;
  return (d, selector) => {
    if (!tokens.size || !d.value.includes('var(')) return d;
    const used = [];
    let value = d.value;
    for (let depth = 0; depth < 10; depth++) {
      const next = value.replace(VAR, (m, name) => {
        if (!tokens.has(name)) return m;
        if (!used.includes(name)) used.push(name);
        return tokens.get(name);
      });
      if (next === value) break;
      value = next;
    }
    if (!used.length) return d;
    log.push({ selector, prop: d.prop, tokens: used });
    const note = `inlined ${used.join(', ')}`;
    const comment = d.comment ? d.comment.replace(/\s*\*\/$/, ` — ${note} */`) : `/* ${note} */`;
    return { ...d, value, comment };
  };
}

function declLine(d, indent) {
  return `${indent}${d.prop}: ${d.value}${d.important ? ' !important' : ''};${d.comment ? ' ' + d.comment : ''}`;
}

function commentLines(c, indent) {
  // Re-indent a multi-line comment so its continuation lines follow the new indent.
  const lines = c.raw.split('\n');
  if (lines.length === 1) return [indent + c.raw];
  const rest = lines.slice(1);
  const minIndent = Math.min(...rest.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)[0].length));
  return [indent + lines[0], ...rest.map((l) => (l.trim() ? indent + l.slice(minIndent).replace(/^(?=\*)/, ' ') : ''))];
}

function block(head, bodyLines, indent = '') {
  return [`${indent}${head} {`, ...bodyLines, `${indent}}`];
}

// ---------------------------------------------------------------------------
// rule diff

const ctxKey = (chain, sel) => `${chain.map(atLabel).join('|')}|${normSelector(sel)}`;

/** Rules under @layer <layer>, grouped by context key → { decls: Map(prop → Decl), nodes: [] }. */
function layerRules(nodes, layer, skip) {
  const out = new Map();
  walkRules(nodes, (node, ancestors) => {
    if (node.type !== 'rule') return;
    const li = ancestors.findIndex((a) => a.type === 'at' && a.name === 'layer' && a.params.trim() === layer);
    if (li === -1) return;
    const chain = ancestors.slice(li).filter((a) => a.type === 'at');
    if (skip(node, chain)) return;
    const key = ctxKey(chain, node.selector);
    const e = out.get(key) ?? { decls: new Map(), nodes: [] };
    for (const d of node.declarations) e.decls.set(d.prop, d);
    e.nodes.push(node);
    out.set(key, e);
  });
  return out;
}

const skipBase = (node, chain) =>
  chain.some((a) => isDarkMedia(a) || isReducedMotion(a)) ||
  /:root/.test(node.selector) ||
  selectorClasses(node.selector).some((c) => c === 'only-dark' || c === 'only-light');
const skipNone = () => false;

function sameDecls(a, b) {
  if (a.size !== b.size) return false;
  for (const [p, d] of a) if (!b.has(p) || declKey(b.get(p)) !== declKey(d)) return false;
  return true;
}

/**
 * Diff one layer. Returns { lines, changed: [label], newSelectors: [label], removed: [{selector, props}], unchanged }.
 * lines: the body of `@layer <layer> { … }` (2-space indented), or [] when nothing differs.
 */
function diffLayer(baseNodes, fullNodes, layer, skip, inline = (d) => d) {
  const base = layerRules(baseNodes, layer, skip);
  const full = layerRules(fullNodes, layer, skip);
  const emit = new Map(); // rule node → { removed: [] }
  const changed = [];
  const newSelectors = [];
  const removed = [];
  let unchanged = 0;

  const label = (key) => {
    const parts = key.split('|');
    const sel = full.get(key).nodes[0].selector;
    const wrappers = parts.slice(1, -1); // drop the @layer itself
    return wrappers.length ? `${wrappers.join(' ')} { ${sel} }` : sel;
  };

  for (const [key, f] of full) {
    const b = base.get(key);
    if (b && sameDecls(b.decls, f.decls)) {
      unchanged++;
      continue;
    }
    const gone = b ? [...b.decls.keys()].filter((p) => !f.decls.has(p)) : [];
    f.nodes.forEach((n, i) => emit.set(n, { removed: i === 0 ? gone : [] }));
    changed.push(label(key));
    if (!b) newSelectors.push(label(key));
    if (gone.length) removed.push({ selector: label(key), props: gone });
  }

  // Re-walk the full tree in source order so wrappers (@media …) and leading comments survive.
  function render(children, indent) {
    const items = [];
    for (const n of children) {
      if (n.type === 'comment') continue;
      let body = null;
      if (n.type === 'rule' && emit.has(n)) {
        const info = emit.get(n);
        const inner = indent + '  ';
        const lines = [];
        // resets first, so a reset shorthand cannot wipe the rule's own longhands
        for (const p of info.removed) lines.push(`${inner}${p}: unset; /* removed in the full theme */`);
        for (const d of n.declarations) lines.push(declLine(inline(d, n.selector), inner));
        body = block(n.selector, lines, indent);
      } else if (n.type === 'at' && n.block && n.children.length) {
        const innerItems = render(n.children, indent + '  ');
        if (innerItems.length) body = block(atLabel(n), innerItems.flat(), indent);
      }
      if (!body) continue;
      const lead = n.leading ? commentLines(n.leading, indent) : [];
      items.push([...lead, ...body]);
    }
    return items;
  }

  const layerNode = (fullNodes ?? []).filter((n) => n.type === 'at' && n.name === 'layer' && n.params.trim() === layer);
  const items = layerNode.flatMap((l) => render(l.children, '  '));
  const lines = [];
  items.forEach((it, i) => {
    if (i) lines.push('');
    lines.push(...it);
  });
  return { lines, changed, newSelectors, removed, unchanged };
}

function utilityDiff(baseNodes, fullNodes) {
  const collect = (nodes) => {
    const m = new Map();
    walkRules(nodes, (n) => {
      if (n.type === 'at' && n.name === 'utility') m.set(n.params.trim(), byProp(n.declarations));
    });
    return m;
  };
  const b = collect(baseNodes);
  const f = collect(fullNodes);
  return [...f].filter(([name, decls]) => !b.has(name) || !sameDecls(b.get(name), decls)).map(([name]) => name);
}

// ---------------------------------------------------------------------------
// build

/**
 * Derive a site layer from a base theme and a full generated theme.
 * @returns {{ css: string, report: object }}
 *   report = { tokens:{light[], dark[]}, imports[], rules:{base[], components[]}, newSelectors[],
 *              removed:[{selector, props[]}], inlined:[{selector, prop, tokens[]}], skipped:{utility[], tokens[], unchanged}, empty }
 * Throws on unparseable input.
 */
export function buildOverlay(baseText, fullText, { site, slug, approval } = {}) {
  const base = parseCss(baseText).nodes;
  const full = parseCss(fullText).nodes;
  const header =
    `/* Site layer for ${site || 'unknown'} — generated by tasteful from theme.${slug || 'unknown'}.css (approval: ${approval || 'unknown'}). ` +
    'Overrides the shared theme; token names never change. Import order in the app: "@sites/theme/styles.css", then this file, then BaseLayout. */';

  // (2) imports
  const importsOf = (nodes) => nodes.filter((n) => n.type === 'at' && n.name === 'import').map((n) => n.params.trim());
  const baseImports = new Set(importsOf(base).map((p) => p.replace(/'/g, '"')));
  const imports = importsOf(full).filter((p) => /@fontsource/.test(p) && !baseImports.has(p.replace(/'/g, '"')));

  // (3) light tokens
  const baseTheme = byProp(themeDeclarations(base));
  const fullThemeDecls = themeDeclarations(full);
  const fullTheme = byProp(fullThemeDecls);
  const skippedTokens = [];
  const light = new Map(); // prop → Decl (insertion order = output order)
  for (const d of fullTheme.values()) {
    const b = baseTheme.get(d.prop);
    if (!b) {
      skippedTokens.push(d.prop);
      continue;
    }
    if (tokenPrefix(d.prop) && norm(b.value) !== norm(d.value)) light.set(d.prop, d);
  }
  const baseExtras = rootExtras(base);
  const fullExtras = rootExtras(full);
  const extras = [];
  for (const d of fullExtras.values()) {
    if (baseTheme.has(d.prop)) continue;
    const b = baseExtras.get(d.prop);
    if (!b) skippedTokens.push(d.prop);
    else if (norm(b.value) !== norm(d.value)) extras.push(d);
  }

  // (4) dark tokens, paired both ways
  const baseDark = byProp(darkBlocks(base).dataTheme.decls);
  const fullDark = byProp(darkBlocks(full).dataTheme.decls);
  const dark = new Map();
  for (const d of fullDark.values()) {
    if (!isPaired(d.prop)) continue;
    if (!baseTheme.has(d.prop) && !baseDark.has(d.prop)) {
      if (!skippedTokens.includes(d.prop)) skippedTokens.push(d.prop);
      continue;
    }
    const b = baseDark.get(d.prop);
    if (!b || norm(b.value) !== norm(d.value)) dark.set(d.prop, d);
  }
  for (const p of light.keys()) {
    if (!isPaired(p) || dark.has(p)) continue;
    const d = fullDark.get(p) ?? baseDark.get(p) ?? light.get(p);
    dark.set(p, d);
  }
  for (const p of dark.keys()) {
    if (light.has(p)) continue;
    const d = fullTheme.get(p) ?? baseTheme.get(p);
    if (d) light.set(p, d);
  }
  // order: as in the full theme's @theme, then the full dark block
  const order = [...fullTheme.keys(), ...fullDark.keys()];
  const sortByOrder = (m) => [...m.values()].sort((a, b) => order.indexOf(a.prop) - order.indexOf(b.prop));
  const lightDecls = sortByOrder(light);
  const darkDecls = sortByOrder(dark);
  // keep dark block order identical to the full dark block
  const darkOrder = [...fullDark.keys()];
  darkDecls.sort((a, b) => {
    const ia = darkOrder.indexOf(a.prop);
    const ib = darkOrder.indexOf(b.prop);
    return (ia === -1 ? 1e6 + order.indexOf(a.prop) : ia) - (ib === -1 ? 1e6 + order.indexOf(b.prop) : ib);
  });

  // (5) (6) rules
  // tokens the full theme defines but the base lacks: inline their values where emitted rules use them
  const newTokens = new Map();
  for (const d of [...fullThemeDecls, ...rootDeclarations(full), ...fullExtras.values()]) {
    if (!baseTheme.has(d.prop) && !baseExtras.has(d.prop) && !baseDark.has(d.prop)) newTokens.set(d.prop, d.value);
  }
  const inlined = [];
  const inline = makeInliner(newTokens, inlined);
  const baseLayer = diffLayer(base, full, 'base', skipBase, inline);
  const compLayer = diffLayer(base, full, 'components', skipNone, inline);
  const utility = utilityDiff(base, full);

  const sections = [[header]];
  if (imports.length) sections.push(imports.map((p) => `@import ${p};`));
  const rootDecls = [...lightDecls, ...extras];
  const rootOut = rootDecls.map((d) => inline(d, ':root'));
  const darkOut = darkDecls.map((d) => inline(d, DARK_DATA_SELECTOR));
  if (rootOut.length) sections.push(block(':root', rootOut.map((d) => declLine(d, '  '))));
  if (darkOut.length) {
    sections.push(block(DARK_DATA_SELECTOR, darkOut.map((d) => declLine(d, '  '))));
    sections.push(block('@media (prefers-color-scheme: dark)', block(DARK_MEDIA_SELECTOR, darkOut.map((d) => declLine(d, '    ')), '  ')));
  }
  if (baseLayer.lines.length) sections.push(block('@layer base', baseLayer.lines));
  if (compLayer.lines.length) sections.push(block('@layer components', compLayer.lines));

  const empty = sections.length === 1;
  const css = sections.map((s) => s.join('\n')).join('\n\n') + '\n';
  const report = {
    tokens: { light: rootDecls.map((d) => d.prop), dark: darkDecls.map((d) => d.prop) },
    imports,
    rules: { base: baseLayer.changed, components: compLayer.changed },
    newSelectors: [...baseLayer.newSelectors, ...compLayer.newSelectors],
    removed: [...baseLayer.removed, ...compLayer.removed],
    inlined,
    skipped: { utility, tokens: skippedTokens, unchanged: baseLayer.unchanged + compLayer.unchanged },
    empty,
  };
  return { css, report };
}

// ---------------------------------------------------------------------------
// compare

/**
 * Check a site layer against its base theme.
 * ok is false for unknown_tokens, unknown_var_refs, dark_missing, dark_mismatch, forbidden, external_imports,
 * important or imports_after_rules; unknown_selectors and new_selectors are info.
 * Throws on unparseable input.
 */
export function compareOverlay(baseText, overlayText) {
  const base = parseCss(baseText).nodes;
  const ov = parseCss(overlayText).nodes;

  // 1. tokens exist in base
  const known = knownTokens(base);
  const unknown = new Set();
  walkRules(ov, (node) => {
    if (node.type === 'rule' && isRootish(node.selector)) for (const d of node.declarations) if (d.prop.startsWith('--') && !known.has(d.prop)) unknown.add(d.prop);
  });

  // 2./3. dark symmetry and agreement
  const rootSet = new Set();
  walkRules(ov, (node, ancestors) => {
    if (node.type === 'rule' && isRootSel(node.selector) && !ancestors.some(isDarkMedia)) for (const d of node.declarations) if (isPaired(d.prop)) rootSet.add(d.prop);
  });
  const { dataTheme, media } = darkBlocks(ov);
  const dt = byProp(dataTheme.decls.filter((d) => isPaired(d.prop)));
  const md = byProp(media.decls.filter((d) => isPaired(d.prop)));
  const sets = { root: rootSet, data_theme: new Set(dt.keys()), media: new Set(md.keys()) };
  const union = [...new Set([...rootSet, ...dt.keys(), ...md.keys()])];
  const dark_missing = {};
  for (const [k, s] of Object.entries(sets)) dark_missing[k] = union.filter((p) => !s.has(p));
  const dark_mismatch = [];
  for (const [p, d] of dt) if (md.has(p) && declKey(md.get(p)) !== declKey(d)) dark_mismatch.push({ prop: p, data_theme: d.value, media: md.get(p).value });

  // 4. forbidden statements, 5. imports, 6. !important
  const forbidden = [];
  const external_imports = [];
  const imports_after_rules = [];
  walkRules(ov, (node, ancestors) => {
    if (node.type !== 'at') return;
    const text = `${atLabel(node)}${node.block ? ' {' : ';'}`;
    if (FORBIDDEN_AT.has(node.name)) forbidden.push({ line: node.line, text });
    else if (node.name === 'layer' && !node.block) forbidden.push({ line: node.line, text });
    else if (node.name === 'import') {
      if (TAILWIND_IMPORT.test(node.params.trim())) forbidden.push({ line: node.line, text });
      else if (EXTERNAL_IMPORT.test(node.params)) external_imports.push(node.params);
      if (ancestors.length) imports_after_rules.push({ line: node.line, text });
    }
    if (/\btheme\(/i.test(node.params)) forbidden.push({ line: node.line, text });
  });
  let seenRule = false;
  for (const n of ov) {
    if (n.type === 'comment') continue;
    const isImport = n.type === 'at' && n.name === 'import';
    if (isImport && seenRule) imports_after_rules.push({ line: n.line, text: `${atLabel(n)};` });
    if (!isImport && !(n.type === 'at' && n.name === 'charset')) seenRule = true;
  }
  const important = [];
  const unknown_var_refs = [];
  const declared = new Set();
  walkDeclarations(ov, (d) => {
    if (d.prop.startsWith('--')) declared.add(d.prop);
  });
  walkDeclarations(ov, (d, node, ancestors) => {
    for (const m of d.value.matchAll(/var\(\s*(--[\w-]+)/g)) {
      if (!known.has(m[1]) && !declared.has(m[1])) {
        unknown_var_refs.push({ line: d.line, selector: node.type === 'rule' ? node.selector : atLabel(node), prop: d.prop, token: m[1] });
      }
    }
    if (/\btheme\(/i.test(d.value)) forbidden.push({ line: d.line, text: `${d.prop}: ${d.value}` });
    if (d.important && !ancestors.some(isReducedMotion)) important.push({ line: d.line, text: `${d.prop}: ${d.value} !important` });
  });
  forbidden.sort((a, b) => a.line - b.line);

  // 7. selectors
  const baseClasses = allClasses(base);
  const new_selectors = [];
  const unknown_selectors = [];
  const baseKeys = new Set();
  walkRules(base, (node, ancestors) => {
    if (node.type === 'rule') baseKeys.add(ctxKey(ancestors.filter((a) => a.type === 'at'), node.selector));
  });
  walkRules(ov, (node, ancestors) => {
    if (node.type !== 'rule' || isRootish(node.selector)) return;
    for (const c of selectorClasses(node.selector)) if (!baseClasses.has(c) && !new_selectors.includes('.' + c)) new_selectors.push('.' + c);
    const key = ctxKey(ancestors.filter((a) => a.type === 'at'), node.selector);
    if (!baseKeys.has(key) && !unknown_selectors.includes(node.selector)) unknown_selectors.push(node.selector);
  });

  const empty = !ov.some((n) => n.type !== 'comment');
  const ok =
    !unknown.size &&
    !unknown_var_refs.length &&
    !union.some((p) => !rootSet.has(p) || !dt.has(p) || !md.has(p)) &&
    !dark_mismatch.length &&
    !forbidden.length &&
    !external_imports.length &&
    !important.length &&
    !imports_after_rules.length;

  return {
    ok,
    unknown_tokens: [...unknown],
    dark_missing,
    dark_mismatch,
    forbidden,
    external_imports,
    important,
    imports_after_rules,
    unknown_var_refs,
    unknown_selectors,
    new_selectors,
    empty,
  };
}
