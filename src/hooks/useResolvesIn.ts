"use client";

import { useEffect, useState } from "react";

export type Urgency = "resolved" | "critical" | "warning" | "default" | "none";

export interface ResolvesInState {
  /** Pre-formatted countdown string, e.g. "6d 14h", "14h 22m", "37m".
   * `null` when no timestamp is available or the market is resolved. */
  label: string | null;
  /** Urgency bucket for styling:
   *   - "resolved"  : market already closed/resolved
   *   - "critical"  : <1h remaining (red + pulse)
   *   - "warning"   : <24h remaining (amber)
   *   - "default"   : >24h remaining (muted)
   *   - "none"      : no timestamp -- caller should hide the chip
   */
  urgency: Urgency;
  /** Milliseconds remaining, negative when past due. `null` when unknown. */
  msRemaining: number | null;
}

/**
 * Format a non-negative millisecond delta into a compact countdown string.
 *
 *   >= 24h       -> "Nd Nh"  (e.g. "6d 14h")
 *   1h - 24h     -> "Nh Nm"  (e.g. "14h 22m")
 *   < 1h         -> "Nm"     (e.g. "37m")
 *   < 1m         -> "<1m"
 */
function formatCountdown(ms: number): string {
  if (ms <= 0) return "<1m";
  const totalMinutes = Math.floor(ms / 60_000);
  const totalHours = Math.floor(totalMinutes / 60);
  const days = Math.floor(totalHours / 24);

  if (days >= 1) {
    const hours = totalHours - days * 24;
    return `${days}d ${hours}h`;
  }
  if (totalHours >= 1) {
    const minutes = totalMinutes - totalHours * 60;
    return `${totalHours}h ${minutes}m`;
  }
  if (totalMinutes >= 1) return `${totalMinutes}m`;
  return "<1m";
}

/**
 * Countdown hook that drives the "Resolves in …" chip on market cards and
 * the market page header. Ticks every 60s (the minute is the smallest unit
 * we render), which is also why we don't wake up at 1Hz -- it wastes battery
 * on every open tab and every market card on the home page.
 *
 * Shared between `MarketCard` (home) and `MarketHeader` (market page) so the
 * two placements stay in lock-step on format and urgency thresholds.
 *
 * @param resolvesAtMs  Unix epoch millis when the market resolves.
 *                      Pass `null`/`undefined` when the backend hasn't
 *                      exposed a resolution timestamp yet -- the hook
 *                      returns `{label: null, urgency: "none"}` so the
 *                      caller can render nothing.
 * @param isResolved    Optional flag -- when the market status is already
 *                      terminal (Resolved/Closed) we bypass the countdown
 *                      and report the resolved urgency.
 */
export function useResolvesIn(
  resolvesAtMs: number | null | undefined,
  isResolved = false,
): ResolvesInState {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (resolvesAtMs == null || isResolved) return;
    // Align to the top of the next minute so all chips on the page tick
    // together (rather than drifting based on mount order).
    const msToNextMinute = 60_000 - (Date.now() % 60_000);
    let interval: ReturnType<typeof setInterval> | undefined;
    const timeout = setTimeout(() => {
      setNow(Date.now());
      interval = setInterval(() => setNow(Date.now()), 60_000);
    }, msToNextMinute);
    return () => {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
    };
  }, [resolvesAtMs, isResolved]);

  if (isResolved) {
    return { label: null, urgency: "resolved", msRemaining: null };
  }
  if (resolvesAtMs == null) {
    return { label: null, urgency: "none", msRemaining: null };
  }

  const msRemaining = resolvesAtMs - now;
  if (msRemaining <= 0) {
    // Past due but not yet resolved in state -- treat as critical rather than
    // "resolved" so the chip still shows something actionable. Once the
    // backend flips status to Resolved, `isResolved` will take over.
    return { label: "<1m", urgency: "critical", msRemaining };
  }

  const ONE_HOUR = 60 * 60 * 1000;
  const ONE_DAY = 24 * ONE_HOUR;
  let urgency: Urgency = "default";
  if (msRemaining < ONE_HOUR) urgency = "critical";
  else if (msRemaining < ONE_DAY) urgency = "warning";

  return {
    label: formatCountdown(msRemaining),
    urgency,
    msRemaining,
  };
}
