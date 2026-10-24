// tasteful — scripts/lib/log.mjs
//
// All diagnostics go to stderr so stdout stays reserved for the result
// (JSON with --json, otherwise a human table). See args.mjs for the full
// convention. debug() prints only when TASTEFUL_DEBUG=1.

const PREFIX = '[tasteful]';
const debugOn = () => process.env.TASTEFUL_DEBUG === '1';

function fmt(args) {
  return args
    .map((a) => (typeof a === 'string' ? a : a instanceof Error ? a.stack ?? a.message : JSON.stringify(a)))
    .join(' ');
}

let progressActive = false;
function write(line) {
  if (progressActive) {
    process.stderr.write('\n');
    progressActive = false;
  }
  process.stderr.write(line + '\n');
}

export const log = {
  info: (...a) => write(`${PREFIX} ${fmt(a)}`),
  warn: (...a) => write(`${PREFIX} warn: ${fmt(a)}`),
  error: (...a) => write(`${PREFIX} error: ${fmt(a)}`),
  debug: (...a) => {
    if (debugOn()) write(`${PREFIX} debug: ${fmt(a)}`);
  },
};

/**
 * Single-line progress on stderr, e.g. progress(3, 40, 'example.com').
 * Rewrites in place on a TTY; on a non-TTY prints one line per call.
 * Finishes the line when i >= n.
 */
export function progress(i, n, label = '') {
  const msg = `${PREFIX} [${i}/${n}] ${label}`;
  if (process.stderr.isTTY) {
    const width = process.stderr.columns || 100;
    process.stderr.write('\r' + msg.slice(0, width - 1).padEnd(width - 1));
    progressActive = i < n;
    if (i >= n) process.stderr.write('\n');
  } else {
    process.stderr.write(msg + '\n');
  }
}

export default log;
