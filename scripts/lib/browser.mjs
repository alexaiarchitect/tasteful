// tasteful — scripts/lib/browser.mjs
//
// Thin Playwright helpers shared by probe.mjs and preview.mjs. Playwright is
// loaded lazily through loadPlaywright() (deps.mjs); nothing here imports it
// statically, so scripts that never launch a browser work without it.

import { loadPlaywright } from './deps.mjs';

export const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';

export const COOKIE_TEXT_RE =
  /^(accept( all)?|agree|got it|allow all|ok(ay)?|i understand|принять|согласен|aceptar( todo)?|de acuerdo)$/i;

/** Error thrown when Playwright or its browser is unavailable. */
export class PlaywrightUnavailable extends Error {}

/**
 * Launch headless Chromium and open one page.
 * @returns {Promise<{pw, browser, context, page}>}
 * Throws PlaywrightUnavailable when playwright cannot be loaded or launched.
 */
export async function launch(data, opts = {}) {
  const pw = loadPlaywright(data);
  if (!pw) throw new PlaywrightUnavailable('playwright is not installed (run ensure-deps.sh)');
  let browser;
  try {
    browser = await pw.chromium.launch({ headless: opts.headless ?? true });
  } catch (e) {
    throw new PlaywrightUnavailable(`chromium failed to launch: ${String(e.message).split('\n')[0]}`);
  }
  try {
    const context = await newContext(browser, opts.context);
    const page = await context.newPage();
    return { pw, browser, context, page };
  } catch (e) {
    await browser.close().catch(() => {});
    throw e;
  }
}

/** New browser context with the tasteful defaults (real UA, 1440×900, en-US). */
export function newContext(browser, overrides = {}) {
  return browser.newContext({
    userAgent: CHROME_UA,
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    reducedMotion: 'no-preference',
    ignoreHTTPSErrors: true,
    ...overrides,
  });
}

/**
 * Click the first visible button/link whose text is a consent phrase, then
 * hide fixed/sticky cookie or consent overlays. Never throws.
 * @returns {Promise<boolean>} true when something was clicked or hidden.
 */
export async function dismissCookieBanners(page) {
  let done = false;
  try {
    const frames = [page.mainFrame(), ...page.frames().filter((f) => f !== page.mainFrame())].slice(0, 6);
    outer: for (const frame of frames) {
      const loc = frame.locator('button, a, [role="button"], input[type="button"], input[type="submit"]');
      const texts = await withBudget(
        loc.evaluateAll((els) =>
          els.slice(0, 400).map((el) => {
            const r = el.getBoundingClientRect();
            const visible = r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
            return visible ? (el.innerText || el.value || el.getAttribute('aria-label') || '').trim() : '';
          }),
        ),
        1500,
        () => [],
      );
      for (let i = 0; i < texts.length; i++) {
        const t = texts[i].replace(/\s+/g, ' ').replace(/[.!]$/, '');
        if (t && COOKIE_TEXT_RE.test(t)) {
          try {
            await loc.nth(i).click({ timeout: 1500, noWaitAfter: true });
            done = true;
            break outer;
          } catch {
            /* try the next candidate */
          }
        }
      }
    }
  } catch {
    /* ignore */
  }
  try {
    const hidden = await withBudget(
      page.evaluate(() => {
        let n = 0;
        const sel = '[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i]';
        for (const el of document.querySelectorAll(sel)) {
          const pos = getComputedStyle(el).position;
          if (pos === 'fixed' || pos === 'sticky') {
            el.style.setProperty('display', 'none', 'important');
            n++;
          }
        }
        return n;
      }),
      1500,
      () => 0,
    );
    if (hidden > 0) done = true;
  } catch {
    /* ignore */
  }
  return done;
}

/** Wait for document.fonts.ready, at most `ms`. Never throws. */
export async function waitForFonts(page, ms = 5000) {
  try {
    await withBudget(
      page.evaluate(() => document.fonts.ready.then(() => true)),
      ms,
      () => false,
    );
  } catch {
    /* ignore */
  }
}

/**
 * Race a promise against a timer. On timeout resolves with onTimeout()
 * (or rejects with an Error when onTimeout is omitted). Clears the timer.
 */
export function withBudget(promise, ms, onTimeout) {
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      if (typeof onTimeout === 'function') {
        try {
          resolve(onTimeout());
        } catch (e) {
          reject(e);
        }
      } else reject(new Error(`timed out after ${ms} ms`));
    }, ms);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

/**
 * Viewport screenshot as JPEG ≤ maxBytes: quality 80, step −10, min 40.
 * Returns the buffer (the smallest one tried if none fits).
 */
export async function jpegUnder(page, maxBytes = 300 * 1024, shotOpts = {}) {
  let buf;
  for (let q = 80; q >= 40; q -= 10) {
    buf = await page.screenshot({ type: 'jpeg', quality: q, timeout: 10000, ...shotOpts });
    if (buf.length <= maxBytes) return buf;
  }
  return buf;
}
