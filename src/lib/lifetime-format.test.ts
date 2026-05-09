/**
 * Date / number formatting helpers used by the All-Time Stats card and
 * Lifetime Fills tab. Pure functions, easily unit-tested with the Node
 * test runner -- same harness as `portfolio.test.ts`.
 *
 * Run from the frontend directory with:
 *
 *   node --test src/lib/lifetime-format.test.ts
 */

import { test } from "node:test";
import assert from "node:assert";
import {
  formatRelativeAge,
  formatAbsoluteShort,
  formatFillTime,
  formatCompactUsd,
  formatPnlUsd,
  formatWinRate,
  formatCount,
} from "./lifetime-format.ts";

// Anchor "now" so tests are deterministic.
const NOW_MS = new Date("2026-04-24T12:00:00Z").getTime();

// ---- formatRelativeAge ----

test("relative age: under 60s -> just now", () => {
  assert.strictEqual(formatRelativeAge(NOW_MS - 30_000, NOW_MS), "just now");
  assert.strictEqual(formatRelativeAge(NOW_MS - 1_000, NOW_MS), "just now");
});

test("relative age: minutes", () => {
  assert.strictEqual(formatRelativeAge(NOW_MS - 5 * 60_000, NOW_MS), "5m ago");
  assert.strictEqual(formatRelativeAge(NOW_MS - 59 * 60_000, NOW_MS), "59m ago");
});

test("relative age: hours", () => {
  assert.strictEqual(formatRelativeAge(NOW_MS - 2 * 3_600_000, NOW_MS), "2h ago");
  assert.strictEqual(formatRelativeAge(NOW_MS - 23 * 3_600_000, NOW_MS), "23h ago");
});

test("relative age: days", () => {
  assert.strictEqual(formatRelativeAge(NOW_MS - 3 * 86_400_000, NOW_MS), "3d ago");
  assert.strictEqual(formatRelativeAge(NOW_MS - 6 * 86_400_000, NOW_MS), "6d ago");
});

test("relative age: weeks (singular vs plural)", () => {
  assert.strictEqual(formatRelativeAge(NOW_MS - 7 * 86_400_000, NOW_MS), "1 week ago");
  assert.strictEqual(formatRelativeAge(NOW_MS - 21 * 86_400_000, NOW_MS), "3 weeks ago");
});

test("relative age: months", () => {
  assert.strictEqual(formatRelativeAge(NOW_MS - 30 * 86_400_000, NOW_MS), "1 month ago");
  assert.strictEqual(formatRelativeAge(NOW_MS - 90 * 86_400_000, NOW_MS), "3 months ago");
});

test("relative age: years", () => {
  assert.strictEqual(formatRelativeAge(NOW_MS - 365 * 86_400_000, NOW_MS), "1 year ago");
  assert.strictEqual(formatRelativeAge(NOW_MS - 2 * 365 * 86_400_000, NOW_MS), "2 years ago");
});

test("relative age: invalid / sentinel timestamps -> --", () => {
  assert.strictEqual(formatRelativeAge(0, NOW_MS), "--");
  assert.strictEqual(formatRelativeAge(-1, NOW_MS), "--");
  assert.strictEqual(formatRelativeAge(Number.NaN, NOW_MS), "--");
});

// ---- formatAbsoluteShort ----

test("absolute short: stable format", () => {
  // April 24, 2026 14:23 UTC -> formatted in local timezone, but the
  // structure should remain "MMM D HH:MM"; we test by parsing back the
  // shape, not the exact local rendering.
  const ts = new Date("2026-04-24T14:23:00Z").getTime();
  const out = formatAbsoluteShort(ts);
  assert.match(out, /^[A-Z][a-z]{2} \d{1,2} \d{2}:\d{2}$/);
});

test("absolute short: rejects sentinels", () => {
  assert.strictEqual(formatAbsoluteShort(0), "--");
  assert.strictEqual(formatAbsoluteShort(-100), "--");
});

// ---- formatFillTime ----

test("fill time: < 24h uses relative", () => {
  assert.strictEqual(formatFillTime(NOW_MS - 5 * 60_000, NOW_MS), "5m ago");
  assert.strictEqual(formatFillTime(NOW_MS - 12 * 3_600_000, NOW_MS), "12h ago");
});

test("fill time: >= 24h falls back to absolute", () => {
  const ts = NOW_MS - 2 * 86_400_000;
  const out = formatFillTime(ts, NOW_MS);
  assert.match(out, /^[A-Z][a-z]{2} \d{1,2} \d{2}:\d{2}$/);
});

// ---- formatCompactUsd ----

test("compact USD: small values keep cents", () => {
  assert.strictEqual(formatCompactUsd(0), "$0.00");
  assert.strictEqual(formatCompactUsd(12.5), "$12.50");
  assert.strictEqual(formatCompactUsd(999.99), "$999.99");
  assert.strictEqual(formatCompactUsd(1234.56), "$1,234.56");
});

test("compact USD: K abbreviation kicks in at $10K", () => {
  assert.strictEqual(formatCompactUsd(9999.99), "$9,999.99");
  assert.strictEqual(formatCompactUsd(12_400), "$12.4K");
  assert.strictEqual(formatCompactUsd(523_500), "$523.5K");
});

test("compact USD: M abbreviation at $1M", () => {
  assert.strictEqual(formatCompactUsd(1_234_567), "$1.23M");
});

test("compact USD: negative numbers get a leading minus", () => {
  assert.strictEqual(formatCompactUsd(-12.5), "-$12.50");
  assert.strictEqual(formatCompactUsd(-12_400), "-$12.4K");
});

// ---- formatPnlUsd ----

test("PnL USD: zero shows $0.00 without sign", () => {
  assert.strictEqual(formatPnlUsd(0), "$0.00");
});

test("PnL USD: positive gets +", () => {
  assert.strictEqual(formatPnlUsd(123.45), "+$123.45");
  assert.strictEqual(formatPnlUsd(50_000), "+$50.0K");
});

test("PnL USD: negative gets -", () => {
  assert.strictEqual(formatPnlUsd(-123.45), "-$123.45");
});

// ---- formatWinRate ----

test("win rate: clean integer percentages", () => {
  assert.strictEqual(formatWinRate(0.6), "60%");
  assert.strictEqual(formatWinRate(0.5), "50%");
  assert.strictEqual(formatWinRate(1.0), "100%");
  assert.strictEqual(formatWinRate(0.0), "0%");
});

test("win rate: fractional gets one decimal", () => {
  assert.strictEqual(formatWinRate(0.667), "66.7%");
  assert.strictEqual(formatWinRate(0.333), "33.3%");
});

// ---- formatCount ----

test("count: < 10K is comma-grouped", () => {
  assert.strictEqual(formatCount(0), "0");
  assert.strictEqual(formatCount(42), "42");
  assert.strictEqual(formatCount(1_234), "1,234");
  assert.strictEqual(formatCount(9_999), "9,999");
});

test("count: K abbreviation at 10K", () => {
  assert.strictEqual(formatCount(12_400), "12.4K");
  assert.strictEqual(formatCount(523_500), "523.5K");
});

test("count: M abbreviation at 1M", () => {
  assert.strictEqual(formatCount(1_234_567), "1.2M");
});
