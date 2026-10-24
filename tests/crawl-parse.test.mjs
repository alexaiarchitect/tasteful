import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as aw from '../scripts/crawl-awwwards.mjs';
import * as cs from '../scripts/crawl-cssda.mjs';
import { pickExternal } from '../scripts/crawl-behance.mjs';

const html = (name) => readFileSync(new URL(`./fixtures/html/${name}`, import.meta.url), 'utf8');

test('awwwards listing: cards with slug, title, tags, external link, award, date', () => {
  const cards = aw.parseListing(html('awwwards-listing.html'));
  assert.equal(cards.length, 3);
  const [c] = cards;
  assert.equal(c.slug, 'brandon-yasin');
  assert.equal(c.title, 'Brandon Yasin');
  assert.equal(c.external, 'https://brandonyasin.com');
  assert.equal(c.award, 'sotd');
  assert.equal(c.date, '2026-10-24');
  assert.ok(c.tags.includes('web-interactive'), 'HTML-escaped tag decoded and slugged');
  assert.ok(c.tags.includes('minimal'));
  for (const card of cards) assert.match(card.external, /^https:\/\/(?!www\.awwwards)/);
});

test('awwwards award page: score, award, date, tags, external', () => {
  const s = aw.parseSitePage(html('awwwards-site.html'));
  assert.equal(s.title, 'Brandon Yasin');
  assert.equal(s.score, 7.31);
  assert.equal(s.award, 'sotd');
  assert.equal(s.date, '2026-10-24');
  assert.equal(s.external, 'https://brandonyasin.com');
  assert.ok(s.tags.includes('typography'));
});

test('awwwards award page without a score block → score null', () => {
  const s = aw.parseSitePage('<title>X - Awwwards</title><body><p>no score here</p></body>');
  assert.equal(s.score, null);
  assert.equal(s.title, 'X');
});

test('awwwards listing URLs map contract names', () => {
  assert.equal(aw.listingUrl('sotd'), 'https://www.awwwards.com/websites/sites_of_the_day/');
  assert.equal(aw.listingUrl('developer', 2), 'https://www.awwwards.com/websites/developer-award/?page=2');
  assert.equal(aw.listingUrl('e-commerce'), 'https://www.awwwards.com/websites/e-commerce/');
});

test('cssda gallery listing: nominee cards with external links', () => {
  const cards = cs.parseListing(html('cssda-gallery.html'), new Date('2026-10-24T12:00:00'));
  assert.equal(cards.length, 3);
  assert.deepEqual(cards[0], {
    sitePath: '/sites/hanusek-studio/50519/',
    external: 'https://www.hanusek.com',
    title: 'Hanusek Studio',
    award: 'nominee',
    date: '2026-10-24',
    jpanel: null,
  });
});

test('cssda WOTD listing carries the JPANEL score', () => {
  const cards = cs.parseListing(html('cssda-wotd.html'), new Date('2026-10-24T12:00:00'));
  assert.equal(cards[0].award, 'wotd');
  assert.equal(cards[0].jpanel, 8.04);
});

test('cssda award page: mean of UI/UX/Innovation scores, date, tags', () => {
  const s = cs.parseSitePage(html('cssda-site.html'));
  assert.equal(s.title, 'Half the Sky');
  assert.deepEqual(s.scores, { 'ui-design': 8.18, 'ux-design': 7.95, innovation: 8 });
  assert.equal(s.score, 8.04);
  assert.equal(s.award, 'wotd');
  assert.equal(s.date, '2026-10-24');
  assert.deepEqual(s.tags, ['grid', 'minimal', 'one-page']);
  assert.equal(s.external, 'https://halfthesky.app/');
});

test('cssda date inference rolls back a year for future month-days', () => {
  const now = new Date('2026-01-05T12:00:00');
  assert.equal(cs.inferDate('DEC 30', now), '2025-12-30');
  assert.equal(cs.inferDate('JAN 04', now), '2026-01-04');
  assert.equal(cs.inferDate('garbage', now), null);
});

test('behance: pickExternal prefers the website link and ignores Behance chrome', () => {
  const links = [
    { href: 'https://creativecommons.org/licenses/by-nc-nd/4.0/', text: 'Read More', chrome: true },
    { href: 'https://www.instagram.com/someone/', text: 'Instagram' },
    { href: 'https://studio.example.com/prints', text: 'Prints' },
    { href: 'https://studio.example.com/', text: 'Photography Website' },
    { href: 'https://www.behance.net/someone', text: 'Profile' },
  ];
  assert.equal(pickExternal(links), 'https://studio.example.com/');
  assert.equal(pickExternal([{ href: 'https://www.behance.net/x', text: 'x' }]), null);
});

test('cssda WOTM listing: cards link /wotm/<slug>/<id>/ award pages', () => {
  const cards = cs.parseListing(html('cssda-wotm.html'), new Date('2026-10-24T12:00:00'));
  assert.equal(cards.length, 3);
  assert.equal(cards[0].sitePath, '/wotm/farm-minerals/50091/');
  assert.equal(cards[0].external, 'https://www.farmminerals.com');
  assert.equal(cards[0].title, 'Farm Minerals');
  assert.equal(cards[0].award, 'wotm');
  assert.equal(cards[0].jpanel, 8.61);
  for (const c of cards) assert.match(c.sitePath, /^\/wotm\/[^/]+\/\d+\/$/);
});

test('cssda WOTM award page: month-only date, no vote scores (JPANEL fallback applies)', () => {
  const s = cs.parseSitePage(html('cssda-wotm-site.html'));
  assert.equal(s.award, 'wotm');
  assert.equal(s.date, '2026-09-01');
  assert.equal(s.score, null);
  assert.ok(s.tags.length > 0);
});
