"use client";

import { useEffect, useMemo, useState } from "react";
import { useTrades } from "@/hooks/useTrades";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { formatDollars } from "@/lib/format";
import { fonts, type, type OracleTheme } from "@/lib/oracle-theme";

/* ------------------------------------------------------------------ *
 * MarketLiveStats (M3)
 *
 * Compact strip of three client-side derived metrics for the market
 * page header:
 *
 *   (1) Last trade Xs ago   -- pulses accent color when < 30s; fades
 *                               to muted grey after 5 min. "--" when
 *                               we haven't seen any trades yet.
 *   (2) 1h volume           -- rolling 1-hour sum of trade notionals,
 *                               in dollars.
 *   (3) Active (5m)         -- count of distinct active takers in the
 *                               last 5 minutes. See "Known limitation"
 *                               below for why we key on taker_tx_hash
 *                               instead of buyer/seller address.
 *
 * All three are derived live from the same `trade` WS subscription
 * already powering the Live Tape (`useTrades(marketId)`), so there
 * are no extra network calls or backend changes required.
 *
 * "N active" -- distinct addresses, with staged fallbacks
 * --------------------------------------------------------
 * Once chain-engineer's WS migration lands, each `trade` event carries
 * `buyer` and `seller` hex addresses. We count the distinct union of
 * both in the 5m window -- the true "distinct participants" metric.
 *
 * During rollout, connected clients receive a mix of old (no
 * buyer/seller) and new events. For any trade where BOTH fields are
 * absent we fall back to the earlier `taker_tx_hash` proxy -- each tx
 * is submitted by a single trader, so distinct taker_tx_hash values
 * approximate distinct takers reasonably well. Trades without either
 * field (legacy REST bootstrap, pre-patch nodes) fall back once more
 * to a per-trade bucket, which slightly over-counts when several
 * trades share a second.
 *
 * Once every node reports buyer/seller the proxy fallback becomes
 * dead code, but keeping it costs nothing and is defensive against
 * missed edge cases (e.g. synthetic trades).
 * ------------------------------------------------------------------ */

interface Props {
  marketId: string;
  th: OracleTheme;
}

const ONE_HOUR_MS = 60 * 60 * 1000;
const FIVE_MIN_MS = 5 * 60 * 1000;

/** Compact duration formatter specific to the "last trade" position.
 *
 *   < 60s        -> "3s"
 *   < 60m        -> "2m"
 *   < 24h        -> "3h"
 *   >= 24h       -> "3d"
 *   null input   -> "—"
 */
