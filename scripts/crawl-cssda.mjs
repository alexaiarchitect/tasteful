#!/usr/bin/env node
// tasteful — scripts/crawl-cssda.mjs
// Crawl CSS Design Awards listings and emit candidate JSONL on stdout.
// Contract: docs/SCRIPTS.md → crawl-cssda.mjs. Stdlib only.

import { parseArgs, EXIT_OK, EXIT_FAIL, EXIT_USAGE, fail } from './lib/args.mjs';
import { log } from './lib/log.mjs';
import {
  politeFetch, robotsAllowed, canonicalUrl, hostKey, BlockedError,
  decodeEntities, textOf, slugTag, isoDate, today, isMain,
} from './lib/fetch.mjs';

const BASE = 'https://www.cssdesignawards.com';
export const COLLECTION_PATHS = {
  gallery: '/website-gallery',
  wotd: '/wotd-award-winners',
  wotm: '/wotm-award-winners',
};

const spec = {
  usage: 'crawl-cssda.mjs [--limit <n>] [--pages <n>] [--collections <list>] [--no-score]',
  description:
    'Crawl CSS Design Awards listings (1 req/s, robots.txt respected) and print candidate JSONL\n' +
    '{url, source, source_url, score, tags, award, date, title} on stdout; summary on stderr.\n' +
    'Collections: gallery, wotd, wotm. score = mean of the UI/UX/Innovation vote scores (0-10)\n' +
    'from the award page, falling back to the listing\'s JPANEL score.',
  flags: {
    limit: { type: 'number', help: 'Stop after n unique candidates' },
    pages: { type: 'number', default: 1, help: 'Listing pages per collection' },
    collections: { type: 'list', default: ['gallery', 'wotd', 'wotm'], help: 'Collections to crawl' },
    score: { type: 'boolean', default: true, help: 'Fetch each award page for scores and tags (--no-score skips)' },
  },
};

export function listingUrl(collection, page = 1) {
  return `${BASE}${COLLECTION_PATHS[collection]}?page=${page}`;
}

/** Year for a "OCT 24" listing date: this year unless that would be in the future. */
export function inferDate(monDay, now = new Date()) {
  const m = String(monDay ?? '').trim().match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})$/);
  if (!m) return null;
  const year = now.getFullYear();
  let d = isoDate(year, m[1], m[2]);
  if (d && d > today(new Date(now.getTime() + 86400000))) d = isoDate(year - 1, m[1], m[2]);
  return d;
}

function awardOf(category) {
  const c = slugTag(category);
  return c || null;
}

/** Parse a listing page (gallery / WOTD / WOTM) into cards. */
export function parseListing(html, now = new Date()) {
  const parts = html.split(/<article class="single-project[^"]*"[^>]*>/).slice(1);
  const cards = [];
  for (const raw of parts) {
    const chunk = raw.split(/<\/article>/)[0];
    // Award-page links: /sites/<slug>/<id>/ (gallery, WOTD) or /wotm/<slug>/<id>/ (WOTM).
    const sitePath = chunk.match(/<a href="(\/(?:sites|wotm|wotd)\/[^"]+)"\s+class="sp__full-size-link"/)?.[1]
      ?? chunk.match(/href="(\/(?:sites|wotm|wotd)\/[^"]+)"/)?.[1];
    if (!sitePath) continue;
    const external = chunk.match(/<a href="(https?:\/\/[^"]+)"[^>]*class="sp__project-link"/)?.[1] ?? null;
    const titleHtml = chunk.match(/class="single-project__title"[^>]*>([\s\S]*?)<\/h3>/)?.[1];
    const category = chunk.match(/class="sp__meta__category"[^>]*>([^<]*)</)?.[1];
    const dateRaw = chunk.match(/class="sp__meta__date"[^>]*>([^<]*)</)?.[1];
    const jpanel = chunk.match(/JPANEL\s*(\d{1,2}(?:\.\d+)?)/)?.[1];
    cards.push({
      sitePath,
      external: external ? decodeEntities(external) : null,
      title: titleHtml ? textOf(titleHtml) || null : null,
      award: category ? awardOf(category) : null,
      date: inferDate(dateRaw, now),
      jpanel: jpanel ? Number(jpanel) : null,
    });
  }
  return cards;
}

