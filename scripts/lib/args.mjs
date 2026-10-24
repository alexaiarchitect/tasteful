// tasteful — scripts/lib/args.mjs
//
// Tiny stdlib-only argv parser shared by every tasteful script.
//
// CONVENTION (all scripts):
//   * stdout carries ONLY the result: JSON when --json is passed (JSONL for
//     streaming/batch outputs), otherwise a human-readable table.
//   * All logs, progress and diagnostics go to stderr (see log.mjs).
//   * Exit codes: 0 = success, 1 = check failed / violation found,
//     2 = usage or environment error (bad flags, Playwright unavailable
//     where required, unreadable input).
//   * Every script accepts --help, --json and --data <dir> (the plugin data
//     dir; see deps.mjs for the fallback chain).
//
// Usage:
//   import { parseArgs } from './lib/args.mjs';
//   const spec = {
//     description: 'Probe a URL for design facts.',
//     usage: 'probe.mjs <url> [options]',
//     positional: [{ name: 'url', required: true, help: 'Site to probe' }],
//     flags: {
//       deep:    { type: 'boolean', default: false, help: 'Also take screenshots' },
//       timeout: { type: 'number',  default: 30000, help: 'Per-page timeout (ms)' },
//       out:     { type: 'string',  alias: 'o', help: 'Output directory' },
//       tag:     { type: 'list',    default: [], help: 'Repeatable' },
//     },
//   };
//   const { flags, positional, rest } = parseArgs(process.argv.slice(2), spec);
//
// Supported forms: --k v, --k=v, -a v (alias), --flag / --no-flag for booleans,
// repeated list flags (--tag a --tag b) and comma lists (--tag a,b),
// "--" ends flag parsing. --help prints usage to stdout and exits 0.

export const EXIT_OK = 0;
export const EXIT_FAIL = 1;
export const EXIT_USAGE = 2;

const COMMON_FLAGS = {
  help: { type: 'boolean', default: false, alias: 'h', help: 'Show this help and exit' },
  json: { type: 'boolean', default: false, help: 'Print machine-readable JSON to stdout' },
  data: { type: 'string', help: 'Plugin data dir (default: $CLAUDE_PLUGIN_DATA, then ~/.claude/plugins/data/tasteful)' },
};

/** Print a message to stderr and exit (default code 2 = usage error). */
export function fail(msg, code = EXIT_USAGE) {
  process.stderr.write(`[tasteful] error: ${msg}\n`);
  process.exit(code);
}

function allFlags(spec) {
  return { ...COMMON_FLAGS, ...(spec?.flags ?? {}) };
}

function camel(name) {
  return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/** Build the --help text for a spec. */
export function usageText(spec = {}) {
  const lines = [];
  if (spec.usage) lines.push(`Usage: ${spec.usage}`);
  if (spec.description) lines.push('', spec.description);
  const pos = spec.positional ?? [];
  if (pos.length) {
    lines.push('', 'Arguments:');
    for (const p of pos) {
      const label = p.required ? `<${p.name}>` : `[${p.name}]`;
      lines.push(`  ${label.padEnd(26)} ${p.help ?? ''}`.trimEnd());
    }
  }
  lines.push('', 'Options:');
  for (const [name, f] of Object.entries(allFlags(spec))) {
    const alias = f.alias ? `-${f.alias}, ` : '';
    const val = f.type === 'boolean' ? '' : f.type === 'list' ? ' <a,b,...>' : ` <${f.type}>`;
    const left = `${alias}--${name}${val}`;
    const def =
      f.default === undefined || f.default === false || (Array.isArray(f.default) && !f.default.length)
        ? ''
        : ` (default: ${Array.isArray(f.default) ? f.default.join(',') : f.default})`;
    lines.push(`  ${left.padEnd(26)} ${(f.help ?? '') + def}`.trimEnd());
  }
  lines.push(
    '',
    'Output: result on stdout (JSON with --json), logs on stderr.',
    'Exit codes: 0 ok, 1 check failed, 2 usage/environment error.',
  );
  return lines.join('\n') + '\n';
}

function coerce(name, def, raw) {
  switch (def.type) {
    case 'number': {
      const n = Number(raw);
      if (raw === undefined || raw === '' || Number.isNaN(n)) fail(`--${name} expects a number, got "${raw ?? ''}"`);
      return n;
    }
    case 'boolean': {
      if (raw === undefined) return true;
      if (/^(1|true|yes|on)$/i.test(raw)) return true;
      if (/^(0|false|no|off)$/i.test(raw)) return false;
      fail(`--${name} expects a boolean, got "${raw}"`);
      break;
    }
    case 'list':
      if (raw === undefined) fail(`--${name} expects a value`);
      return String(raw).split(',').map((s) => s.trim()).filter(Boolean);
    default:
      if (raw === undefined) fail(`--${name} expects a value`);
      return String(raw);
  }
}

/**
 * Parse argv against a spec.
 * @returns {{flags: Record<string, any>, positional: Record<string, string>, rest: string[]}}
 *   flags are keyed by both the flag name and its camelCase form.
 *   positional maps declared names to values; extra positionals land in rest.
 */
export function parseArgs(argv, spec = {}) {
  const defs = allFlags(spec);
  const byAlias = {};
  for (const [name, f] of Object.entries(defs)) if (f.alias) byAlias[f.alias] = name;

  const flags = {};
  for (const [name, f] of Object.entries(defs)) {
    if (f.default !== undefined) flags[name] = Array.isArray(f.default) ? [...f.default] : f.default;
    else if (f.type === 'boolean') flags[name] = false;
    else if (f.type === 'list') flags[name] = [];
  }
  const explicitLists = new Set();
  const loose = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      loose.push(...argv.slice(i + 1));
      break;
    }
    let name;
    let raw;
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      raw = eq === -1 ? undefined : arg.slice(eq + 1);
    } else if (/^-[A-Za-z]$/.test(arg)) {
      name = byAlias[arg.slice(1)];
      if (!name) fail(`unknown option ${arg}\n\n${usageText(spec)}`);
    } else {
      loose.push(arg);
      continue;
    }

    let def = defs[name];
    if (!def && name.startsWith('no-') && defs[name.slice(3)]?.type === 'boolean' && raw === undefined) {
      flags[name.slice(3)] = false;
      continue;
    }
    if (!def) fail(`unknown option --${name}\n\n${usageText(spec)}`);

    if (def.type !== 'boolean' && raw === undefined) {
      const next = argv[i + 1];
      if (next === undefined || (next.startsWith('--') && next !== '-')) fail(`--${name} expects a value`);
      raw = next;
      i++;
    }
    const value = coerce(name, def, raw);
    if (def.type === 'list') {
      if (!explicitLists.has(name)) {
        flags[name] = [];
        explicitLists.add(name);
      }
      flags[name].push(...value);
    } else {
      flags[name] = value;
    }
  }

  if (flags.help) {
    process.stdout.write(usageText(spec));
    process.exit(EXIT_OK);
  }

  const positional = {};
  const pos = spec.positional ?? [];
  pos.forEach((p, idx) => {
    if (loose[idx] !== undefined) positional[p.name] = loose[idx];
    else if (p.required) fail(`missing required argument <${p.name}>\n\n${usageText(spec)}`);
  });
  const rest = loose.slice(pos.length);

  for (const key of Object.keys(flags)) {
    const c = camel(key);
    if (c !== key) flags[c] = flags[key];
  }
  return { flags, positional, rest };
}
