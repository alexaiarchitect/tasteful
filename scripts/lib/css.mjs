// tasteful — scripts/lib/css.mjs
//
// Small, dependency-free CSS tokenizer/parser that is good enough for theme
// files: nested at-rules (@layer, @media, @supports, @theme, @utility),
// strings containing ; { }, url(...), !important, multi-line values and
// comments anywhere. It is not a full CSS parser (no error recovery for
// broken input: unbalanced braces or unterminated strings/comments throw).
//
// Shapes:
//   Node = { type:'rule', selector, declarations, children, line, leading? }
//        | { type:'at', name, params, block, declarations, children, line, leading? }
//        | { type:'comment', text, raw, line, endLine, trailing? }
//   Decl = { prop, value, important, line, comment? }
// Values and preludes have comments removed and whitespace collapsed.
//   * Decl.comment: the raw text ('/* … */') of a comment that starts on the
//     same line right after the declaration's ';'. That comment is still also
//     listed in children, flagged trailing: true.
//   * leading: the comment node right before a rule/at node at the same level,
//     ending on the line before it (or the same line); no blank line between.
//   * at.block: true for '@x … { }', false for a ';'-terminated statement.

function collapse(s) {
  return s.replace(/\s+/g, ' ').trim();
}

/** Parse CSS text into a tree. Throws Error('line N: …') on unbalanced input. */
export function parseCss(text) {
  const src = String(text ?? '');
  let i = 0;
  let line = 1;
  const n = src.length;

  function err(msg, at = line) {
    const e = new Error(`line ${at}: ${msg}`);
    e.line = at;
    return e;
  }

  // Parse until '}' (when nested) or EOF (top level).
  function parseBlock(nested, openLine) {
    const declarations = [];
    const children = [];
    let buf = '';
    let bufLine = null;
    let parens = 0;

    let trailingAt = -1;
    const withLeading = (node) => {
      const prev = children[children.length - 1];
      if (prev?.type === 'comment' && !prev.trailing && prev.endLine >= node.line - 1) node.leading = prev;
      return node;
    };
    const flushDecl = () => {
      const t = collapse(buf);
      let made = null;
      if (t) {
        if (t.startsWith('@')) children.push(withLeading(atNode(t, bufLine, false)));
        else {
          const d = makeDecl(t, bufLine);
          if (d) declarations.push((made = d));
          else throw err(`cannot parse declaration "${t.slice(0, 60)}"`, bufLine);
        }
      }
      buf = '';
      bufLine = null;
      return made;
    };

    while (i < n) {
      const ch = src[i];
      // comments
      if (ch === '/' && src[i + 1] === '*') {
        const start = i;
        const startLine = line;
        const end = src.indexOf('*/', i + 2);
        if (end === -1) throw err('unterminated comment', startLine);
        const body = src.slice(start + 2, end);
        for (const c of body) if (c === '\n') line++;
        i = end + 2;
        if (!buf.trim()) {
          const c = { type: 'comment', text: body.trim(), raw: src.slice(start, end + 2), line: startLine, endLine: line };
          if (start === trailingAt) {
            c.trailing = true;
            declarations[declarations.length - 1].comment = c.raw;
          }
          children.push(c);
        } else buf += ' ';
        continue;
      }
      // strings
      if (ch === '"' || ch === "'") {
        if (bufLine === null) bufLine = line;
        let j = i + 1;
        while (j < n && src[j] !== ch) {
          if (src[j] === '\\') j++;
          else if (src[j] === '\n') throw err('unterminated string', line);
          j++;
        }
        if (j >= n) throw err('unterminated string', line);
        buf += src.slice(i, j + 1);
        i = j + 1;
        continue;
      }
      if (ch === '\n') line++;
      if (ch === '(') parens++;
      else if (ch === ')') parens = Math.max(0, parens - 1);
      if (parens === 0 && ch === ';') {
        const d = flushDecl();
        i++;
        if (d) {
          let j = i;
          while (src[j] === ' ' || src[j] === '\t') j++;
          if (src[j] === '/' && src[j + 1] === '*') trailingAt = j;
        }
        continue;
      }
      if (parens === 0 && ch === '{') {
        const prelude = collapse(buf);
        const pl = bufLine ?? line;
        buf = '';
        bufLine = null;
        i++;
        const inner = parseBlock(true, pl);
        let node;
        if (prelude.startsWith('@')) node = atNode(prelude, pl, true);
        else node = { type: 'rule', selector: prelude, declarations: [], children: [], line: pl };
        node.declarations = inner.declarations;
        node.children = inner.children;
        children.push(withLeading(node));
        continue;
      }
      if (parens === 0 && ch === '}') {
        if (!nested) throw err('unexpected "}"');
        flushDecl();
        i++;
        return { declarations, children };
      }
      if (bufLine === null && !/\s/.test(ch)) bufLine = line;
      buf += ch;
      i++;
    }
    if (nested) throw err('unclosed "{"', openLine);
    flushDecl();
    return { declarations, children };
  }

  const { declarations, children } = parseBlock(false, 1);
  if (declarations.length) {
    throw err(`declaration outside any block: "${declarations[0].prop}"`, declarations[0].line);
  }
  return { nodes: children };
}