/** Parse an award page /sites/<slug>/<id>/. */
export function parseSitePage(html) {
  const out = { title: null, score: null, scores: {}, award: null, date: null, tags: [], external: null };
  const t = html.match(/<title>([\s\S]*?)<\/title>/)?.[1];
  if (t) out.title = textOf(t).replace(/\s+-\s+CSS Design Awards\s*$/i, '') || null;
  for (const m of html.matchAll(/class="vote__cat"[^>]*>([^<]+)<\/div>\s*<div class="vote__score"[^>]*>\s*<strong>\s*(\d{1,2}(?:\.\d+)?)\s*<\/strong>/g)) {
    out.scores[slugTag(m[1])] = Number(m[2]);
  }
  const vals = Object.values(out.scores).filter((v) => v >= 0 && v <= 10);
  if (vals.length) out.score = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
  const dm = html.match(/class="single-website__date"[^>]*>([^<]*)</);
  if (dm) {
    const txt = textOf(dm[1]);
    // "Website Of The Day 2026 Oct 24"; WOTM pages give only "Website Of The Month 2026 Sep" (→ day 01).
    const m = txt.match(/^(.*?)\s+(\d{4})\s+([A-Za-z]{3})[a-z]*(?:\s+(\d{1,2}))?/);
    if (m) {
      out.date = isoDate(m[2], m[3], m[4] ?? 1);
      const kind = m[1].toLowerCase();
      out.award = kind.includes('of the day') ? 'wotd' : kind.includes('of the month') ? 'wotm' : slugTag(m[1]) || null;
    }
  }
  const tagBlock = html.match(/<strong>\s*TAGS:\s*<\/strong>([\s\S]*?)<\/p>/i)?.[1] ?? '';
  out.tags = [...new Set([...tagBlock.matchAll(/<a[^>]*>([^<]+)<\/a>/g)].map((m) => slugTag(decodeEntities(m[1]))).filter(Boolean))];
  const ext = html.match(/<a href="(https?:\/\/[^"]+)"[^>]*class="single-website__thumbnail/)?.[1];
  out.external = ext ? decodeEntities(ext) : null;
  return out;
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2), spec);
  if (flags.limit !== undefined && !(flags.limit > 0)) fail('--limit must be a positive number');
  if (!(flags.pages >= 1)) fail('--pages must be >= 1');
  if (!flags.collections.length) fail('--collections is empty');
  for (const c of flags.collections) if (!COLLECTION_PATHS[c]) fail(`unknown collection "${c}" (expected gallery, wotd, wotm)`);

  const stats = { pages: 0, award_pages: 0, candidates: 0, duplicates: 0, robots_skipped: 0, no_external: 0, errors: 0 };
  const seen = new Set();
  let stopped = 'done';

  outer: for (const col of flags.collections) {
    for (let page = 1; page <= flags.pages; page++) {
      const url = listingUrl(col, page);
      try {
        if (!(await robotsAllowed(url))) {
          stats.robots_skipped++;
          log.warn(`robots.txt disallows ${url}; skipped`);
          break;
        }
        const res = await politeFetch(url);
        stats.pages++;
        if (res.status >= 400) {
          stats.errors++;
          log.warn(`${url} → HTTP ${res.status}`);
          break;
        }
        const cards = parseListing(await res.text());
        if (!cards.length) {
          log.warn(`${col} p${page}: 0 cards parsed from ${url} (layout changed?)`);
          break;
        }
        log.info(`${col} p${page}: ${cards.length} cards`);
        for (const card of cards) {
          const sourceUrl = canonicalUrl(new URL(card.sitePath, BASE).toString());
          // Skip the award-page fetch when the candidate is already a known duplicate.
          if (card.external && seen.has(hostKey(card.external))) {
            stats.duplicates++;
            continue;
          }
          let site = null;
          if (flags.score || !card.external) {
            if (!(await robotsAllowed(sourceUrl))) {
              stats.robots_skipped++;
            } else {
              try {
                const r = await politeFetch(sourceUrl);
                stats.award_pages++;
                if (r.status < 400) site = parseSitePage(await r.text());
                else stats.errors++;
              } catch (e) {
                if (e instanceof BlockedError) throw e;
                stats.errors++;
                log.warn(`${sourceUrl}: ${e.message}`);
              }
            }
          }
          const external = card.external ?? site?.external;
          let canon;
          try {
            canon = external ? canonicalUrl(external) : null;
          } catch {
            canon = null;
          }
          if (!canon) {
            stats.no_external++;
            continue;
          }
          const key = hostKey(canon);
          if (seen.has(key)) {
            stats.duplicates++;
            continue;
          }
          seen.add(key);
          process.stdout.write(
            JSON.stringify({
              url: canon,
              source: 'cssda',
              source_url: sourceUrl,
              score: site?.score ?? card.jpanel ?? null,
              tags: site?.tags ?? [],
              award: card.award ?? site?.award ?? null,
              date: site?.date ?? card.date ?? null,
              title: card.title ?? site?.title ?? null,
            }) + '\n',
          );
          stats.candidates++;
          if (flags.limit && stats.candidates >= flags.limit) {
            stopped = 'limit';
            break outer;
          }
        }
      } catch (e) {
        if (e instanceof BlockedError) {
          stopped = 'blocked';
          log.error(e.message);
          break outer;
        }
        stats.errors++;
        log.warn(`${url}: ${e.message}`);
      }
    }
  }

  log.info(
    `summary: pages fetched ${stats.pages}, award pages ${stats.award_pages}, candidates ${stats.candidates}, ` +
      `duplicates ${stats.duplicates}, skipped by robots ${stats.robots_skipped}, no external link ${stats.no_external}, ` +
      `errors ${stats.errors}, stopped: ${stopped}`,
  );
  process.exit(stats.candidates > 0 ? EXIT_OK : EXIT_FAIL);
}

if (isMain(import.meta.url)) {
  main().catch((e) => {
    log.error(e);
    process.exit(EXIT_USAGE);
  });
}
