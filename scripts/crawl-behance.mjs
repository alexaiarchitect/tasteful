#!/usr/bin/env node
// tasteful — scripts/crawl-behance.mjs
// Behance home feed → projects that link a live external website → candidate JSONL.
// Contract: docs/SCRIPTS.md → crawl-behance.mjs. Playwright is loaded lazily
// via loadPlaywright(dataDir); this script never imports it statically.

import { parseArgs, EXIT_OK, EXIT_FAIL, EXIT_USAGE, fail } from './lib/args.mjs';
import { log } from './lib/log.mjs';
import { dataDir, loadPlaywright } from './lib/deps.mjs';
import { CHROME_UA, politeFetch, robotsAllowed, canonicalUrl, hostKey, BlockedError, isMain } from './lib/fetch.mjs';

const HOME = 'https://www.behance.net/';
const NOT_A_WEBSITE =
  /(^|\.)(behance\.net|adobe\.com|adobe\.io|typekit\.net|adobelogin\.com|facebook\.com|instagram\.com|twitter\.com|x\.com|linkedin\.com|pinterest\.com|youtube\.com|youtu\.be|vimeo\.com|tiktok\.com|dribbble\.com|t\.me|wa\.me|threads\.net|artstation\.com|google\.com|apple\.com|creativecommons\.org|gstatic\.com|bit\.ly|linktr\.ee)$/i;

const spec = {
  usage: 'crawl-behance.mjs [--limit <n>] [--max-minutes <n>]',
  description:
    'Render the Behance home feed with Playwright, open project pages (1 page/s, robots.txt\n' +
    'respected) and keep only projects that link a live external website. Prints candidate\n' +
    'JSONL {url, source:"behance", source_url, score:null, tags, award:null, date:null, title}.\n' +
    'Requires Playwright in <data>/deps (exit 2 otherwise).',
  flags: {
    limit: { type: 'number', help: 'Stop after n kept candidates' },
    'max-minutes': { type: 'number', default: 15, help: 'Hard wall-clock budget in minutes' },
  },
};

