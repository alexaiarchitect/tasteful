#!/usr/bin/env node
// tasteful — scripts/crawl-awwwards.mjs
// Crawl Awwwards collection listings and emit candidate JSONL on stdout.
// Contract: docs/SCRIPTS.md → crawl-awwwards.mjs. Stdlib only.

import { parseArgs, EXIT_OK, EXIT_FAIL, EXIT_USAGE, fail } from './lib/args.mjs';
import { log } from './lib/log.mjs';
import {
  politeFetch, robotsAllowed, canonicalUrl, hostKey, BlockedError,
  decodeEntities, textOf, slugTag, isoDate, isMain,
} from './lib/fetch.mjs';

const BASE = 'https://www.awwwards.com';
export const COLLECTION_PATHS = {
  sotd: 'sites_of_the_day',
  sotm: 'sites_of_the_month',
  developer: 'developer-award',
};
const DEFAULT_COLLECTIONS = ['sotd', 'sotm', 'developer', 'minimal', 'typography', 'portfolio', 'e-commerce', 'editorial', 'startup'];
const SOCIAL = /(^|\.)(twitter|x|facebook|linkedin|instagram|pinterest|youtube|vimeo|tiktok|dribbble|behance|github|threads)\.(com|net)$|(^|\.)(t\.me|youtu\.be)$/;
const AWARD_RANK = ['sotm', 'sotd', 'developer', 'honorable', 'nominee'];

const spec = {
  usage: 'crawl-awwwards.mjs [--limit <n>] [--pages <n>] [--collections <list>] [--no-score]',
  description:
    'Crawl Awwwards award collections (1 req/s, robots.txt respected) and print candidate JSONL\n' +
    '{url, source, source_url, score, tags, award, date, title} on stdout; summary on stderr.\n' +
    'Collections: sotd, sotm, developer, or any tag collection slug (minimal, typography, ...).',
  flags: {
    limit: { type: 'number', help: 'Stop after n unique candidates' },
    pages: { type: 'number', default: 1, help: 'Listing pages per collection' },
    collections: { type: 'list', default: DEFAULT_COLLECTIONS, help: 'Collections to crawl' },
    score: { type: 'boolean', default: true, help: 'Fetch each award page for its score (--no-score skips; score: null)' },
  },
};

export function listingUrl(collection, page = 1) {
  const path = COLLECTION_PATHS[collection] ?? collection;
  return `${BASE}/websites/${path}/` + (page > 1 ? `?page=${page}` : '');
}

function awardFromBadge(b) {
  const k = b.toLowerCase();
  if (k === 'sotd' || k === 'sotm') return k;
  if (k === 'dev' || k === 'developer') return 'developer';
  if (k === 'hm' || k === 'honorable' || k.startsWith('honor')) return 'honorable';
  if (k.startsWith('nomin')) return 'nominee';
  return null;
}

function bestAward(list) {
  for (const a of AWARD_RANK) if (list.includes(a)) return a;
  return null;
}

function firstExternalHref(chunk) {
  for (const m of chunk.matchAll(/href="(https?:\/\/[^"]+)"/g)) {
    const href = decodeEntities(m[1]);
    let host;
    try {
      host = new URL(href).hostname;
    } catch {
      continue;
    }
    if (/(^|\.)awwwards\.com$/.test(host)) continue;
    if (SOCIAL.test(host)) continue;
    return href;
  }
  return null;
}

