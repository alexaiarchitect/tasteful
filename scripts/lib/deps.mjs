// tasteful — scripts/lib/deps.mjs
//
// Locates the plugin data dir and the Playwright install that
// ensure-deps.sh puts there. ${CLAUDE_PLUGIN_DATA} is substituted only in
// skill/agent markdown, not in the Bash environment, so skills pass
// --data "${CLAUDE_PLUGIN_DATA}" explicitly; the env var and the default
// path are fallbacks.
//
// Layout under <data>:
//   deps/package.json, deps/node_modules/   (npm ci of scripts/package.json)
//   browsers/                               (PLAYWRIGHT_BROWSERS_PATH, optional)

import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Resolve the plugin data dir: --data, then $CLAUDE_PLUGIN_DATA, then ~/.claude/plugins/data/tasteful. */
export function dataDir(opts = {}) {
  return opts.data ?? process.env.CLAUDE_PLUGIN_DATA ?? join(homedir(), '.claude/plugins/data/tasteful');
}

function requireFromDeps(data) {
  return createRequire(join(data, 'deps', 'package.json'));
}

/**
 * Load Playwright from <data>/deps. Sets PLAYWRIGHT_BROWSERS_PATH to
 * <data>/browsers when that dir exists and the variable is unset.
 * Returns the module, or null if unavailable. Never throws.
 */
export function loadPlaywright(data = dataDir()) {
  try {
    const browsers = join(data, 'browsers');
    if (existsSync(browsers)) process.env.PLAYWRIGHT_BROWSERS_PATH ??= browsers;
    return requireFromDeps(data)('playwright');
  } catch {
    return null;
  }
}

/** Report what is installed under the data dir. Never throws. */
export function depsStatus(data = dataDir()) {
  let playwrightVersion = null;
  try {
    playwrightVersion = requireFromDeps(data)('playwright/package.json').version ?? null;
  } catch {
    playwrightVersion = null;
  }
  const browsers = join(data, 'browsers');
  return {
    data,
    depsInstalled: existsSync(join(data, 'deps', 'node_modules')) && playwrightVersion !== null,
    browsersDir: existsSync(browsers) ? browsers : null,
    playwrightVersion,
  };
}
