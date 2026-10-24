// Note: tests/fixtures/mini-index.json holds three SYNTHETIC entries on
// example.com/.org/.net hosts. They are test data, not real references; the
// schema forbids extra fields, so the note lives here instead of in the file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSchema, validate, schemaKeywords, SUPPORTED_KEYWORDS, ANNOTATION_KEYWORDS } from '../scripts/lib/schema.mjs';

const p = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const SCHEMA_PATH = p('../index/schema.json');
const mini = () => JSON.parse(readFileSync(p('./fixtures/mini-index.json'), 'utf8'));

test('index/schema.json only uses supported keywords', () => {
  const raw = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
  const used = schemaKeywords(raw);
  const unsupported = [...used].filter((k) => !SUPPORTED_KEYWORDS.has(k) && !ANNOTATION_KEYWORDS.has(k));
  assert.deepEqual(unsupported, []);
  // and the validator really exercises the vocabulary it claims
  for (const k of ['type', 'enum', 'required', 'properties', 'additionalProperties', 'items', '$defs', '$ref', 'format', 'pattern']) {
    assert.ok(used.has(k), k);
  }
});

test('index/schema.json: decisions encoded', () => {
  const s = loadSchema(SCHEMA_PATH);
  assert.equal(s.type, 'array');
  assert.deepEqual(s.$defs.source.enum, ['awwwards', 'cssda', 'behance', 'manual']);
  assert.deepEqual(s.$defs.status.enum, ['live', 'dead', 'unchecked']);
  assert.equal(s.$defs.color_strategy.enum.length, 7);
  const entry = s.$defs.entry;
  assert.equal(entry.additionalProperties, false);
  assert.deepEqual(entry.required, ['id', 'url', 'title', 'source', 'source_url', 'added', 'status', 'last_checked', 'kind', 'mood', 'typography', 'color', 'layout', 'motion', 'extractable', 'why']);
  for (const d of ['typography', 'color', 'layout', 'screenshots']) assert.equal(s.$defs[d].additionalProperties, false, d);
});

test('mini-index is valid', () => {
  const r = validate(loadSchema(SCHEMA_PATH), mini());
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
});

test('entry-level violations have JSON-pointer paths', () => {
  const s = loadSchema(SCHEMA_PATH);
  const d = mini();
  d[0].color.accent = '#3B5BDB';
  d[1].kind = [];
  d[1].mood = ['technical', 'technical'];
  d[2].motion = 1.5;
  d[2].added = '2026-02-30';
  d[2].url = 'ftp://example.net/';
  d[0].extra = 1;
  d[0].typography.faces = ['a', 'b', 'c', 'd'];
  d[0].id = 'Not_Kebab';
  delete d[1].why;
  d[1].source_score = 'high';
  const { ok, errors } = validate(s, d);
  assert.equal(ok, false);
  const paths = errors.map((e) => e.path);
  for (const want of ['/0/color/accent', '/1/kind', '/1/mood/1', '/2/motion', '/2/added', '/2/url', '/0/extra', '/0/typography/faces', '/0/id', '/1/why', '/1/source_score']) {
    assert.ok(paths.includes(want), `${want} in ${JSON.stringify(errors, null, 1)}`);
  }
});

test('validator keywords: oneOf/anyOf/const/minimum/maxLength/type arrays', () => {
  const s = {
    $defs: { n: { type: 'integer', minimum: 1, maximum: 3 } },
    type: 'object',
    properties: {
      a: { oneOf: [{ type: 'string' }, { $ref: '#/$defs/n' }] },
      b: { anyOf: [{ const: 'x' }, { type: 'null' }] },
      c: { type: 'string', minLength: 2, maxLength: 3 },
      d: { type: ['number', 'null'] },
      e: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 2, uniqueItems: true },
    },
    required: ['a'],
    additionalProperties: false,
  };
  assert.equal(validate(s, { a: 'z', b: null, c: 'ab', d: null, e: ['x'] }).ok, true);
  assert.equal(validate(s, { a: 2, b: 'x', d: 1.5 }).ok, true);
  const bad = validate(s, { a: 9, b: 'y', c: 'abcd', d: 'q', e: ['x', 'x', 'y'], f: 1 });
  assert.deepEqual(bad.errors.map((e) => e.path).sort(), ['/a', '/b', '/c', '/d', '/e', '/e/1', '/f'].sort());
  assert.equal(validate(s, {}).errors[0].path, '/a');
  assert.equal(validate(s, []).errors[0].path, '/');
});

test('formats', () => {
  const v = (format, x) => validate({ type: 'string', format }, x).ok;
  assert.equal(v('date', '2024-02-29'), true);
  assert.equal(v('date', '2023-02-29'), false);
  assert.equal(v('date', '2026-1-01'), false);
  assert.equal(v('uri', 'https://a.example/x?y=1'), true);
  assert.equal(v('uri', 'mailto:a@b.c'), false);
  assert.equal(v('uri', 'not a url'), false);
  assert.equal(v('hex-color', '#a1b2c3'), true);
  assert.equal(v('hex-color', '#A1B2C3'), false);
  assert.equal(v('hex-color', '#abc'), false);
});

test('loadSchema rejects unsupported keywords, formats and bad refs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tasteful-schema-'));
  const write = (name, obj) => {
    const f = join(dir, name);
    writeFileSync(f, typeof obj === 'string' ? obj : JSON.stringify(obj));
    return f;
  };
  assert.throws(() => loadSchema(write('a.json', { type: 'object', patternProperties: {} })), /unsupported keyword\(s\): patternProperties/);
  assert.throws(() => loadSchema(write('b.json', { type: 'string', format: 'email' })), /unsupported format/);
  assert.throws(() => loadSchema(write('c.json', { $ref: '#/$defs/nope' })), /not found/);
  assert.throws(() => loadSchema(write('d.json', '{')), /not valid JSON/);
  assert.throws(() => loadSchema(join(dir, 'missing.json')), /cannot read schema/);
});
