"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useWs } from "@/providers/WebSocketProvider";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { formatDollars } from "@/lib/format";
import { formatRelativeTime } from "@/lib/portfolio";
import {
  APP_SHELL_PADDING_PX,
  fonts,
  type,
  type OracleTheme,
} from "@/lib/oracle-theme";
import { MarketImage } from "@/components/MarketImage";
import type { Market, WsServerMessage, Side } from "@/lib/types";

/* ------------------------------------------------------------------ *
 * SitewideTradeTape -- horizontal marquee across ALL markets (H1)
 *
 * Sits at the top of the home page, just below the centered logo.
 * Showcases Caster's 200ms block cadence as a "the chain is alive"
 * signal. Complements M1 (the per-market vertical tape on the market
 * page) -- they use the same flash token & dot-pulse animation for
 * visual consistency.
 *
 * WS strategy
 * -----------
 * Option A: subscribe to the `trades` channel once per market_id from
 * the provided `markets` list. The server `should_send` filter uses
 * a HashSet<u64> of subscribed market_ids, so fan-out is just repeated
 * `subscribe(["trades"], id)` calls on the same socket. Cheap under
 * ~20 markets. Revisit if we cross ~50.
 *
 * REST bootstrap is intentionally skipped -- that would be N endpoint
 * hits, and the empty state ("Waiting for live trades…") is short-
 * lived since the chain produces ~200ms blocks.
 *
 * Motion budget
 * -------------
 * Home page's one permitted moving element. We do NOT also pulse the
 * market cards on price change; this is the home-page motion budget.
 * - Horizontal translate animation pauses on :hover so users can read
 * - Newest row flashes `flashBg` for 150ms (same token as M1)
 * - reduced-motion: marquee disabled, flash disabled, rendered as a
 *   static newest-first horizontal list (no scroll, first 10 entries)
 *
 * Mobile: hidden under 480px via `.sitewide-trade-tape` media query.
 * ------------------------------------------------------------------ */

interface SitewideTrade {
  market_id: string;
  price: number;
  quantity: number;
  taker_side: Side;
  timestamp: string;
  /** Local monotonic id for React key stability when the same
   * timestamp arrives twice (different markets, same ms). */
  localId: number;
}

interface Props {
  markets: Market[];
  th: OracleTheme;
  /** Rows to keep in the DOM. Default 18 -- balances visual density
   * against DOM work on slow clients. */
  maxRows?: number;
}

const DEFAULT_MAX_ROWS = 18;
/** Period after which, if still empty, we stop showing the "Waiting…"
 * hint and just render an empty bar (accept the silence). */
const WAITING_HINT_MS = 5000;
/** Target scroll velocity in CSS px / second. Tuned so the slowest reader
 * can recognise a ticker item before it leaves the viewport while still
 * feeling like a live tape. Duration is computed at runtime as
 *   duration = measured_track_width_px / TAPE_PIXELS_PER_SECOND
 * where `measured_track_width_px` is the width of ONE copy of the row
 * strip (the track holds two copies end-to-end so the loop seams at
 * translateX(-50%)).
 *
 * NOTE: the effective on-screen velocity is 30 px/s only within the
 * clamp window [MIN_DURATION_S, MAX_DURATION_S] below. With a very short
 * strip (few rows) the min-duration clamp kicks in and the apparent
 * velocity falls below 30 px/s; with a very long strip the max-duration
 * clamp kicks in and it exceeds 30 px/s. The clamps trade strict pixel-
 * velocity invariance for "never feels too fast or too slow" UX. */
const TAPE_PIXELS_PER_SECOND = 30;
/** Clamp floors/ceilings on the computed scroll duration. See
 * TAPE_PIXELS_PER_SECOND comment for rationale. */
const MIN_DURATION_S = 20;
const MAX_DURATION_S = 240;
/** Fallback when the track hasn't been measured yet (no trades). A gentle
 * loop keeps the empty state from "snapping" to a new speed on first row. */
const DEFAULT_DURATION_S = 60;

