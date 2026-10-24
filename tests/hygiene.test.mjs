// House rules for the whole repo. Every check passes vacuously when the
// thing it inspects does not exist yet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT } from './_run.mjs';

const ls = (dir) => (existsSync(join(ROOT, dir)) ? readdirSync(join(ROOT, dir), { withFileTypes: true }) : []);

/** Minimal frontmatter reader: top-level `key: value` with indented continuation lines. */
function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return null;
  const out = {};
  let key = null;
  for (const line of m[1].split(/\r?\n/)) {
    const k = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (k) {
      key = k[1];
      out[key] = k[2];
    } else if (key && /^\s+\S/.test(line)) {
      out[key] += (out[key] ? ' ' : '') + line.trim();
    }
  }
  for (const [k, v] of Object.entries(out)) {
    let s = v.replace(/^[>|][+-]?\s*/, '').trim();
    if (/^(["']).*\1$/.test(s)) s = s.slice(1, -1);
    out[k] = s;
  }
  return { data: out, body: text.slice(m[0].length) };
}

const skills = ls('skills').filter((d) => d.isDirectory() && existsSync(join(ROOT, 'skills', d.name, 'SKILL.md')));

for (const dir of skills) {
  test(`skill ${dir.name}: SKILL.md house rules`, () => {
    const text = readFileSync(join(ROOT, 'skills', dir.name, 'SKILL.md'), 'utf8');
    const fm = frontmatter(text);
    assert.ok(fm, 'has frontmatter');
    const { data, body } = fm;
    assert.equal(data.name, dir.name, 'frontmatter name equals the directory name');
    assert.ok((data.description ?? '').length > 200, `description longer than 200 chars (is ${(data.description ?? '').length})`);
    assert.ok(data.description.includes('Use when'), 'description contains "Use when"');
    assert.ok(data.description.includes("Don't use"), 'description contains "Don\'t use"');
    assert.ok((data['allowed-tools'] ?? '').includes('AskUserQuestion'), 'allowed-tools includes AskUserQuestion');
    const lines = body.split('\n').length;
    assert.ok(lines <= 200, `body is at most 200 lines (is ${lines})`);
    for (const h of ['## Flow', '## Scripts', '## Completion checklist']) {
      assert.match(body, new RegExp(`^${h}\\s*$`, 'm'), `has "${h}"`);
    }
    const mentioned = new Set([...body.matchAll(/scripts\/([\w./-]+?\.(?:mjs|sh))\b/g)].map((m) => m[1]));
    const missing = [...mentioned].filter((s) => !existsSync(join(ROOT, 'scripts', s)));
    assert.deepEqual(missing, [], `scripts mentioned in the body but missing: ${missing.map((s) => 'scripts/' + s).join(', ')}`);
  });
}

test('the forbidden word appears only in docs/GOAL.md', () => {
  const word = ['un', 'common'].join('');
  const skipDirs = new Set(['.git', 'node_modules', '.tasteful', join('index', 'shots'), join('plugin-evals', 'results')]);
  const hits = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, e.name);
      const rel = relative(ROOT, abs);
      if (e.isDirectory()) {
        if (!skipDirs.has(rel) && !skipDirs.has(e.name)) walk(abs);
      } else if (e.isFile() && rel !== join('docs', 'GOAL.md')) {
        if (statSync(abs).size > 20 * 1024 * 1024) continue;
        if (/\.(jpe?g|png|webp|gif|avif|woff2?|ico)$/i.test(e.name)) continue;
        if (readFileSync(abs, 'latin1').toLowerCase().includes(word)) hits.push(rel);
      }
      if (e.name.toLowerCase().includes(word)) hits.push(rel);
    }
  };
  walk(ROOT);
  assert.deepEqual(hits, []);
});

test('no commands/ directory and no root CLAUDE.md', () => {
  assert.equal(existsSync(join(ROOT, 'commands')), false, 'commands/ must not exist (skills only)');
  assert.equal(existsSync(join(ROOT, 'CLAUDE.md')), false, 'no root CLAUDE.md');
});

test('agents/*.md frontmatter has name and description', () => {
  for (const e of ls('agents').filter((d) => d.isFile() && d.name.endsWith('.md'))) {
    const fm = frontmatter(readFileSync(join(ROOT, 'agents', e.name), 'utf8'));
    assert.ok(fm, `${e.name} has frontmatter`);
    assert.ok(fm.data.name, `${e.name} has name`);
    assert.ok(fm.data.description, `${e.name} has description`);
  }
});

test('plugin.json declares experimental.evals = plugin-evals', { skip: !existsSync(join(ROOT, '.claude-plugin/plugin.json')) }, () => {
  const p = JSON.parse(readFileSync(join(ROOT, '.claude-plugin/plugin.json'), 'utf8'));
  assert.equal(p.experimental?.evals, 'plugin-evals');
});

function help(script) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(ROOT, 'scripts', script), '--help'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ script, code, signal, out });
    });
  });
}

test('every scripts/*.mjs answers --help (exit 0, < 10 s, mentions --json)', async () => {
  const scripts = ls('scripts').filter((d) => d.isFile() && d.name.endsWith('.mjs')).map((d) => d.name);
  const results = await Promise.all(scripts.map(help));
  for (const r of results) {
    assert.equal(r.signal, null, `${r.script} --help finished within 10 s`);
    assert.equal(r.code, 0, `${r.script} --help exits 0\n${r.out}`);
    assert.match(r.out, /--json/, `${r.script} --help mentions --json`);
  }
});