/** Parse a collection listing page into cards. */
export function parseListing(html) {
  const marker = 'data-collectable-model-value="';
  const starts = [];
  for (let i = html.indexOf(marker); i !== -1; i = html.indexOf(marker, i + 1)) starts.push(i);
  const cards = [];
  starts.forEach((start, idx) => {
    const chunk = html.slice(start, starts[idx + 1] ?? html.length);
    const raw = chunk.slice(marker.length, chunk.indexOf('"', marker.length));
    let model;
    try {
      model = JSON.parse(decodeEntities(raw));
    } catch {
      return;
    }
    if (model.type && model.type !== 'submission') return;
    const slug = model.slug ?? chunk.match(/href="\/sites\/([^"/?#]+)"/)?.[1];
    if (!slug) return;
    const awards = [...chunk.matchAll(/budget-tag--([a-z]+)/g)].map((m) => awardFromBadge(m[1])).filter(Boolean);
    let date = null;
    const dm = chunk.match(/Site Of The (?:Day|Month)[\s\S]{0,200}?([A-Z][a-z]{2}) (\d{1,2}), (\d{4})/);
    if (dm) date = isoDate(dm[3], dm[1], dm[2]);
    if (!date && model.createdAt) date = new Date(model.createdAt * 1000).toISOString().slice(0, 10);
    cards.push({
      slug,
      title: decodeEntities(model.title ?? model.collectableTitle ?? '') || null,
      tags: (model.tags ?? []).map((t) => slugTag(decodeEntities(t))).filter(Boolean),
      external: firstExternalHref(chunk),
      award: bestAward(awards),
      date,
    });
  });
  return cards;
}

/** Parse an award page /sites/<slug>. All fields may be null. */
export function parseSitePage(html) {
  const out = { title: null, score: null, award: null, date: null, tags: [], external: null };
  const titleRaw = html.match(/<title>([\s\S]*?)<\/title>/)?.[1];
  if (titleRaw) {
    const t = textOf(titleRaw);
    const m = t.match(/^(.*?)\s+-\s+Awwwards(?:\s+(SOTD|SOTM|Nominee|Honorable Mention|HM))?\s*$/i);
    out.title = m ? m[1] : t;
    if (m?.[2]) out.award = awardFromBadge(m[2].split(' ')[0]);
  }
  // Score: the header badge "<div class="box-score__note"><strong>7.31</strong>",
  // then the "SOTD / SCORE → 7.31" heading, then a number near the first score
  // class outside <style>.
  const body = html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
  let sm = body.match(/class="box-score__note"[^>]*>\s*<strong>\s*(\d{1,2}(?:\.\d{1,2})?)\s*<\/strong>/);
  if (!sm) sm = body.match(/class="c-heading-score__note"[^>]*>[^0-9<]*(\d{1,2}\.\d{1,2})/);
  if (!sm) {
    const i = body.search(/class="[^"]*score/);
    if (i !== -1) sm = body.slice(i, i + 400).match(/\b(\d\.\d{2})\b/);
  }
  if (sm) {
    const v = Number(sm[1]);
    if (v >= 0 && v <= 10) out.score = v;
  }
  const hm = body.match(/(Site of the Day|Site of the Month|Honorable Mention|Nominee|Developer Award)\s*-\s*([A-Z][a-z]{2})[a-z]* (\d{1,2}), (\d{4})/);
  if (hm) {
    const kind = { 'Site of the Day': 'sotd', 'Site of the Month': 'sotm', 'Honorable Mention': 'honorable', Nominee: 'nominee', 'Developer Award': 'developer' }[hm[1]];
    out.award ??= kind;
    out.date = isoDate(hm[4], hm[2], hm[3]);
  }
  out.tags = [...body.matchAll(/<a href="\/websites\/([a-z0-9-]+)\/" class="button[^"]*button--tag/g)].map((m) => m[1]);
  out.tags = [...new Set(out.tags)];
  // The "visit site" button in the header toolbar; fall back to the first external link.
  const visit = body.match(/<a class="toolbar-bts__item" href="(https?:\/\/[^"]+)"/);
  out.external = visit ? decodeEntities(visit[1]) : firstExternalHref(body);
  return out;
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2), spec);
  if (flags.limit !== undefined && !(flags.limit > 0)) fail('--limit must be a positive number');
  if (!(flags.pages >= 1)) fail('--pages must be >= 1');
  const collections = flags.collections;
  if (!collections.length) fail('--collections is empty');
  for (const c of collections) if (!/^[a-z0-9_-]+$/.test(c)) fail(`invalid collection "${c}"`);

  const stats = { pages: 0, award_pages: 0, candidates: 0, duplicates: 0, robots_skipped: 0, no_external: 0, errors: 0 };
  const seen = new Set();
  let stopped = 'done';
  const emit = (c) => process.stdout.write(JSON.stringify(c) + '\n');

  outer: for (const col of collections) {
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
        log.info(`${col} p${page}: ${cards.length} cards`);
        if (!cards.length) break;
        for (const card of cards) {
          const sourceUrl = `${BASE}/sites/${card.slug}`;
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
          if (!external) {
            stats.no_external++;
            continue;
          }
          let canon;
          try {
            canon = canonicalUrl(external);
          } catch {
            stats.no_external++;
            continue;
          }
          const key = hostKey(canon);
          if (seen.has(key)) {
            stats.duplicates++;
            continue;
          }
          seen.add(key);
          emit({
            url: canon,
            source: 'awwwards',
            source_url: sourceUrl,
            score: flags.score ? site?.score ?? null : null,
            tags: card.tags.length ? card.tags : site?.tags ?? [],
            award: card.award ?? site?.award ?? null,
            date: site?.date ?? card.date ?? null,
            title: card.title ?? site?.title ?? null,
          });
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