export function SitewideTradeTape({
  markets,
  th,
  maxRows = DEFAULT_MAX_ROWS,
}: Props) {
  const { addListener, subscribe } = useWs();
  const reducedMotion = usePrefersReducedMotion();

  const [trades, setTrades] = useState<SitewideTrade[]>([]);
  const localIdRef = useRef(0);
  const [mountedAt] = useState(() => Date.now());
  const [, setTick] = useState(0);

  // Measured width of the "A" copy of the row strip (the track contains
  // A + B where B is an aria-hidden mirror). The duration is that width
  // divided by TAPE_PIXELS_PER_SECOND -- measuring keeps pixel velocity
  // constant as rows accumulate. See ResizeObserver effect below.
  const copyRef = useRef<HTMLDivElement | null>(null);
  const [copyWidthPx, setCopyWidthPx] = useState(0);

  // Build a lookup so each tape row can render its thumbnail + title
  // without another render pass through the markets array.
  const marketsById = useMemo(() => {
    const map = new Map<string, Market>();
    for (const m of markets) map.set(String(m.id), m);
    return map;
  }, [markets]);

  // Subscribe to trades across every known market. Re-runs if the
  // markets list grows (admin creates a new market).
  useEffect(() => {
    for (const m of markets) {
      if (m.status !== "Open") continue;
      subscribe(["trades"], String(m.id));
    }
  }, [markets, subscribe]);

  // WS listener -- append live trades, newest at the head.
  useEffect(() => {
    const remove = addListener((msg: WsServerMessage) => {
      if (msg.type !== "trade") return;
      const mid = String(msg.market_id);
      // Ignore trades for markets we don't have metadata for (shouldn't
      // happen since we only subscribed to known markets, but defensive).
      if (!marketsById.has(mid)) return;
      localIdRef.current += 1;
      setTrades((prev) => [
        {
          market_id: mid,
          price: msg.price,
          quantity: msg.quantity,
          taker_side: msg.taker_side,
          timestamp: msg.timestamp,
          localId: localIdRef.current,
        },
        ...prev.slice(0, maxRows - 1),
      ]);
    });
    return remove;
  }, [addListener, marketsById, maxRows]);

  // Refresh relative timestamps every 5s so "3s ago" doesn't freeze.
  useEffect(() => {
    const i = setInterval(() => setTick((t) => t + 1), 5000);
    return () => clearInterval(i);
  }, []);

  // Track the newest trade's localId so only the head row flashes on
  // arrival (not the whole strip on every render).
  const lastFlashedRef = useRef<number | null>(null);
  const [flashId, setFlashId] = useState<number | null>(null);
  useEffect(() => {
    if (trades.length === 0) return;
    const newest = trades[0].localId;
    if (newest === lastFlashedRef.current) return;
    if (lastFlashedRef.current !== null && !reducedMotion) {
      setFlashId(newest);
      const t = setTimeout(() => setFlashId(null), 220);
      lastFlashedRef.current = newest;
      return () => clearTimeout(t);
    }
    lastFlashedRef.current = newest;
  }, [trades, reducedMotion]);

  // Measure the first (non-mirrored) copy of the row strip so we can set
  // `animation-duration = width / 30px/s`. Mount-once: the ResizeObserver
  // itself catches every size change organically, so we deliberately do
  // NOT depend on trades.length -- tearing the observer down and rebuilding
  // it on every tape row update was causing potential animation restart
  // judder in Safari (each setCopyWidthPx re-serialised the duration style).
  // Font-load shifts are also handled by the observer, not the effect.
  // SSR-safe: guarded by `typeof window` so it's a no-op on the server.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const el = copyRef.current;
    if (!el) return;
    // Seed with current width so the first frame uses a sane duration.
    setCopyWidthPx(Math.max(1, el.getBoundingClientRect().width));
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        // contentBoxSize is better supported in modern browsers; fall back
        // to contentRect.width for older ones.
        const w =
          entry.contentBoxSize && entry.contentBoxSize[0]
            ? entry.contentBoxSize[0].inlineSize
            : entry.contentRect.width;
        // Floor at 1 to avoid divide-by-zero if the element is hidden.
        // Equality guard at sub-pixel precision: sub-pixel width jitter
        // (font metrics, subpixel layout) would otherwise re-serialize
        // the --sitewide-tape-duration style on every observer tick and
        // risk restarting the marquee animation in Safari.
        const next = Math.max(1, w);
        setCopyWidthPx((prev) => (Math.abs(prev - next) < 1 ? prev : next));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Compute duration in seconds from measured track width. Clamped to
  // [MIN_DURATION_S, MAX_DURATION_S] so a very short strip doesn't whip
  // across the viewport and a future large strip doesn't stall the tape
  // visibly. Within the clamp window the effective pixel velocity equals
  // TAPE_PIXELS_PER_SECOND (~30 px/s); outside it, the clamp wins.
  const scrollDurationS = useMemo(() => {
    if (copyWidthPx <= 0) return DEFAULT_DURATION_S;
    const raw = copyWidthPx / TAPE_PIXELS_PER_SECOND;
    return Math.min(MAX_DURATION_S, Math.max(MIN_DURATION_S, raw));
  }, [copyWidthPx]);

  const showWaiting =
    trades.length === 0 && Date.now() - mountedAt < WAITING_HINT_MS;
  const isEmpty = trades.length === 0;

  return (
    <div
      className="sitewide-trade-tape"
      aria-label="Sitewide live trades"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        // Full-bleed: the parent `appShell` has
        // `padding: APP_SHELL_PADDING_PX` and `overflowX: hidden`, so a
        // negative margin of exactly that padding lets the tape span the
        // full viewport edge-to-edge while the rest of the page content
        // stays inset. We add the same padding back on the horizontal
        // axis so the LIVE label and first row start aligned with the
        // rest of the page gutter. Importing the constant keeps this
        // coupling explicit -- change appShell's padding in one place
        // and the tape still stays flush.
        marginLeft: -APP_SHELL_PADDING_PX,
        marginRight: -APP_SHELL_PADDING_PX,
        background: th.surface,
        // Subtle top highlight gives the tape its own plane without a
        // hard separator line. Theme-provided: lighter in dark mode
        // (inner highlight), darker in light mode (inset shadow).
        boxShadow: th.tapeTopShadow,
        minHeight: 44,
        padding: `0 ${APP_SHELL_PADDING_PX}px`,
        overflow: "hidden",
        marginBottom: 24,
        ["--tape-flash-bg" as string]: th.flashBg,
      }}
    >
      {/* Leading "LIVE" label -- fixed, doesn't scroll. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          flexShrink: 0,
          paddingRight: 12,
          borderRight: `0.8px solid ${th.divider}`,
          height: 28,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            display: "inline-block",
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: th.accentFrom,
            animation: reducedMotion
              ? undefined
              : "liveDotPulse 2s ease-in-out infinite",
          }}
        />
        <span
          style={{
            ...type.metaLabel,
            color: th.textTertiary,
            letterSpacing: "0.15em",
          }}
        >
          Live
        </span>
      </div>

      {/* Viewport: holds the scrolling (or static, reduced-motion) row. */}
      <div
        style={{
          position: "relative",
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          height: 32,
        }}
      >
        {isEmpty ? (
          <div
            style={{
              ...type.metaLabel,
              color: th.textTertiary,
              lineHeight: "32px",
              fontStyle: showWaiting ? "italic" : "normal",
              opacity: showWaiting ? 1 : 0,
              transition: "opacity 400ms ease",
            }}
          >
            {showWaiting ? "Waiting for live trades…" : "\u00a0"}
          </div>
        ) : reducedMotion ? (
          // Reduced-motion fallback: static newest-first list, no scroll,
          // capped at 10 entries so the row doesn't overflow horizontally.
          <div
            style={{
              display: "flex",
              gap: 24,
              alignItems: "center",
              height: 32,
              overflowX: "auto",
            }}
          >
            {trades.slice(0, 10).map((t) => (
              <TapeRow
                key={t.localId}
                trade={t}
                market={marketsById.get(t.market_id)}
                th={th}
                flash={false}
              />
            ))}
          </div>
        ) : (
          // Marquee track: two copies of the list translate -50% so the
          // scroll loops seamlessly. `animation-play-state` is toggled to
          // `paused` on hover of the OUTER container via the CSS class
          // (see globals.css -- .sitewide-trade-tape:hover descendant).
          // Duration is driven by --sitewide-tape-duration, computed from
          // the measured width of the first copy so pixel velocity stays
          // at TAPE_PIXELS_PER_SECOND (~30 px/s) regardless of row count.
          <div
            className="sitewide-tape-track"
            style={{
              display: "flex",
              gap: 24,
              alignItems: "center",
              height: 32,
              width: "max-content",
              animationName: "sitewideTapeScroll",
              animationTimingFunction: "linear",
              animationIterationCount: "infinite",
              // animation-duration is set via CSS var so the globals.css
              // rule can provide a fallback and so the hover-pause rule
              // doesn't have to fight an inline shorthand.
              ["--sitewide-tape-duration" as string]: `${scrollDurationS}s`,
            }}
          >
            {/* Primary (measured) copy -- ref used by the ResizeObserver.
                flexShrink:0 prevents the track's flex layout from squeezing
                this group, which would throw off the width measurement. */}
            <div
              ref={copyRef}
              style={{
                display: "flex",
                gap: 24,
                alignItems: "center",
                flexShrink: 0,
              }}
            >
              {trades.map((t) => (
                <TapeRow
                  key={`a-${t.localId}`}
                  trade={t}
                  market={marketsById.get(t.market_id)}
                  th={th}
                  flash={flashId === t.localId}
                />
              ))}
            </div>
            {/* Mirror copy so the loop is seamless. aria-hidden because
                screen readers have already seen the real entries. */}
            <div
              aria-hidden="true"
              style={{
                display: "flex",
                gap: 24,
                alignItems: "center",
                flexShrink: 0,
              }}
            >
              {trades.map((t) => (
                <TapeRow
                  key={`b-${t.localId}`}
                  trade={t}
                  market={marketsById.get(t.market_id)}
                  th={th}
                  flash={false}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Row -- one tape entry. Memoized lightly: each row renders once per
 * incoming trade, and relative-time refreshes are cheap (a string +
 * a tabular-nums span). Going full React.memo here would cost more in
 * prop-compare than it saves.
 * ------------------------------------------------------------------ */
function TapeRow({
  trade,
  market,
  th,
  flash,
}: {
  trade: SitewideTrade;
  market: Market | undefined;
  th: OracleTheme;
  flash: boolean;
}) {
  const isBuy = trade.taker_side === "Buy";
  const priceDollars = trade.price / 1000;
  const notional = priceDollars * trade.quantity;
  const parsedMs = Date.parse(trade.timestamp);
  const ageLabel = Number.isFinite(parsedMs) ? formatRelativeTime(parsedMs) : "--";
  const title = market?.question ?? `Market #${trade.market_id}`;
  const sideLabel = `${isBuy ? "BUY" : "SELL"} YES`;

  // Real <Link> so the whole row is a bona fide link: right-click "open
  // in new tab" works, keyboard Tab+Enter works natively, and Next.js
  // can prefetch the market page. Styles below intentionally match the
  // prior div-role-button layout so the visual diff is zero.
  return (
    <Link
      href={`/market/${trade.market_id}`}
      prefetch={false}
      className="sitewide-tape-row"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        height: 28,
        padding: "0 10px",
        borderRadius: 2,
        cursor: "pointer",
        flexShrink: 0,
        // Flash the newest row on arrival. Keyframes in globals.css.
        animation: flash ? "tradeTapeFlash 150ms ease-out" : undefined,
      }}
      // aria-label: describe the trade itself; the <Link> role already
      // conveys clickability to screen readers, so "Open market" is noise.
      aria-label={`${sideLabel} on ${title} at ${(priceDollars * 100).toFixed(0)} cents for ${formatDollars(notional)}`}
    >
      <MarketImage
        src={market?.image_url}
        alt={title}
        size={20}
        radius={3}
        th={th}
      />
      <span
        style={{
          maxWidth: 220,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          fontFamily: fonts.sans,
          fontSize: 12,
          color: th.textPrimary,
        }}
      >
        {title}
      </span>
      <span
        style={{
          fontFamily: fonts.sans,
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.06em",
          color: isBuy ? th.yes : th.no,
          textTransform: "uppercase" as const,
        }}
      >
        {sideLabel}
      </span>
      <span
        style={{
          fontFamily: fonts.mono,
          fontSize: 12,
          fontVariantNumeric: "tabular-nums" as const,
          color: th.textPrimary,
        }}
      >
        {(priceDollars * 100).toFixed(0)}&cent;
      </span>
      <span
        style={{
          fontFamily: fonts.mono,
          fontSize: 11,
          fontVariantNumeric: "tabular-nums" as const,
          color: th.textSecondary,
        }}
      >
        {formatDollars(notional)}
      </span>
      <span
        style={{
          fontFamily: fonts.mono,
          fontSize: 10,
          fontVariantNumeric: "tabular-nums" as const,
          color: th.textTertiary,
          whiteSpace: "nowrap",
        }}
      >
        {ageLabel}
      </span>
    </Link>
  );
}