/** Pick the external website from a list of {href, text} links found on a project page. */
export function pickExternal(links) {
  const scored = [];
  for (const { href, text = '', context = '', chrome = false } of links) {
    if (chrome) continue; // Behance's own nav, footer and licence links
    let u;
    try {
      u = new URL(href);
    } catch {
      continue;
    }
    // Behance wraps outbound links; unwrap ?url= / ?u= redirects.
    for (const k of ['url', 'u', 'target']) {
      const inner = u.searchParams.get(k);
      if (inner && /^https?:\/\//.test(inner) && NOT_A_WEBSITE.test(u.hostname)) {
        try {
          u = new URL(inner);
        } catch {}
      }
    }
    if (!/^https?:$/.test(u.protocol) || NOT_A_WEBSITE.test(u.hostname)) continue;
    let s = 0;
    if (/website|web site|visit|live|site/i.test(text)) s += 2;
    if (/website|web site/i.test(context)) s += 1;
    if (u.pathname === '/' || u.pathname === '') s += 1;
    scored.push({ href: u.toString(), s });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored[0]?.href ?? null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { flags } = parseArgs(process.argv.slice(2), spec);
  if (flags.limit !== undefined && !(flags.limit > 0)) fail('--limit must be a positive number');
  if (!(flags.maxMinutes > 0)) fail('--max-minutes must be > 0');

  const pw = loadPlaywright(dataDir(flags));
  if (!pw) fail('Playwright is unavailable; run scripts/ensure-deps.sh <plugin-root> <data-dir> --browsers', EXIT_USAGE);

  const stats = { feed_links: 0, projects_opened: 0, kept: 0, no_website: 0, dead_website: 0, duplicates: 0, robots_skipped: 0, errors: 0 };
  let stopped = 'done';
  let browser = null;
  let finished = false;

  const finish = async (reason) => {
    if (finished) return;
    finished = true;
    stopped = reason ?? stopped;
    if (browser) await browser.close().catch(() => {});
    log.info(
      `summary: feed project links ${stats.feed_links}, projects opened ${stats.projects_opened}, kept ${stats.kept}, ` +
        `no website link ${stats.no_website}, dead website ${stats.dead_website}, duplicates ${stats.duplicates}, ` +
        `skipped by robots ${stats.robots_skipped}, errors ${stats.errors}, stopped: ${stopped}`,
    );
    process.exit(stats.kept > 0 ? EXIT_OK : EXIT_FAIL);
  };

  // Hard wall-clock budget: close the browser and exit no matter what is pending.
  const budget = setTimeout(() => {
    log.warn(`budget of ${flags.maxMinutes} min reached`);
    finish('budget');
    setTimeout(() => process.exit(stats.kept > 0 ? EXIT_OK : EXIT_FAIL), 5000).unref();
  }, flags.maxMinutes * 60000);

  try {
    if (!(await robotsAllowed(HOME))) {
      stats.robots_skipped++;
      log.warn('robots.txt disallows the Behance home feed');
      return finish('blocked');
    }
    try {
      browser = await pw.chromium.launch({ headless: true });
    } catch (e) {
      log.debug(`bundled chromium failed (${String(e.message).split('\n')[0]}); trying installed Chrome`);
      try {
        browser = await pw.chromium.launch({ headless: true, channel: 'chrome' });
      } catch (e2) {
        clearTimeout(budget);
        fail(`Chromium failed to launch: ${String(e2.message).split('\n')[0]}`, EXIT_USAGE);
      }
    }
    const context = await browser.newContext({ userAgent: CHROME_UA, viewport: { width: 1440, height: 900 }, locale: 'en-US' });
    const page = await context.newPage();
    let lastNav = 0;
    const politeGoto = async (url) => {
      const wait = lastNav + 1000 - Date.now();
      if (wait > 0) await sleep(wait);
      lastNav = Date.now();
      return page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    };

    const res = await politeGoto(HOME);
    log.info(`home feed HTTP ${res?.status() ?? '?'}`);
    try {
      await page.waitForSelector('a[href*="/gallery/"]', { timeout: 20000 });
    } catch {
      log.warn('no project links rendered on the home feed (bot protection or layout change)');
      return finish('blocked');
    }
    for (let i = 0; i < 3; i++) {
      await page.mouse.wheel(0, 2500);
      await sleep(1200);
    }
    const hrefs = await page.$$eval('a[href*="/gallery/"]', (as) => as.map((a) => a.href));
    const projects = [...new Set(hrefs.map((h) => {
      try {
        const u = new URL(h);
        const m = u.pathname.match(/^\/gallery\/\d+(\/[^/]+)?/);
        return m ? `https://www.behance.net${m[0]}` : null;
      } catch {
        return null;
      }
    }).filter(Boolean))];
    stats.feed_links = projects.length;
    log.info(`home feed: ${projects.length} project links`);

    const seen = new Set();
    for (const projectUrl of projects) {
      if (!(await robotsAllowed(projectUrl))) {
        stats.robots_skipped++;
        continue;
      }
      try {
        await politeGoto(projectUrl);
        stats.projects_opened++;
        await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
        const { links, title } = await page.evaluate(() => ({
          title: (document.querySelector('h1')?.textContent || document.title || '').trim(),
          links: [...document.querySelectorAll('a[href^="http"]')].map((a) => ({
            href: a.href,
            text: (a.textContent || a.getAttribute('aria-label') || '').trim().slice(0, 80),
            context: (a.closest('section,aside,div')?.textContent || '').trim().slice(0, 200),
            chrome: !!a.closest('nav,footer,[class*="PrimaryNav"],[class*="StaticFooter"],[class*="Footer"],[class*="Copyright"]'),
          })),
        }));
        const site = pickExternal(links);
        if (!site) {
          stats.no_website++;
          continue;
        }
        const canon = canonicalUrl(site);
        const key = hostKey(canon);
        if (seen.has(key)) {
          stats.duplicates++;
          continue;
        }
        let live = false;
        try {
          const r = await politeFetch(canon, { timeoutMs: 10000, retryBlocked: false });
          live = r.status < 400 || r.status === 403 || r.status === 429;
        } catch (e) {
          if (e instanceof BlockedError) live = true;
        }
        if (!live) {
          stats.dead_website++;
          continue;
        }
        seen.add(key);
        process.stdout.write(
          JSON.stringify({
            url: canon,
            source: 'behance',
            source_url: projectUrl,
            score: null,
            tags: [],
            award: null,
            date: null,
            title: title.replace(/\s+on Behance\s*$/i, '') || null,
          }) + '\n',
        );
        stats.kept++;
        if (flags.limit && stats.kept >= flags.limit) {
          stopped = 'limit';
          break;
        }
      } catch (e) {
        stats.errors++;
        log.warn(`${projectUrl}: ${String(e.message).split('\n')[0]}`);
      }
    }
  } catch (e) {
    stats.errors++;
    log.error(String(e.message).split('\n')[0]);
  }
  clearTimeout(budget);
  await finish();
}

if (isMain(import.meta.url)) {
  main().catch((e) => {
    log.error(e);
    process.exit(EXIT_USAGE);
  });
}