function atNode(prelude, line, hasBlock) {
  const m = /^@([\w-]+)\s*([\s\S]*)$/.exec(prelude);
  return { type: 'at', name: m ? m[1].toLowerCase() : '', params: m ? m[2].trim() : '', block: hasBlock, declarations: [], children: [], line };
}

function makeDecl(text, line) {
  const idx = text.indexOf(':');
  if (idx <= 0) return null;
  const prop = text.slice(0, idx).trim();
  let value = text.slice(idx + 1).trim();
  let important = false;
  const m = /!\s*important\s*$/i.exec(value);
  if (m) {
    important = true;
    value = value.slice(0, m.index).trim();
  }
  return { prop: prop.startsWith('--') ? prop : prop.toLowerCase(), value, important, line };
}

/** fn(node, ancestors[]) for every rule/at node, depth-first (pre-order). */
export function walkRules(nodes, fn, ancestors = []) {
  for (const node of nodes ?? []) {
    if (node.type === 'comment') continue;
    fn(node, ancestors);
    if (node.children?.length) walkRules(node.children, fn, [...ancestors, node]);
  }
}

/** fn(decl, node, ancestors[]) for every declaration in the tree. */
export function walkDeclarations(nodes, fn) {
  walkRules(nodes, (node, ancestors) => {
    for (const d of node.declarations ?? []) fn(d, node, ancestors);
  });
}

/** Replace comments with spaces, keeping newlines (so line numbers stay put). */
export function stripComments(text) {
  const src = String(text ?? '');
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== ch && src[j] !== '\n') {
        if (src[j] === '\\') j++;
        j++;
      }
      out += src.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * First n top-level statements, ignoring comments and blank lines.
 * A ";"-terminated statement is returned whole ('@import "tailwindcss";');
 * a block statement is returned as its prelude plus " {" ('@theme {').
 */
export function firstStatements(text, n) {
  const src = stripComments(text);
  const out = [];
  let buf = '';
  let parens = 0;
  let depth = 0;
  for (let i = 0; i < src.length && out.length < n; i++) {
    const ch = src[i];
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== ch) {
        if (src[j] === '\\') j++;
        j++;
      }
      if (depth === 0) buf += src.slice(i, j + 1);
      i = j;
      continue;
    }
    if (depth > 0) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      continue;
    }
    if (ch === '(') parens++;
    else if (ch === ')') parens = Math.max(0, parens - 1);
    if (parens === 0 && ch === ';') {
      const t = collapse(buf);
      if (t) out.push(`${t};`);
      buf = '';
      continue;
    }
    if (parens === 0 && ch === '{') {
      out.push(`${collapse(buf)} {`);
      buf = '';
      depth = 1;
      continue;
    }
    buf += ch;
  }
  if (out.length < n && collapse(buf)) out.push(collapse(buf));
  return out;
}

/** Class names referenced in a selector list, deduped, in order of appearance. */
export function selectorClasses(selector) {
  const s = String(selector ?? '')
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""')
    .replace(/\[[^\]]*\]/g, '');
  const seen = new Set();
  const re = /\.((?:-?[_a-zA-Z]|\\.|[^\x00-\x7f])(?:[\w-]|\\.|[^\x00-\x7f])*)/g;
  let m;
  while ((m = re.exec(s))) {
    // skip numbers like "1.5" that can appear inside :nth-child() etc.
    const prev = s[m.index - 1];
    if (prev && /[0-9]/.test(prev)) continue;
    seen.add(m[1].replace(/\\(.)/g, '$1'));
  }
  return [...seen];
}

// ---------------------------------------------------------------------------
// Theme-contract helpers (used by contrast.mjs and contract.mjs).

