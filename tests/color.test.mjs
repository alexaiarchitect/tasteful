import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseColor, toHex, luminance, contrastRatio, toOklch, fromOklch, nearestPassing } from '../scripts/lib/color.mjs';

test('parseColor: hex forms', () => {
  assert.deepEqual(parseColor('#fff'), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(parseColor('#0008'), { r: 0, g: 0, b: 0, a: 0.533 });
  assert.deepEqual(parseColor('#3B5BDB'), { r: 59, g: 91, b: 219, a: 1 });
  assert.deepEqual(parseColor('#3b5bdb80'), { r: 59, g: 91, b: 219, a: 0.502 });
  assert.equal(parseColor('#12345'), null);
});

test('parseColor: rgb/hsl/oklch', () => {
  assert.deepEqual(parseColor('rgb(20 20 30 / 0.04)'), { r: 20, g: 20, b: 30, a: 0.04 });
  assert.deepEqual(parseColor('rgba(255, 0, 0, 50%)'), { r: 255, g: 0, b: 0, a: 0.5 });
  assert.deepEqual(parseColor('rgb(100%, 50%, 0%)'), { r: 255, g: 128, b: 0, a: 1 });
  assert.deepEqual(parseColor('hsl(120 100% 25%)'), { r: 0, g: 128, b: 0, a: 1 });
  assert.deepEqual(parseColor('hsla(0, 100%, 50%, 0.5)'), { r: 255, g: 0, b: 0, a: 0.5 });
  assert.deepEqual(parseColor('oklch(62.8% 0.2577 29.23)'), { r: 255, g: 0, b: 0, a: 1 });
  assert.deepEqual(parseColor('oklch(1 0 0 / 0.5)'), { r: 255, g: 255, b: 255, a: 0.5 });
  assert.equal(parseColor('var(--color-bg)'), null);
  assert.equal(parseColor('color-mix(in oklab, red 50%, blue)'), null);
  assert.equal(parseColor('rebeccapurple-ish'), null);
});

test('toHex, luminance, contrastRatio', () => {
  assert.equal(toHex({ r: 59, g: 91, b: 219 }), '#3b5bdb');
  assert.equal(luminance(parseColor('#fff')), 1);
  assert.equal(luminance(parseColor('#000')), 0);
  assert.equal(contrastRatio(parseColor('#000'), parseColor('#fff')), 21);
  assert.equal(contrastRatio(parseColor('#767676'), parseColor('#fff')), 4.54);
  // reference theme
  assert.equal(contrastRatio(parseColor('#15171c'), parseColor('#f6f6f4')), 16.57);
  assert.equal(contrastRatio(parseColor('#a2aab6'), parseColor('#0d0f13')), 8.19);
});

test('oklch round trip', () => {
  for (const hex of ['#3b5bdb', '#f6f6f4', '#15171c', '#ff8a78', '#4fd1a0', '#000000', '#ffffff']) {
    assert.equal(toHex(fromOklch(toOklch(parseColor(hex)))), hex);
  }
  const o = toOklch(parseColor('#ffffff'));
  assert.ok(Math.abs(o.l - 1) < 1e-4 && o.c < 1e-4);
  // out of gamut is clipped, not wrapped
  const clipped = fromOklch({ l: 0.7, c: 0.5, h: 150 });
  for (const v of Object.values(clipped)) assert.ok(v >= 0 && v <= 255);
});

test('nearestPassing', () => {
  const bg = parseColor('#f6f6f4');
  const r = nearestPassing(parseColor('#9a9a9a'), bg, 4.5);
  assert.ok(r.ratio >= 4.5 && r.ratio < 4.7, JSON.stringify(r));
  assert.equal(contrastRatio(parseColor(r.hex), bg), r.ratio);
  // already passing → unchanged
  assert.equal(nearestPassing('#15171c', '#f6f6f4', 7).hex, '#15171c');
  // adjust the background instead
  const b = nearestPassing('#ffffff', '#6f8cff', 4.5, { adjust: 'bg' });
  assert.ok(b.ratio >= 4.5);
  assert.ok(luminance(parseColor(b.hex)) < luminance(parseColor('#6f8cff')));
  // impossible
  assert.equal(nearestPassing('#777777', '#777777', 22), null);
});
