// tasteful — scripts/lib/color.mjs
//
// Colour parsing and WCAG 2.x contrast maths, stdlib only.
//   parseColor(str)      → {r,g,b,a} (r/g/b 0–255 ints, a 0–1) or null
//   toHex({r,g,b})       → '#rrggbb'
//   luminance(rgb)       → WCAG relative luminance
//   contrastRatio(a, b)  → ratio rounded to 2 decimals
//   toOklch / fromOklch  → OKLCH conversion (fromOklch is gamut-clipped)
//   nearestPassing(fg, bg, min, {adjust}) → {hex, ratio} | null

const NAMED = {
  black: '#000000',
  white: '#ffffff',
  transparent: '#00000000',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  gray: '#808080',
  grey: '#808080',
};

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const to255 = (x) => clamp(Math.round(x), 0, 255);

function num(tok, pctScale) {
  const t = String(tok).trim();
  if (t.endsWith('%')) {
    const v = Number(t.slice(0, -1));
    return Number.isFinite(v) ? (v / 100) * pctScale : NaN;
  }
  return Number(t);
}

function hue(tok) {
  const m = /^(-?[\d.]+(?:e-?\d+)?)(deg|rad|grad|turn)?$/i.exec(String(tok).trim());
  if (!m) return NaN;
  const v = Number(m[1]);
  switch ((m[2] || 'deg').toLowerCase()) {
    case 'rad':
      return (v * 180) / Math.PI;
    case 'grad':
      return v * 0.9;
    case 'turn':
      return v * 360;
    default:
      return v;
  }
}

function alpha(tok) {
  if (tok === undefined) return 1;
  const v = num(tok, 1);
  return Number.isFinite(v) ? clamp(v, 0, 1) : NaN;
}

// Split "a b c / d" or "a, b, c, d" into [a,b,c,d?]
function args(inner) {
  const s = inner.trim();
  let parts;
  let a;
  if (s.includes(',')) {
    parts = s.split(',').map((x) => x.trim());
    if (parts.length === 4) a = parts.pop();
  } else {
    const [main, al] = s.split('/');
    parts = main.trim().split(/\s+/);
    a = al?.trim();
    if (al !== undefined && !a) return null;
  }
  if (parts.length !== 3 || parts.some((p) => p === '' || p === 'none')) return null;
  return { parts, a };
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const k = (n) => (n + h / 30) % 12;
  const f = (n) => l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/** Parse a CSS colour. Returns null for var(), color-mix(), keywords other than a small set, or anything invalid. */
export function parseColor(str) {
  if (typeof str !== 'string') return null;
  const s = str.trim().toLowerCase();
  if (NAMED[s]) return parseColor(NAMED[s]);
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const a = h.length === 8 ? Math.round((parseInt(h.slice(6, 8), 16) / 255) * 1000) / 1000 : 1;
    return { r, g, b, a };
  }
  m = /^(rgba?|hsla?|oklch)\(([^()]*)\)$/.exec(s);
  if (!m) return null;
  const p = args(m[2]);
  if (!p) return null;
  const a = alpha(p.a);
  if (Number.isNaN(a)) return null;
  if (m[1].startsWith('rgb')) {
    const v = p.parts.map((x) => num(x, 255));
    if (v.some((x) => !Number.isFinite(x))) return null;
    return { r: to255(v[0]), g: to255(v[1]), b: to255(v[2]), a };
  }
  if (m[1].startsWith('hsl')) {
    const h = hue(p.parts[0]);
    const sat = num(p.parts[1].endsWith('%') ? p.parts[1] : `${p.parts[1]}%`, 1);
    const lig = num(p.parts[2].endsWith('%') ? p.parts[2] : `${p.parts[2]}%`, 1);
    if (![h, sat, lig].every(Number.isFinite)) return null;
    const [r, g, b] = hslToRgb(h, clamp(sat, 0, 1), clamp(lig, 0, 1));
    return { r: to255(r), g: to255(g), b: to255(b), a };
  }
  // oklch(L C H)
  const l = num(p.parts[0], 1);
  const c = num(p.parts[1], 0.4);
  const h = hue(p.parts[2]);
  if (![l, c, h].every(Number.isFinite)) return null;
  return { ...fromOklch({ l, c, h }), a };
}

