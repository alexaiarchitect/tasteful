// tasteful — scripts/lib/schema.mjs
//
// Stdlib-only validator for the JSON Schema (draft 2020-12) subset used by
// index/schema.json:
//   type (string or array, incl. "null" and "integer"), enum, const,
//   required, properties, additionalProperties (boolean), items,
//   minItems, maxItems, uniqueItems, minimum, maximum, minLength,
//   maxLength, pattern, format (date | uri | hex-color), $defs, local $ref
//   (#/$defs/name), oneOf, anyOf.
// Annotation keywords ($schema, $id, $comment, title, description,
// examples, default) are accepted and ignored. Any other keyword makes
// loadSchema() throw, so nobody adds an unsupported keyword silently.

import { readFileSync } from 'node:fs';

export const SUPPORTED_KEYWORDS = new Set([
  'type', 'enum', 'const', 'required', 'properties', 'additionalProperties', 'items',
  'minItems', 'maxItems', 'uniqueItems', 'minimum', 'maximum', 'minLength', 'maxLength',
  'pattern', 'format', '$defs', '$ref', 'oneOf', 'anyOf',
]);
export const ANNOTATION_KEYWORDS = new Set(['$schema', '$id', '$comment', 'title', 'description', 'examples', 'default']);
export const SUPPORTED_FORMATS = new Set(['date', 'uri', 'hex-color']);

/** Every keyword used anywhere in a schema (walks subschemas properly). */
export function schemaKeywords(schema) {
  const found = new Set();
  const visit = (s) => {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return;
    for (const [k, v] of Object.entries(s)) {
      found.add(k);
      if (k === 'properties' || k === '$defs') for (const sub of Object.values(v ?? {})) visit(sub);
      else if (k === 'items' || (k === 'additionalProperties' && typeof v === 'object')) visit(v);
      else if (k === 'oneOf' || k === 'anyOf') for (const sub of v ?? []) visit(sub);
    }
  };
  visit(schema);
  return found;
}

function sanity(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw new Error('schema must be a JSON object');
  const bad = [...schemaKeywords(schema)].filter((k) => !SUPPORTED_KEYWORDS.has(k) && !ANNOTATION_KEYWORDS.has(k));
  if (bad.length) throw new Error(`schema uses unsupported keyword(s): ${bad.join(', ')}`);
  const refs = [];
  const collect = (s) => {
    if (!s || typeof s !== 'object') return;
    if (typeof s.$ref === 'string') refs.push(s.$ref);
    for (const v of Object.values(s)) if (v && typeof v === 'object') collect(v);
  };
  collect(schema);
  for (const r of refs) resolveRef(schema, r);
  const formats = [];
  const collectFormats = (s) => {
    if (!s || typeof s !== 'object') return;
    if (typeof s.format === 'string') formats.push(s.format);
    for (const v of Object.values(s)) if (v && typeof v === 'object') collectFormats(v);
  };
  collectFormats(schema);
  const badF = formats.filter((f) => !SUPPORTED_FORMATS.has(f));
  if (badF.length) throw new Error(`schema uses unsupported format(s): ${[...new Set(badF)].join(', ')}`);
  return schema;
}

/** Read and sanity-check a schema file. Throws with a clear message. */
export function loadSchema(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    throw new Error(`cannot read schema ${path}: ${e.message}`);
  }
  let schema;
  try {
    schema = JSON.parse(text);
  } catch (e) {
    throw new Error(`schema ${path} is not valid JSON: ${e.message}`);
  }
  try {
    return sanity(schema);
  } catch (e) {
    throw new Error(`schema ${path}: ${e.message}`);
  }
}

function resolveRef(root, ref) {
  const m = /^#\/\$defs\/([^/]+)$/.exec(ref);
  if (!m) throw new Error(`unsupported $ref "${ref}" (only #/$defs/<name>)`);
  const target = root.$defs?.[m[1]];
  if (!target) throw new Error(`$ref "${ref}" not found in $defs`);
  return target;
}

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v; // 'number' | 'string' | 'boolean' | 'object'
}

function matchesType(v, t) {
  if (t === 'integer') return typeof v === 'number' && Number.isInteger(v);
  if (t === 'number') return typeof v === 'number' && Number.isFinite(v);
  return typeOf(v) === t;
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => deepEqual(a[k], b[k]));
}

function isRealDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function isHttpUri(s) {
  try {
    const u = new URL(s);
    return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname && !/\s/.test(s);
  } catch {
    return false;
  }
}

const FORMATS = {
  date: (s) => isRealDate(s),
  uri: (s) => isHttpUri(s),
  'hex-color': (s) => /^#[0-9a-f]{6}$/.test(s),
};