function formatAge(diffMs: number | null): string {
  if (diffMs == null) return "\u2014";
  const sec = Math.max(0, Math.floor(diffMs / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}h`;
  const day = Math.floor(hour / 24);
  return `${day}d`;
}

export function MarketLiveStats({ marketId, th }: Props) {
  const trades = useTrades(marketId);
  const reducedMotion = usePrefersReducedMotion();

  // `now` ticks every second so the "last trade" age stays live even when
  // no new trades arrive. 1s is the right cadence for this single metric
  // (it switches from accent -> muted at the 30s boundary, so we need
  // sub-5s resolution around that threshold).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const derived = useMemo(() => {
    if (trades.length === 0) {
      return {
        lastTradeMs: null as number | null,
        oneHourVolumeDollars: 0,
        activeCount: 0,
      };
    }

    // Parse once; skip malformed entries so a single bad row doesn't
    // sink the whole panel.
    const parsed: {
      ts: number;
      price: number;
      qty: number;
      tx?: string;
      buyer?: string | null;
      seller?: string | null;
    }[] = [];
    for (const t of trades) {
      const ts = Date.parse(t.timestamp);
      if (!Number.isFinite(ts)) continue;
      parsed.push({
        ts,
        price: t.price,
        qty: t.quantity,
        tx: t.taker_tx_hash,
        buyer: t.buyer,
        seller: t.seller,
      });
    }
    if (parsed.length === 0) {
      return { lastTradeMs: null, oneHourVolumeDollars: 0, activeCount: 0 };
    }

    // useTrades returns newest-first; grab max just in case ordering ever
    // slips (cheap, O(n)).
    const newestTs = parsed.reduce((max, x) => (x.ts > max ? x.ts : max), parsed[0].ts);
    const lastTradeMs = now - newestTs;

    // 1h volume -- sum of (price_dollars * qty) for trades in the last hour.
    // price is ticks (0-1000), so price_dollars = price / 1000.
    const oneHourCutoff = now - ONE_HOUR_MS;
    let vol = 0;
    for (const x of parsed) {
      if (x.ts >= oneHourCutoff) {
        vol += (x.price / 1000) * x.qty;
      }
    }

    // 5m active -- distinct participant addresses (buyer ∪ seller) when the
    // event carries them; otherwise fall back to the taker_tx_hash proxy;
    // otherwise fall back once more to a per-trade bucket.
    // Addresses are lower-cased so "0xABC…" and "0xabc…" collapse.
    const fiveMinCutoff = now - FIVE_MIN_MS;
    const keys = new Set<string>();
    for (const x of parsed) {
      if (x.ts < fiveMinCutoff) continue;
      const hasBuyer = typeof x.buyer === "string" && x.buyer.length > 0;
      const hasSeller = typeof x.seller === "string" && x.seller.length > 0;
      if (hasBuyer || hasSeller) {
        if (hasBuyer) keys.add(`addr:${x.buyer!.toLowerCase()}`);
        if (hasSeller) keys.add(`addr:${x.seller!.toLowerCase()}`);
      } else if (x.tx) {
        keys.add(`tx:${x.tx}`);
      } else {
        keys.add(`legacy:${x.ts}:${x.price}`);
      }
    }

    return {
      lastTradeMs,
      oneHourVolumeDollars: vol,
      activeCount: keys.size,
    };
  }, [trades, now]);

  const lastTradeFresh = derived.lastTradeMs != null && derived.lastTradeMs < 30_000;
  const lastTradeStale = derived.lastTradeMs != null && derived.lastTradeMs >= 5 * 60_000;
  const lastTradeColor = lastTradeFresh
    ? th.accentFrom
    : lastTradeStale
      ? th.textTertiary
      : th.textSecondary;

  const dot = (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: lastTradeColor,
        flexShrink: 0,
        // Only pulse when the last trade is fresh; steady dot otherwise
        // to avoid competing with the chart for the motion budget.
        animation:
          lastTradeFresh && !reducedMotion
            ? "liveDotPulse 2s ease-in-out infinite"
            : undefined,
      }}
    />
  );

  const sep = (
    <span
      aria-hidden="true"
      style={{
        ...type.volumeLabel,
        color: th.textTertiary,
        padding: "0 2px",
      }}
    >
      &middot;
    </span>
  );

  return (
    <div
      aria-label="Market live stats"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 10,
        fontFamily: fonts.sans,
      }}
    >
      {/* Last trade age */}
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        {dot}
        <span style={{ ...type.volumeLabel, color: th.textTertiary }}>last trade</span>
        <span
          style={{
            ...type.monoSmall,
            color: lastTradeColor,
            fontSize: 11,
          }}
        >
          {derived.lastTradeMs == null ? "\u2014" : `${formatAge(derived.lastTradeMs)} ago`}
        </span>
      </span>

      {sep}

      {/* 1h volume */}
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span style={{ ...type.volumeLabel, color: th.textTertiary }}>1h vol</span>
        <span
          style={{
            ...type.monoSmall,
            color: th.textPrimary,
            fontSize: 11,
          }}
        >
          {derived.oneHourVolumeDollars > 0
            ? formatDollars(derived.oneHourVolumeDollars)
            : "\u2014"}
        </span>
      </span>

      {sep}

      {/* 5m active takers */}
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span style={{ ...type.monoSmall, color: th.textPrimary, fontSize: 11 }}>
          {derived.activeCount}
        </span>
        <span style={{ ...type.volumeLabel, color: th.textTertiary }}>active</span>
      </span>
    </div>
  );
}
