// tasteful — tests/probe-static.test.mjs
//
// probe.mjs without a browser and without external network: --quick liveness
// against local servers (200, 404, never responds) and static-mode CSS
// extraction (TASTEFUL_FORCE_STATIC=1) against an inline HTML + CSS fixture.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROBE = join(ROOT, 'scripts', 'probe.mjs');

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Fixture &amp; Co — Studio</title>
<link rel="stylesheet" href="/site.css">
<link rel="stylesheet" href="https://cdn.example.invalid/remote.css">
<style>
  :root { --brand: #3b5bdb; --radius: 12px; }
  @font-face { font-family: "Fixture Sans"; src: url("/fonts/fixture.woff2") format("woff2"); }
  body { font-family: "Fixture Sans", system-ui, sans-serif; background-color: #f6f6f4; color: #15171c; }
  .btn { background: var(--brand); color: #fff; border-radius: var(--radius); transition: background-color .2s ease, transform 200ms cubic-bezier(0.22, 1, 0.36, 1); }
</style>
</head>
<body><main><section><h1>Hello</h1><p>Text</p></section><canvas></canvas></main></body>
</html>`;

const CSS = `
h1, h2 { font-family: 'Fraunces', Georgia, serif; color: #15171c; }
.card { background-color: #ffffff; border: 1px solid #e2e3e0; border-radius: 12px; box-shadow: 0 1px 2px rgb(20 20 30 / 0.04); }
.panel { background-color: #ffffff; border-radius: 1rem; }
.container { max-width: 72rem; }
@media (min-width: 640px) { .card { padding: 1.5rem; } }
@keyframes spin { to { transform: rotate(1turn); } }
.spinner { animation: spin 1s linear infinite; }
`;

let server;
let hang;
let base;
let hangBase;
let tmp;
const sockets = new Set();

before(async () => {
  server = createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(PAGE);
    } else if (req.url === '/site.css') {
      res.writeHead(200, { 'content-type': 'text/css' });
      res.end(CSS);
    } else {
      res.writeHead(404, { 'content-type': 'text/html' });
      res.end('<title>Not found</title>');
    }
  });
  hang = createServer(() => {
    /* never respond */
  });
  hang.on('connection', (s) => sockets.add(s));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  await new Promise((r) => hang.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  hangBase = `http://127.0.0.1:${hang.address().port}`;
  tmp = await mkdtemp(join(tmpdir(), 'tasteful-probe-'));
});

after(async () => {
  for (const s of sockets) s.destroy();
  await new Promise((r) => server.close(r));
  await new Promise((r) => hang.close(r));
  await rm(tmp, { recursive: true, force: true });
});

/** Run probe.mjs asynchronously (the fixture servers live in this process). */
function run(args, env = {}) {
  return new Promise((resolveRun) => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [PROBE, ...args], {
      env: { ...process.env, TASTEFUL_DEBUG: '0', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const killer = setTimeout(() => child.kill('SIGKILL'), 30000);
    child.on('close', (code) => {
      clearTimeout(killer);
      resolveRun({ code, stdout, stderr, ms: Date.now() - t0 });
    });
  });
}

test('--quick: 200 page reports status, final_url and title, exit 0', async () => {
  const r = await run([`${base}/`, '--quick', '--json']);
  assert.equal(r.code, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.mode, 'quick');
  assert.equal(j.status, 200);
  assert.equal(j.final_url, `${base}/`);
  assert.equal(j.title, 'Fixture & Co — Studio');
  assert.equal(typeof j.elapsed_ms, 'number');
  assert.deepEqual(Object.keys(j).sort(), ['elapsed_ms', 'errors', 'final_url', 'mode', 'probed_at', 'status', 'title', 'url']);
});

test('--quick: 404 exits 1 and still prints JSON', async () => {
  const r = await run([`${base}/missing`, '--quick', '--json']);
  assert.equal(r.code, 1);
  const j = JSON.parse(r.stdout);
  assert.equal(j.status, 404);
  assert.ok(j.errors.some((e) => /404/.test(e)));
});

test('--quick: a server that never responds times out within 10 s, exit 1', async () => {
  const r = await run([`${hangBase}/`, '--quick', '--json']);
  assert.equal(r.code, 1);
  assert.ok(r.ms < 10000, `took ${r.ms} ms`);
  const j = JSON.parse(r.stdout);
  assert.equal(j.status, null);
  assert.ok(j.errors.some((e) => /timeout/i.test(e)), JSON.stringify(j.errors));
});

test('static mode extracts fonts, colours, radii, shadows and motion from HTML + CSS', async () => {
  const r = await run([`${base}/`, '--json'], { TASTEFUL_FORCE_STATIC: '1' });
  assert.equal(r.code, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.mode, 'static');
  assert.equal(j.partial, true);
  assert.equal(j.status, 200);
  assert.equal(j.lang, 'en');
  assert.ok(j.errors.some((e) => /TASTEFUL_FORCE_STATIC/.test(e)));
  assert.ok(j.errors.some((e) => /cross-origin/.test(e)), 'remote stylesheet is skipped, not fetched');
  assert.ok(j.fonts.faces.includes('Fraunces'), JSON.stringify(j.fonts));
  assert.ok(j.fonts.faces.includes('Fixture Sans'), JSON.stringify(j.fonts));
  assert.equal(j.fonts.google_fonts, false);
  assert.equal(j.fonts.self_hosted, true);
  const bgs = j.colors.backgrounds.map((b) => b.hex);
  assert.ok(bgs.includes('#ffffff') && bgs.includes('#f6f6f4') && bgs.includes('#3b5bdb'), JSON.stringify(bgs));
  assert.ok(j.colors.backgrounds.every((b) => b.area_pct === null));
  assert.equal(j.colors.texts[0].hex, '#15171c');
  assert.ok(j.colors.borders.some((b) => b.hex === '#e2e3e0'));
  assert.equal(j.radii.histogram['12px'], 2, JSON.stringify(j.radii)); // literal + var(--radius)
  assert.equal(j.radii.histogram['1rem'], 1);
  assert.ok(j.shadows[0].value.startsWith('0 1px 2px'));
  assert.equal(j.container.maxWidth, '72rem');
  assert.deepEqual(j.motion.transition_durations, [200, 1000]);
  assert.ok(j.motion.easings.includes('cubic-bezier(0.22, 1, 0.36, 1)'));
  assert.equal(j.motion.animated_count, 1);
  assert.equal(j.motion.canvas_count, 1);
  assert.equal(j.motion.level_guess, 3); // canvas + animation
});

test('static mode on a 404 exits 1', async () => {
  const r = await run([`${base}/nope`, '--json'], { TASTEFUL_FORCE_STATIC: '1' });
  assert.equal(r.code, 1);
  assert.equal(JSON.parse(r.stdout).status, 404);
});

test('--batch --quick emits one JSONL line per URL and exits 1 when any is dead', async () => {
  const file = join(tmp, 'urls.txt');
  await writeFile(file, `${base}/\n{"url":"${base}/gone"}\n# comment\n`);
  const r = await run(['--batch', file, '--quick', '--concurrency', '2']);
  assert.equal(r.code, 1);
  const lines = r.stdout.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map((l) => l.status).sort(), [200, 404]);
});

test('usage errors exit 2', async () => {
  assert.equal((await run(['--json'])).code, 2);
  assert.equal((await run(['not a url at all', '--quick', '--deep'])).code, 2);
  const help = await run(['--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /Usage: probe\.mjs/);
});
