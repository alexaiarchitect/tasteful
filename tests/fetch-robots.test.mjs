import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRobots, rulesFor, isAllowedBy, canonicalUrl, hostKey, createBucket } from '../scripts/lib/fetch.mjs';

const AWWWARDS = `
Sitemap: https://www.awwwards.com/sitemap.xml
User-agent: *
Disallow: /tag/
Disallow: /websites/?
Disallow: *favourites?page
Disallow: /*/likes$
Disallow: /elements/*

User-agent: dotbot
Disallow: /
`;

test('robots: prefix, literal ? and * wildcard', () => {
  const rules = rulesFor(parseRobots(AWWWARDS));
  assert.equal(isAllowedBy(rules, '/websites/sites_of_the_day/?page=2'), true);
  assert.equal(isAllowedBy(rules, '/websites/?page=2'), false);
  assert.equal(isAllowedBy(rules, '/tag/minimal'), false);
  assert.equal(isAllowedBy(rules, '/sites/brandon-yasin'), true);
  assert.equal(isAllowedBy(rules, '/user/favourites?page=3'), false);
  assert.equal(isAllowedBy(rules, '/elements/x'), false);
});

test('robots: $ anchors the end', () => {
  const rules = rulesFor(parseRobots(AWWWARDS));
  assert.equal(isAllowedBy(rules, '/someone/likes'), false);
  assert.equal(isAllowedBy(rules, '/someone/likes/more'), true);
});

test('robots: Allow wins by longest match, and ties go to Allow', () => {
  const rules = rulesFor(parseRobots('User-agent: *\nDisallow: /private\nAllow: /private/public\nDisallow: /x\nAllow: /x\n'));
  assert.equal(isAllowedBy(rules, '/private/secret'), false);
  assert.equal(isAllowedBy(rules, '/private/public/page'), true);
  assert.equal(isAllowedBy(rules, '/x'), true);
  const longer = rulesFor(parseRobots('User-agent: *\nAllow: /a\nDisallow: /a/b\n'));
  assert.equal(isAllowedBy(longer, '/a/b/c'), false);
  assert.equal(isAllowedBy(longer, '/a/c'), true);
});

test('robots: groups for other agents do not apply to *; shared group lines; empty Disallow', () => {
  const txt = 'User-agent: ClaudeBot\nUser-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nDisallow:\nDisallow: /search/*?*field=*\n';
  const groups = parseRobots(txt);
  assert.deepEqual(groups[0].agents, ['claudebot', 'gptbot']);
  const rules = rulesFor(groups);
  assert.equal(isAllowedBy(rules, '/'), true);
  assert.equal(isAllowedBy(rules, '/gallery/123/x'), true);
  assert.equal(isAllowedBy(rules, '/search/projects?field=product%20design'), false);
  assert.equal(isAllowedBy(rules, '/search/projects?q=x'), true);
  assert.equal(isAllowedBy(rulesFor(groups, ['gptbot']), '/'), false);
  assert.equal(isAllowedBy(rulesFor(parseRobots('')), '/anything'), true);
});

test('canonicalUrl strips tracking, hash and trailing slash; lowercases host', () => {
  assert.equal(canonicalUrl('https://WWW.Example.COM/Path/?utm_source=x&a=1&fbclid=z#top'), 'https://www.example.com/Path?a=1');
  assert.equal(canonicalUrl('https://example.com/a/b/'), 'https://example.com/a/b');
  assert.equal(canonicalUrl('https://example.com'), 'https://example.com/');
  assert.equal(canonicalUrl('https://example.com/?ref=awwwards'), 'https://example.com/');
});

test('hostKey drops scheme and www. only for dedupe', () => {
  assert.equal(hostKey('https://www.example.com/'), 'example.com');
  assert.equal(hostKey('http://example.com'), 'example.com');
  assert.equal(hostKey('https://example.com/work/'), 'example.com/work');
  assert.notEqual(hostKey('https://a.example.com'), hostKey('https://example.com'));
});

test('token bucket: same host spaced by 1 s, other hosts not delayed', async () => {
  const b = createBucket({ rps: 1 });
  const t0 = Date.now();
  await b.take('a.test');
  await b.take('b.test');
  const t1 = Date.now();
  assert.ok(t1 - t0 < 200, `other host delayed ${t1 - t0} ms`);
  await b.take('a.test');
  assert.ok(Date.now() - t0 >= 990, `second request after ${Date.now() - t0} ms`);
});

test('token bucket with fake clock', async () => {
  let now = 0;
  const sleeps = [];
  const b = createBucket({ rps: 2, now: () => now, sleep: async (ms) => { sleeps.push(ms); now += ms; } });
  await b.take('h');
  await b.take('h');
  await b.take('h');
  assert.deepEqual(sleeps, [500, 500]);
});
