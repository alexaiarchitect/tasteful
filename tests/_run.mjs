// Shared helper for CLI tests (not a test file itself: node --test only picks *.test.mjs).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const REF = join(ROOT, 'fixtures/theme.reference.css');
export const REF_TEXT = readFileSync(REF, 'utf8');

export function run(script, args = [], opts = {}) {
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', script), ...args], { encoding: 'utf8', cwd: ROOT, timeout: 30000, ...opts });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

const dir = mkdtempSync(join(tmpdir(), 'tasteful-test-'));
let n = 0;
export function tmpFile(content, ext = '.css') {
  const f = join(dir, `f${++n}${ext}`);
  writeFileSync(f, content);
  return f;
}