const normSel = (s) => s.replace(/\s+/g, '').replace(/'/g, '"');
/** Selector normalised for comparison: whitespace removed, single quotes → double. */
export const normSelector = (s) => normSel(String(s ?? ''));
export const DARK_DATA_SELECTOR = ':root[data-theme="dark"]';
export const DARK_MEDIA_SELECTOR = ':root:not([data-theme="light"])';

/** Declarations of every @theme block, in order (later wins in maps). */
export function themeDeclarations(nodes) {
  const out = [];
  walkRules(nodes, (node) => {
    if (node.type === 'at' && node.name === 'theme') out.push(...node.declarations);
  });
  return out;
}

const isDarkMedia = (n) => n.type === 'at' && n.name === 'media' && /prefers-color-scheme\s*:\s*dark/i.test(n.params);

/**
 * The two dark blocks:
 *   dataTheme — rules whose selector list contains :root[data-theme="dark"] (not inside a dark media query)
 *   media     — rules :root:not([data-theme="light"]) inside @media (prefers-color-scheme: dark)
 * Each is { found: boolean, decls: Decl[], line }.
 */
export function darkBlocks(nodes) {
  const dataTheme = { found: false, decls: [], line: null };
  const media = { found: false, decls: [], line: null };
  walkRules(nodes, (node, ancestors) => {
    if (node.type !== 'rule') return;
    const parts = node.selector.split(',').map(normSel);
    const inDarkMedia = ancestors.some(isDarkMedia);
    if (!inDarkMedia && parts.includes(normSel(DARK_DATA_SELECTOR))) {
      dataTheme.found = true;
      dataTheme.line ??= node.line;
      dataTheme.decls.push(...node.declarations);
    }
    if (inDarkMedia && parts.includes(normSel(DARK_MEDIA_SELECTOR))) {
      media.found = true;
      media.line ??= node.line;
      media.decls.push(...node.declarations);
    }
  });
  return { dataTheme, media };
}

/** Decl[] → Map(prop → value), later declarations win. */
export function declMap(decls) {
  const m = new Map();
  for (const d of decls) m.set(d.prop, d.value);
  return m;
}

export const TOKEN_PREFIXES = ['--font-', '--color-', '--radius-', '--shadow-', '--ease-'];
/** The TOKEN_PREFIXES entry a custom property starts with, or null. */
export const tokenPrefix = (t) => TOKEN_PREFIXES.find((p) => t.startsWith(p)) ?? null;

/** Map(prop → value) of the contract tokens (TOKEN_PREFIXES) declared in @theme. */
export function themeTokens(nodes) {
  const m = new Map();
  for (const d of themeDeclarations(nodes)) if (tokenPrefix(d.prop)) m.set(d.prop, d.value);
  return m;
}

const inContractLayer = (ancestors) =>
  ancestors.some((a) => a.type === 'at' && a.name === 'layer' && /^(components|base)$/.test(a.params.trim()));

/** Class names used by rules inside @layer components / @layer base. */
export function layerClasses(nodes) {
  const out = new Set();
  walkRules(nodes, (node, ancestors) => {
    if (node.type === 'rule' && inContractLayer(ancestors)) for (const c of selectorClasses(node.selector)) out.add(c);
  });
  return out;
}

/** Class names used by any rule, anywhere. */
export function allClasses(nodes) {
  const out = new Set();
  walkRules(nodes, (node) => {
    if (node.type === 'rule') for (const c of selectorClasses(node.selector)) out.add(c);
  });
  return out;
}

/** Declarations of unlayered top-level rules whose selector is exactly :root (no at-rule ancestor). */
export function rootDeclarations(nodes) {
  const out = [];
  for (const n of nodes ?? []) if (n.type === 'rule' && normSel(n.selector) === ':root') out.push(...n.declarations);
  return out;
}

/** "@name params" of an at node, whitespace collapsed. */
export const atLabel = (n) => `@${n.name}${n.params ? ' ' + n.params.replace(/\s+/g, ' ').trim() : ''}`;

/**
 * Map(`<at-rule chain>|<normalised selector>` → rule node) for every rule, e.g.
 * '@layer components|@media (min-width: 640px)|.card'. A top-level rule's key is
 * '|<selector>'. When a key repeats, the last rule wins.
 */
export function rulesByContext(nodes) {
  const m = new Map();
  walkRules(nodes, (node, ancestors) => {
    if (node.type !== 'rule') return;
    const chain = ancestors.filter((a) => a.type === 'at').map(atLabel).join('|');
    m.set(`${chain}|${normSel(node.selector)}`, node);
  });
  return m;
}
