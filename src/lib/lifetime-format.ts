/**
 * Formatting helpers shared across the lifetime-analytics surface
 * (All-Time Stats card + Lifetime Fills tab + equity-curve placeholder).
 *
 * Kept separate from `lib/portfolio.ts` so the lifetime UI doesn't drag in
 * the cost-basis machinery, and so these helpers can be exercised in unit
 * tests without spinning up the full portfolio computation graph.
 */

/**
 * Coarse "human-friendly" elapsed string.
 *
 *   < 60s     -> "just now"
 *   < 60m     -> "5m ago"
 *   < 24h     -> "3h ago"
 *   < 7d      -> "2d ago"
 *   < 30d     -> "3 weeks ago" (rounded down)
 *   < 365d    -> "8 months ago"
 *   else      -> "2 years ago"
 *
 * `nowMs` is exposed for tests (defaults to `Date.now()`); callers in
 * production should always omit it.
 */
export function formatRelativeAge(timestampMs: number, nowMs: number = Date.now()): string {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return "--";
  const diffSec = Math.max(0, Math.floor((nowMs - timestampMs) / 1000));

  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  if (diffDay < 30) {
    const weeks = Math.floor(diffDay / 7);
    return weeks === 1 ? "1 week ago" : `${weeks} weeks ago`;
  }
  if (diffDay < 365) {
    const months = Math.floor(diffDay / 30);
    return months === 1 ? "1 month ago" : `${months} months ago`;
  }
  const years = Math.floor(diffDay / 365);
  return years === 1 ? "1 year ago" : `${years} years ago`;
}

/**
 * Compact absolute timestamp for the recent end of the spectrum.
 * Used as the secondary line on the lifetime fills row when the relative
 * age is "5h ago" but the user wants the actual time.
 *
 *   "Apr 24 14:23"   -- short month, no leading zero on day
 *
 * Locale: en-US for stability across deployments.
 */
export function formatAbsoluteShort(timestampMs: number): string {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return "--";
  const d = new Date(timestampMs);
  const month = d.toLocaleString("en-US", { month: "short" });
  const day = d.getDate();
  const hours = d.getHours().toString().padStart(2, "0");
  const mins = d.getMinutes().toString().padStart(2, "0");
  return `${month} ${day} ${hours}:${mins}`;
}

/**
 * "Smart" timestamp formatter for fill rows: short relative age for things
 * that happened within the last day, otherwise an absolute date.
 *
 * Threshold matches the chart's "All" zoom -- if the fill is recent enough
 * that scanning the equity curve would show it, present it relatively.
 */
export function formatFillTime(timestampMs: number, nowMs: number = Date.now()): string {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return "--";
  const ageMs = nowMs - timestampMs;
  if (ageMs < 24 * 60 * 60 * 1000) {
    return formatRelativeAge(timestampMs, nowMs);
  }
  return formatAbsoluteShort(timestampMs);
}

/**
 * Compact $ formatter that keeps the cents column for small values and
 * falls back to K/M abbreviations beyond $10K.
 *
 *   < $1K   -> "$1,234.56" (with cents)
 *   < $1M   -> "$12.4K"
 *   else    -> "$2.3M"
 *
 * Negative numbers get a leading minus sign (no parens, no accounting
 * style -- portfolio P&L uses an explicit sign so red == loss is obvious).
 */
export function formatCompactUsd(usd: number): string {
  if (!Number.isFinite(usd)) return "--";
  const sign = usd < 0 ? "-" : "";
  const abs = Math.abs(usd);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Signed P&L variant of `formatCompactUsd` -- always shows a sign on
 * positive values so the row reads as a delta, not a balance. */
export function formatPnlUsd(usd: number): string {
  if (!Number.isFinite(usd)) return "--";
  if (usd === 0) return "$0.00";
  const sign = usd > 0 ? "+" : "-";
  return `${sign}${formatCompactUsd(Math.abs(usd)).replace(/^-/, "")}`;
}

/**
 * Win-rate (0..1) -> "60%" / "60.0%" depending on whether the result is a
 * round percentage. Trims to a clean integer when possible so the card
 * doesn't read "60.0%" when "60%" suffices.
 */
export function formatWinRate(rate: number): string {
  if (!Number.isFinite(rate)) return "--";
  const pct = rate * 100;
  if (Math.abs(pct - Math.round(pct)) < 0.05) {
    return `${Math.round(pct)}%`;
  }
  return `${pct.toFixed(1)}%`;
}

/** Compact integer formatter for fills count / market count. */
export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return "--";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("en-US");
}