const esc = (k) => String(k).replace(/~/g, '~0').replace(/\//g, '~1');
const show = (v) => {
  const s = JSON.stringify(v);
  return s && s.length > 60 ? s.slice(0, 57) + '...' : s;
};

function check(root, schema, data, path, errors) {
  if (schema === true || schema === undefined) return;
  if (schema === false) {
    errors.push({ path: path || '/', message: 'no value allowed here' });
    return;
  }
  if (schema.$ref) {
    check(root, resolveRef(root, schema.$ref), data, path, errors);
  }
  const at = path || '/';

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(data, t))) {
      errors.push({ path: at, message: `expected ${types.join(' | ')}, got ${typeOf(data)}` });
      return;
    }
  }
  if (schema.const !== undefined && !deepEqual(schema.const, data)) {
    errors.push({ path: at, message: `must equal ${show(schema.const)}` });
  }
  if (schema.enum && !schema.enum.some((e) => deepEqual(e, data))) {
    errors.push({ path: at, message: `${show(data)} is not one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}` });
  }

  if (typeof data === 'number') {
    if (schema.minimum !== undefined && data < schema.minimum) errors.push({ path: at, message: `must be >= ${schema.minimum}` });
    if (schema.maximum !== undefined && data > schema.maximum) errors.push({ path: at, message: `must be <= ${schema.maximum}` });
  }

  if (typeof data === 'string') {
    const len = [...data].length;
    if (schema.minLength !== undefined && len < schema.minLength) errors.push({ path: at, message: `must be at least ${schema.minLength} characters` });
    if (schema.maxLength !== undefined && len > schema.maxLength) errors.push({ path: at, message: `must be at most ${schema.maxLength} characters` });
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(data)) {
      errors.push({ path: at, message: `${show(data)} does not match pattern ${schema.pattern}` });
    }
    if (schema.format && FORMATS[schema.format] && !FORMATS[schema.format](data)) {
      errors.push({ path: at, message: `${show(data)} is not a valid ${schema.format}` });
    }
  }

  if (Array.isArray(data)) {
    if (schema.minItems !== undefined && data.length < schema.minItems) errors.push({ path: at, message: `must have at least ${schema.minItems} item(s)` });
    if (schema.maxItems !== undefined && data.length > schema.maxItems) errors.push({ path: at, message: `must have at most ${schema.maxItems} item(s)` });
    if (schema.uniqueItems) {
      for (let i = 0; i < data.length; i++) {
        for (let j = 0; j < i; j++) {
          if (deepEqual(data[i], data[j])) {
            errors.push({ path: `${path}/${i}`, message: `duplicate item ${show(data[i])}` });
            j = i;
          }
        }
      }
    }
    if (schema.items !== undefined) data.forEach((item, i) => check(root, schema.items, item, `${path}/${i}`, errors));
  }

  if (typeOf(data) === 'object') {
    for (const req of schema.required ?? []) {
      if (!Object.hasOwn(data, req)) errors.push({ path: `${path}/${esc(req)}`, message: 'is required' });
    }
    const props = schema.properties ?? {};
    for (const [k, v] of Object.entries(data)) {
      if (Object.hasOwn(props, k)) check(root, props[k], v, `${path}/${esc(k)}`, errors);
      else if (schema.additionalProperties === false) errors.push({ path: `${path}/${esc(k)}`, message: 'unknown property' });
      else if (typeof schema.additionalProperties === 'object') check(root, schema.additionalProperties, v, `${path}/${esc(k)}`, errors);
    }
  }

  if (schema.anyOf) {
    const results = schema.anyOf.map((s) => {
      const e = [];
      check(root, s, data, path, e);
      return e;
    });
    if (!results.some((e) => e.length === 0)) {
      errors.push({ path: at, message: `matches none of anyOf (${results.map((e) => e[0]?.message).join('; ')})` });
    }
  }
  if (schema.oneOf) {
    const results = schema.oneOf.map((s) => {
      const e = [];
      check(root, s, data, path, e);
      return e;
    });
    const n = results.filter((e) => e.length === 0).length;
    if (n === 0) errors.push({ path: at, message: `matches none of oneOf (${results.map((e) => e[0]?.message).join('; ')})` });
    else if (n > 1) errors.push({ path: at, message: `matches ${n} oneOf branches, expected exactly 1` });
  }
}

/** Validate data against schema → { ok, errors: [{path, message}] }. Paths are JSON Pointers ("" root → "/"). */
export function validate(schema, data) {
  const errors = [];
  check(schema, schema, data, '', errors);
  return { ok: errors.length === 0, errors };
}
