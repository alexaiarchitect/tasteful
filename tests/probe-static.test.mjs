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
import { tmpdir, homedir } from 'node:os';
import { createRequire } from 'node:module';
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

const MESSY = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Messy</title><style>
@font-face { font-family: "__Inter_d65c78"; src: url("/fonts/inter.woff2") format("woff2"); }
@font-face { font-family: "Placeholder"; src: local("Arial"); }
body { margin: 0; font-family: "__Inter_d65c78", "__Inter_Fallback_d65c78", sans-serif; background-color: #fafafa; color: #111111; }
h1 { font-family: "Ppneuemontreal", sans-serif; }
h2 { font-family: "Atlasgrotesk Web", sans-serif; }
p { font-family: "Inter Display:Medium", "Placeholder", sans-serif; }
.pill { border-radius: 9999px; background-color: #111111; color: #ffffff; padding: 8px 20px; display: inline-block; }
.chip { border-radius: 3.35544e+07px; background-color: #3b5bdb; color: #ffffff; padding: 8px 20px; display: inline-block; }
.card { border-radius: 7.123px; background-color: #ffffff; border: 1px solid #e2e3e0; width: 320px; height: 200px; }
</style></head><body><main><h1>Title</h1><h2>Sub</h2><p>Copy</p>
<button class="pill">Start</button> <a class="btn chip" href="#">More</a>
<div class="card">Card</div></main></body></html>`;

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
    } else if (req.url === '/scroller') {
      // Body locked to one viewport, content scrolls inside a container: scrollHeight = vh
      // while sampled elements extend over 3 viewports (regression: area_pct > 100).
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><title>Scroller</title><style>html,body{margin:0;height:100vh;overflow:hidden;background:#dddcd7}
#s{height:100vh;overflow:auto}.blk{height:900px;background:#dddcd7}.alt{height:600px;background:#222;position:relative}
.alt i{position:absolute;inset:-200px 0;background:#3b5bdb}</style><div id="s"><div class="blk"></div><div class="alt"><i></i></div><div class="blk"></div><div class="blk"></div></div>`);
    } else if (req.url === '/messy') {
      // Builder-generated font names and Tailwind rounded-full radii (static + browser mode).
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(MESSY);
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

const hasPlaywright = (() => {
  try {
    return !!createRequire(join(process.env.CLAUDE_PLUGIN_DATA ?? join(homedir(), '.claude/plugins/data/tasteful'), 'deps', 'package.json')).resolve('playwright');
  } catch {
    return false;
  }
})();

test('browser mode: background area_pct stays within 0–100 (inner scroll container, overflowing child)', { skip: !hasPlaywright && 'playwright not installed' }, async () => {
  const r = await run([`${base}/scroller`, '--json', '--timeout', '20000']);
  assert.equal(r.code, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.mode, 'browser');
  const bgs = j.colors.backgrounds;
  assert.ok(bgs.length >= 2, JSON.stringify(bgs));
  for (const b of bgs) assert.ok(b.area_pct >= 0 && b.area_pct <= 100, JSON.stringify(bgs));
  const sum = bgs.reduce((a, b) => a + b.area_pct, 0);
  assert.ok(sum <= 100.05, `sum ${sum}: ${JSON.stringify(bgs)}`);
  assert.equal(bgs[0].hex, '#dddcd7');
});

test('static mode: rounded-full radii become "pill", builder font names are cleaned, raw names kept', async () => {
  const r = await run([`${base}/messy`, '--json'], { TASTEFUL_FORCE_STATIC: '1' });
  assert.equal(r.code, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.mode, 'static');
  assert.equal(j.radii.histogram.pill, 2, JSON.stringify(j.radii)); // 9999px + 3.35544e+07px
  assert.equal(j.radii.histogram['7.12px'], 1, JSON.stringify(j.radii));
  assert.ok(!Object.keys(j.radii.histogram).some((k) => /e\+|9999/.test(k)), JSON.stringify(j.radii));
  const faces = j.fonts.faces;
  assert.ok(faces.includes('Inter'), JSON.stringify(faces));
  assert.ok(faces.includes('PP Neue Montreal') && faces.includes('Ppneuemontreal'), JSON.stringify(faces));
  assert.ok(faces.includes('Atlas Grotesk'), JSON.stringify(faces));
  assert.ok(faces.includes('Inter Display'), JSON.stringify(faces));
  assert.ok(!faces.some((f) => /^__|:|^Placeholder$/.test(f)), JSON.stringify(faces));
  assert.ok(j.fonts.faces_raw.includes('__Inter_d65c78'), JSON.stringify(j.fonts.faces_raw));
  assert.ok(j.fonts.faces_raw.includes('Placeholder'), JSON.stringify(j.fonts.faces_raw));
  assert.equal(j.fonts.computed.body, 'Inter');
});

test('browser mode: rounded-full radii become "pill" in the histogram, buttons and cards', { skip: !hasPlaywright && 'playwright not installed' }, async () => {
  const r = await run([`${base}/messy`, '--json', '--timeout', '20000']);
  assert.equal(r.code, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.mode, 'browser');
  assert.ok(j.radii.histogram.pill >= 2, JSON.stringify(j.radii));
  assert.ok(!Object.keys(j.radii.histogram).some((k) => /e\+|9999/.test(k)), JSON.stringify(j.radii));
  assert.ok(j.buttons.length >= 2, JSON.stringify(j.buttons));
  for (const b of j.buttons) assert.equal(b.radius, 'pill', JSON.stringify(j.buttons));
  assert.ok(j.cards.some((c) => c.radius === '7.12px'), JSON.stringify(j.cards));
  assert.equal(j.fonts.computed.body, 'Inter');
  assert.equal(j.fonts.computed.h1, 'PP Neue Montreal');
  assert.equal(j.fonts.computed.h2, 'Atlas Grotesk');
  assert.equal(j.fonts.computed.p, 'Inter Display');
  assert.ok(Array.isArray(j.fonts.faces_raw));
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