/** '#rrggbb' (lowercase). */
export function toHex({ r, g, b }) {
  return '#' + [r, g, b].map((x) => to255(x).toString(16).padStart(2, '0')).join('');
}

const lin = (c) => {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};
const unlin = (x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055) * 255;

function asRgb(c) {
  if (typeof c === 'string') {
    const p = parseColor(c);
    if (!p) throw new Error(`not a colour: ${c}`);
    return p;
  }
  return c;
}

/** WCAG 2.x relative luminance. */
export function luminance(rgb) {
  const { r, g, b } = asRgb(rgb);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Unrounded contrast ratio (use this for pass/fail decisions). */
export function rawContrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Contrast ratio rounded to 2 decimals. */
export function contrastRatio(a, b) {
  return Math.round(rawContrast(a, b) * 100) / 100;
}

/** sRGB → OKLCH ({l 0–1, c, h degrees}). */
export function toOklch(rgb) {
  const { r, g, b } = asRgb(rgb);
  const R = lin(r);
  const G = lin(g);
  const B = lin(b);
  const l_ = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m_ = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s_ = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const Bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const c = Math.hypot(A, Bb);
  let h = (Math.atan2(Bb, A) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c, h: c < 1e-6 ? 0 : h };
}

function oklchToLinear({ l, c, h }) {
  const hr = (h * Math.PI) / 180;
  const A = c * Math.cos(hr);
  const B = c * Math.sin(hr);
  const l_ = (l + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m_ = (l - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s_ = (l - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

const inGamut = (rgb) => rgb.every((x) => x >= -1e-4 && x <= 1 + 1e-4);

/** OKLCH → sRGB {r,g,b} 0–255. Out-of-gamut colours keep L and H and lose chroma until they fit. */
export function fromOklch({ l, c, h }) {
  l = clamp(l, 0, 1);
  c = Math.max(0, c);
  let linRgb = oklchToLinear({ l, c, h });
  if (!inGamut(linRgb)) {
    let lo = 0;
    let hi = c;
    for (let k = 0; k < 30; k++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear({ l, c: mid, h }))) lo = mid;
      else hi = mid;
    }
    linRgb = oklchToLinear({ l, c: lo, h });
  }
  const [r, g, b] = linRgb.map((x) => to255(unlin(clamp(x, 0, 1))));
  return { r, g, b };
}

/**
 * Nearest colour (same OKLCH hue/chroma, adjusted lightness) of `fg` (or `bg`
 * with adjust:'bg') that reaches `min` against the other colour.
 * Returns {hex, ratio} or null when no lightness reaches it.
 */
export function nearestPassing(fg, bg, min, { adjust = 'fg' } = {}) {
  const f = asRgb(fg);
  const b = asRgb(bg);
  const moving = adjust === 'bg' ? b : f;
  const fixed = adjust === 'bg' ? f : b;
  if (rawContrast(moving, fixed) >= min) return { hex: toHex(moving), ratio: contrastRatio(moving, fixed) };
  const base = toOklch(moving);
  const at = (l) => fromOklch({ l, c: base.c, h: base.h });
  const passes = (l) => rawContrast(at(l), fixed) >= min;
  const options = [];
  for (const target of [0, 1]) {
    if (!passes(target)) continue;
    // binary search between base.l (fails) and target (passes)
    let lo = base.l;
    let hi = target;
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      if (passes(mid)) hi = mid;
      else lo = mid;
    }
    const rgb = at(hi);
    options.push({ dist: Math.abs(hi - base.l), rgb });
  }
  if (!options.length) return null;
  options.sort((x, y) => x.dist - y.dist);
  const best = options[0].rgb;
  return { hex: toHex(best), ratio: contrastRatio(best, fixed) };
}
