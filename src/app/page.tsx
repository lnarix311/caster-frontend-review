"use client";

import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import Link from "next/link";
import * as api from "@/lib/api";
import type { Market } from "@/lib/types";
import { useAccount } from "@/providers/AccountProvider";
import { useTheme } from "@/providers/ThemeProvider";
import { useWs } from "@/providers/WebSocketProvider";
import type { WsServerMessage } from "@/lib/types";
import {
  APP_SHELL_PADDING_PX,
  fonts,
  lightTheme,
  darkTheme,
  type,
  type OracleTheme,
  ticksToPct,
} from "@/lib/oracle-theme";
import {
  useSynopticFeed,
  formatRelativeTime,
  SYNOPTIC_STREAMS,
  type SynopticItem,
} from "@/hooks/useSynopticFeed";
import { MarketImage } from "@/components/MarketImage";
import { ConditionalBadge } from "@/components/ConditionalBadge";
import { ResolvesInChip } from "@/components/ResolvesInChip";
import { SitewideTradeTape } from "@/components/trading/SitewideTradeTape";
import { formatDollars } from "@/lib/format";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

// =============================================================================
// Styles (ported from prototype App.jsx getStyles)
// =============================================================================

function getStyles(th: OracleTheme) {
  return {
    grainOverlay: {
      position: 'fixed' as const,
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      pointerEvents: 'none' as const,
      zIndex: 9999,
      opacity: th.grain,
      backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
    },
    appShell: {
      display: 'flex' as const,
      flexDirection: 'column' as const,
      // Shared with SitewideTradeTape's inverse negative margin so the
      // tape can span edge-to-edge. See APP_SHELL_PADDING_PX in
      // oracle-theme.ts.
      padding: `${APP_SHELL_PADDING_PX}px`,
      minHeight: '100vh',
      backgroundColor: th.bg,
      color: th.textPrimary,
      fontFamily: fonts.sans,
      WebkitFontSmoothing: 'antialiased',
      overflowX: 'hidden' as const,
      transition: 'background-color 0.3s, color 0.3s',
    },
    metaLabel: {
      fontSize: '10px',
      textTransform: 'uppercase' as const,
      letterSpacing: '0.15em',
      color: th.textSecondary,
      fontWeight: 500,
      fontFamily: fonts.sans,
    },
    main: {
      display: 'grid' as const,
      gridTemplateColumns: '1fr 340px',
      gap: '48px',
      paddingTop: '40px',
    },
    filterNav: {
      display: 'flex' as const,
      gap: '20px',
      marginBottom: '40px',
    },
    filterItem: (active: boolean) => ({
      fontSize: '11px',
      textTransform: 'uppercase' as const,
      letterSpacing: '0.1em',
      paddingBottom: '4px',
      cursor: 'pointer' as const,
      borderBottom: active ? `1px solid ${th.textPrimary}` : '1px solid transparent',
      color: active ? th.textPrimary : th.textSecondary,
      transition: 'color 0.2s, border-color 0.2s',
      fontFamily: fonts.sans,
    }),
    marketList: {
      display: 'flex' as const,
      flexDirection: 'column' as const,
      gap: '32px',
    },
    marketCard: {
      borderBottom: `0.8px solid ${th.border}`,
      paddingBottom: '24px',
      display: 'flex' as const,
      flexDirection: 'column' as const,
      transition: 'opacity 0.2s ease',
      cursor: 'default' as const,
    },
    marketTitle: {
      fontFamily: fonts.serif,
      fontSize: '24px',
      lineHeight: 1.2,
      margin: '12px 0 20px 0',
      maxWidth: '90%',
      cursor: 'pointer' as const,
      fontWeight: 400,
      color: th.textPrimary,
      textDecoration: 'none' as const,
    },
    marketMeta: {
      display: 'flex' as const,
      gap: '24px',
    },
    statItem: {
      display: 'flex' as const,
      flexDirection: 'column' as const,
      gap: '4px',
    },
    statValue: {
      fontFamily: fonts.mono,
      fontSize: '14px',
      fontWeight: 500,
      color: th.textPrimary,
    },
    probabilityBar: {
      height: '4px',
      width: '100%',
      background: th.probBarBg,
      marginTop: '8px',
      position: 'relative' as const,
    },
    probabilityFill: (pct: number) => ({
      position: 'absolute' as const,
      left: 0,
      top: 0,
      height: '100%',
      width: `${pct}%`,
      background: th.probFillGrad,
    }),
    footer: {
      marginTop: 'auto',
      paddingTop: '60px',
      display: 'flex' as const,
      justifyContent: 'space-between' as const,
    },
  };
}

// =============================================================================
// Data helpers
// =============================================================================

interface PriceData {
  bid: number | null;
  ask: number | null;
}

interface StatsData {
  totalVolume: number;
  totalTrades: number;
  uniqueTraders: number;
}

/**
 * Shared "last trade seen" record per market_id. Populated by a single
 * WS listener at the page level (which piggybacks on the subscriptions
 * the SitewideTradeTape already opened -- see comment in MarketsPage).
 *
 *   ts      -- epoch millis of the newest trade we've observed
 *   localId -- monotonic counter so MarketCard can detect a change
 *              (ts-only would dedupe on same-millisecond trades)
 */
interface LastTrade {
  ts: number;
  localId: number;
}

/** Short, compact age label for the per-card last-trade indicator.
 * Mirrors `formatAge` in MarketLiveStats.tsx -- kept local rather than
 * shared so the home-page copy doesn't need to import from a market-
 * page component. */
function formatCardAge(diffMs: number): string {
  const sec = Math.max(0, Math.floor(diffMs / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}min`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}h`;
  const day = Math.floor(hour / 24);
  return `${day}d`;
}

async function fetchMidPrice(marketId: string): Promise<PriceData> {
  try {
    const book = await api.getOrderbook(marketId);
    const bestBid = book.bids.length > 0 ? Math.max(...book.bids.map((b) => b.price)) : null;
    const bestAsk = book.asks.length > 0 ? Math.min(...book.asks.map((a) => a.price)) : null;
    return { bid: bestBid, ask: bestAsk };
  } catch {
    return { bid: null, ask: null };
  }
}

async function fetchStats(marketId: string): Promise<StatsData | null> {
  try {
    const stats = await api.getMarketStats(marketId);
    return {
      totalVolume: stats.total_notional,
      totalTrades: stats.total_trades,
      uniqueTraders: stats.unique_traders,
    };
  } catch {
    return null;
  }
}

function formatVolume(rawNotional: number): string {
  // rawNotional is in tick-shares (price_ticks * shares); divide by 1000
  // to get dollars. Delegate compact formatting to the shared helper.
  return formatDollars(rawNotional / 1000);
}

const filters = ['All Markets', 'Politics', 'Economics', 'Science', 'Culture'];

// =============================================================================
// Components
// =============================================================================

function MarketCard({
  market,
  prices,
  stats: marketStats,
  parentQuestion,
  lastTrade,
  now,
  delta24h,
  reducedMotion,
  styles,
  th,
}: {
  market: Market;
  prices?: PriceData;
  stats?: StatsData;
  /** Parent market question, resolved by the page from the live markets list.
   * Used by the Conditional badge tooltip; falls back to "market #<id>" when
   * unknown (shouldn't happen since children + parent always co-exist). */
  parentQuestion?: string | null;
  /** Most recent trade (across both REST bootstrap + WS) for this market.
   * `undefined` when we've never seen a trade; card shows "--" then. */
  lastTrade?: LastTrade;
  /** Shared `now` tick (epoch ms) from the page, refreshed ~every 1s.
   * Keeps the age label live without each card owning its own setInterval. */
  now: number;
  /** 24h price delta in percentage points (signed). `null` when we couldn't
   * source a 24h-ago price (e.g. brand-new market, candles endpoint failed).
   * When `null` the pill is simply not rendered. */
  delta24h: number | null;
  reducedMotion: boolean;
  styles: ReturnType<typeof getStyles>;
  th: OracleTheme;
}) {
  const [hovered, setHovered] = useState(false);
  // Fallback chain: midpoint if both sides exist, else whichever side exists, else null
  const mid =
    prices?.bid != null && prices?.ask != null
      ? (prices.bid + prices.ask) / 2
      : prices?.bid ?? prices?.ask ?? null;
  const yesPercent = mid != null ? ticksToPct(mid) : null;
  const noPercent = yesPercent != null ? 100 - yesPercent : null;
  const volume = marketStats ? formatVolume(marketStats.totalVolume) : "--";
  const isConditional = market.parent_market_id != null;

  // --- Per-card pulse on new trade --------------------------------------
  // We watch `lastTrade.localId` (not `lastTrade.ts`, which can repeat
  // across same-millisecond trades). When it changes, we briefly apply
  // the marketCardPulse animation. Gated off under prefers-reduced-motion.
  const [pulseKey, setPulseKey] = useState(0);
  const prevLocalIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (!lastTrade) return;
    const prev = prevLocalIdRef.current;
    prevLocalIdRef.current = lastTrade.localId;
    // Skip the very first observation: this is just the card learning
    // about an existing trade (REST bootstrap or pre-mount WS replay),
    // not a fresh trade arriving while the user is looking.
    if (prev === null) return;
    if (prev === lastTrade.localId) return;
    if (reducedMotion) return;
    setPulseKey((k) => k + 1);
  }, [lastTrade, reducedMotion]);

  // --- Last-trade age + color tiers -------------------------------------
  const ageMs = lastTrade ? now - lastTrade.ts : null;
  const ageFresh = ageMs != null && ageMs < 30_000;
  const ageStale = ageMs != null && ageMs >= 5 * 60_000;
  const ageColor = ageFresh
    ? th.accentFrom
    : ageStale
      ? th.textTertiary
      : th.textSecondary;

  // --- Δ24h pill color --------------------------------------------------
  const deltaPositive = delta24h != null && delta24h > 0;
  const deltaNegative = delta24h != null && delta24h < 0;
  const deltaColor = deltaPositive ? th.yes : deltaNegative ? th.no : th.textTertiary;
  const deltaBg = deltaPositive ? th.yesDim : deltaNegative ? th.noDim : "transparent";

  return (
    <div
      // `key={pulseKey}` on the wrapper would remount the whole card on
      // every trade -- we don't want that. Instead, apply the animation
      // to an overlay div (below) that IS keyed off pulseKey, so each
      // trade retriggers the keyframe cleanly.
      style={{
        ...styles.marketCard,
        opacity: hovered ? 0.85 : 1,
        position: 'relative' as const,
        // Same CSS custom property the TradeTape uses, so the pulse
        // picks up the theme-aware flash color without a prop drill.
        ["--tape-flash-bg" as string]: th.flashBg,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Pulse overlay -- absolutely positioned, pointer-events:none so it
          doesn't swallow clicks on the title/thumbnail links. `key` is
          bumped on each new trade to retrigger the 200ms keyframe.
          `inset: 0` keeps the flash strictly within the card's own
          footprint so simultaneous pulses on adjacent cards can't
          visually bleed into each other. */}
      {pulseKey > 0 && !reducedMotion && (
        <div
          key={pulseKey}
          aria-hidden="true"
          style={{
            position: 'absolute' as const,
            inset: 0,
            pointerEvents: 'none' as const,
            borderRadius: 2,
            animation: 'marketCardPulse 220ms ease-out',
            zIndex: 0,
          }}
        />
      )}
      <div style={{ ...styles.marketMeta, alignItems: 'center', flexWrap: 'wrap' as const, rowGap: 6, position: 'relative' as const, zIndex: 1 }}>
        <span style={styles.metaLabel}>Live Market</span>
        <span style={styles.metaLabel}>Vol {volume}</span>
        {/* Last-trade timer: "<dot> 3s ago". Dot pulses when <30s, steady
            otherwise. Dot + label render even when no trade yet (shows "--")
            so the meta row width doesn't jump on first trade arrival. */}
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
          title={
            ageMs == null
              ? 'No trades yet'
              : `Last trade ${formatCardAge(ageMs)} ago`
          }
        >
          <span
            aria-hidden="true"
            style={{
              display: 'inline-block',
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: ageColor,
              flexShrink: 0,
              animation:
                ageFresh && !reducedMotion
                  ? 'liveDotPulse 2s ease-in-out infinite'
                  : undefined,
            }}
          />
          <span
            style={{
              ...styles.metaLabel,
              color: ageColor,
              fontFamily: fonts.mono,
              letterSpacing: '0.05em',
            }}
          >
            {ageMs == null ? '\u2014' : `${formatCardAge(ageMs)} ago`}
          </span>
        </span>
        {/* Δ24h pill -- rendered only when we actually have a 24h-ago price.
            Source: getCandles(1h, last 24h) on card mount + 5m refresh.
            See comment on `fetchDelta24h` in MarketsPage. */}
        {delta24h != null && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '2px 6px',
              borderRadius: 2,
              background: deltaBg,
              fontFamily: fonts.mono,
              fontSize: '10px',
              fontWeight: 500,
              letterSpacing: '0.03em',
              color: deltaColor,
              fontVariantNumeric: 'tabular-nums' as const,
            }}
            title={`YES price change over the last 24 hours`}
          >
            {deltaPositive ? '+' : ''}
            {delta24h.toFixed(1)}%
          </span>
        )}
        {/* Resolves-in chip -- muted by default, amber <24h, red + pulse <1h.
            Renders nothing when the market has no resolution timestamp yet,
            so the meta row layout is stable either way. */}
        <ResolvesInChip
          resolvesAt={market.resolves_at}
          isResolved={market.status !== "Open"}
          th={th}
          variant="card"
        />
        {isConditional && (
          <ConditionalBadge
            parentQuestion={parentQuestion ?? null}
            parentOutcome={market.parent_outcome}
            th={th}
          />
        )}
      </div>
      {/* Row: thumbnail (48px) on the left, title+prices stacked on the right */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginTop: 12, position: 'relative' as const, zIndex: 1 }}>
        <Link href={`/market/${market.id}`} style={{ textDecoration: 'none', display: 'block', flexShrink: 0, marginTop: 4 }}>
          <MarketImage
            src={market.image_url}
            alt={market.question}
            size={48}
            radius={6}
            th={th}
          />
        </Link>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Link href={`/market/${market.id}`} style={{ textDecoration: 'none' }}>
            <h2 style={{ ...styles.marketTitle, margin: '0 0 20px 0' }}>
              {market.question}
            </h2>
          </Link>
          <div style={styles.marketMeta}>
            {yesPercent !== null && noPercent !== null ? (
              <>
                <div style={styles.statItem}>
                  <span style={styles.metaLabel}>Yes</span>
                  <span style={styles.statValue}>{yesPercent}%</span>
                </div>
                <div style={styles.statItem}>
                  <span style={styles.metaLabel}>No</span>
                  <span style={styles.statValue}>{noPercent}%</span>
                </div>
              </>
            ) : (
              <div style={styles.statItem}>
                <span style={styles.metaLabel}>Price</span>
                <span style={styles.statValue}>--</span>
              </div>
            )}
          </div>
          {yesPercent !== null && (
            <div style={styles.probabilityBar}>
              <div style={styles.probabilityFill(yesPercent)} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function NewsItem({
  item,
  th,
  styles,
  isLast,
}: {
  item: SynopticItem;
  th: OracleTheme;
  styles: ReturnType<typeof getStyles>;
  isLast: boolean;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      style={{
        padding: '14px 24px',
        borderBottom: isLast ? 'none' : `0.8px solid ${th.border}`,
        cursor: 'default',
        transition: 'background 0.15s',
        background: hovered ? (th.isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)') : 'transparent',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ ...styles.metaLabel, color: th.textSecondary, fontSize: '9px' }}>
          {item.source}
        </span>
        <span style={{ ...styles.metaLabel, color: th.textSecondary, fontSize: '9px' }}>
          {formatRelativeTime(item.createdAt)}
        </span>
      </div>
      <div style={{
        fontFamily: fonts.sans,
        fontSize: '14px',
        fontWeight: 400,
        lineHeight: 1.4,
        color: th.textPrimary,
      }}>
        {item.text}
      </div>
      <span style={{
        display: 'inline-block',
        marginTop: 8,
        fontSize: '9px',
        fontWeight: 500,
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        color: th.accentFrom,
        fontFamily: fonts.sans,
      }}>
        {item.category}
      </span>
    </div>
  );
}

// =============================================================================
// Stream Filter Dropdown
// =============================================================================

function StreamFilterDropdown({
  selectedIds,
  onToggle,
  th,
  styles,
}: {
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  th: OracleTheme;
  styles: ReturnType<typeof getStyles>;
}) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const allSelected = selectedIds.size === SYNOPTIC_STREAMS.length;
  const count = selectedIds.size;

  return (
    <div ref={dropdownRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 10px',
          background: 'transparent',
          border: `0.8px solid ${th.border}`,
          borderRadius: 2,
          cursor: 'pointer',
          fontFamily: fonts.sans,
          fontSize: '9px',
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          color: th.textSecondary,
          transition: 'color 0.15s, border-color 0.15s',
        }}
        aria-label="Filter news streams"
        aria-expanded={open}
      >
        <span>{allSelected ? 'All Streams' : `${count} Stream${count !== 1 ? 's' : ''}`}</span>
        <span style={{
          display: 'inline-block',
          width: 0,
          height: 0,
          borderLeft: '3px solid transparent',
          borderRight: '3px solid transparent',
          borderTop: `4px solid ${th.textSecondary}`,
          transform: open ? 'rotate(180deg)' : 'none',
          transition: 'transform 0.15s',
        }} />
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 4px)',
          right: 0,
          minWidth: 220,
          maxHeight: 300,
          overflowY: 'auto' as const,
          background: th.elevated,
          border: `0.8px solid ${th.border}`,
          borderRadius: 4,
          padding: '8px 0',
          zIndex: 100,
          boxShadow: th.isDark
            ? '0 8px 24px rgba(0,0,0,0.4)'
            : '0 8px 24px rgba(0,0,0,0.12)',
        }}>
          {/* Select All / Deselect All */}
          <button
            onClick={() => {
              if (allSelected) {
                // Deselect all -- but keep at least one
                SYNOPTIC_STREAMS.forEach((s) => {
                  if (selectedIds.has(s.id)) onToggle(s.id);
                });
              } else {
                SYNOPTIC_STREAMS.forEach((s) => {
                  if (!selectedIds.has(s.id)) onToggle(s.id);
                });
              }
            }}
            style={{
              display: 'block',
              width: '100%',
              padding: '6px 16px',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              textAlign: 'left',
              fontFamily: fonts.sans,
              fontSize: '9px',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              color: th.accentFrom,
              marginBottom: 4,
            }}
          >
            {allSelected ? 'Deselect All' : 'Select All'}
          </button>

          <div style={{ height: '0.8px', background: th.border, margin: '0 12px 4px' }} />

          {SYNOPTIC_STREAMS.map((stream) => {
            const checked = selectedIds.has(stream.id);
            return (
              <label
                key={stream.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '7px 16px',
                  cursor: 'pointer',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background = th.isDark
                    ? 'rgba(255,255,255,0.03)'
                    : 'rgba(0,0,0,0.03)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = 'transparent';
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(stream.id)}
                  style={{
                    width: 14,
                    height: 14,
                    accentColor: th.accentFrom,
                    cursor: 'pointer',
                    margin: 0,
                    flexShrink: 0,
                  }}
                  aria-label={`Toggle ${stream.name}`}
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                  <span style={{
                    fontFamily: fonts.sans,
                    fontSize: '11px',
                    fontWeight: 500,
                    color: checked ? th.textPrimary : th.textSecondary,
                    transition: 'color 0.15s',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {stream.name}
                  </span>
                  <span style={{
                    fontFamily: fonts.sans,
                    fontSize: '9px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    color: th.textTertiary,
                  }}>
                    {stream.category}
                  </span>
                </div>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// News Feed (Synoptic real-time)
// =============================================================================

const NEWS_FILTER_STORAGE_KEY = 'caster-news-filter';

function loadSavedStreamIds(): Set<string> {
  if (typeof window === 'undefined') {
    return new Set(SYNOPTIC_STREAMS.map((s) => s.id));
  }
  try {
    const raw = localStorage.getItem(NEWS_FILTER_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // Only keep IDs that still exist in SYNOPTIC_STREAMS
        const validIds = new Set(SYNOPTIC_STREAMS.map((s) => s.id));
        const filtered = parsed.filter((id: unknown) => typeof id === 'string' && validIds.has(id));
        if (filtered.length > 0) {
          return new Set<string>(filtered);
        }
      }
    }
  } catch {
    // Invalid localStorage data -- fall back to all selected
  }
  return new Set(SYNOPTIC_STREAMS.map((s) => s.id));
}

function NewsFeed({ th, styles }: { th: OracleTheme; styles: ReturnType<typeof getStyles> }) {
  // Track which streams are selected -- persisted via localStorage
  const [selectedIds, setSelectedIds] = useState<Set<string>>(loadSavedStreamIds);

  // Persist filter selection to localStorage on every change
  useEffect(() => {
    try {
      localStorage.setItem(NEWS_FILTER_STORAGE_KEY, JSON.stringify([...selectedIds]));
    } catch {
      // localStorage may be unavailable (private browsing, quota exceeded)
    }
  }, [selectedIds]);

  const toggleStream = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // Subscribe to all streams always (filtering is client-side only)
  const allStreamIds = useMemo(() => SYNOPTIC_STREAMS.map((s) => s.id), []);
  const { items, connected, error } = useSynopticFeed(allStreamIds);

  // Client-side filter
  const filteredItems = useMemo(
    () => items.filter((item) => selectedIds.has(item.streamId)),
    [items, selectedIds],
  );

  const hasApiKey = typeof process !== "undefined" && !!process.env.NEXT_PUBLIC_SYNOPTIC_API_KEY;

  return (
    <div style={{
      position: 'sticky',
      top: '24px',
      border: `0.8px solid ${th.border}`,
      borderRadius: 4,
      background: th.panelBg,
      backdropFilter: 'blur(10px)',
      padding: 0,
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 24px 12px',
        borderBottom: `0.8px solid ${th.border}`,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{
            fontFamily: fonts.serif,
            fontSize: '20px',
            fontWeight: 400,
            color: th.textPrimary,
          }}>
            News Feed
          </span>
          {/* Connection indicator */}
          <span
            style={{
              display: 'inline-block',
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: !hasApiKey
                ? th.textTertiary
                : connected
                  ? '#16A34A'
                  : '#DC2626',
              flexShrink: 0,
            }}
            title={
              !hasApiKey
                ? 'API key not configured'
                : connected
                  ? 'Connected to Synoptic'
                  : error || 'Disconnected'
            }
          />
        </div>
        <StreamFilterDropdown
          selectedIds={selectedIds}
          onToggle={toggleStream}
          th={th}
          styles={styles}
        />
      </div>

      {/* Feed body */}
      <div style={{ maxHeight: 520, overflowY: 'auto' }}>
        {!hasApiKey ? (
          <div style={{
            padding: '40px 24px',
            textAlign: 'center',
          }}>
            <div style={{
              ...styles.metaLabel,
              color: th.textTertiary,
              marginBottom: 8,
            }}>
              Synoptic API Key Required
            </div>
            <div style={{
              fontFamily: fonts.sans,
              fontSize: '12px',
              lineHeight: 1.5,
              color: th.textSecondary,
            }}>
              Set <code style={{
                fontFamily: fonts.mono,
                fontSize: '11px',
                padding: '1px 4px',
                background: th.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
                borderRadius: 2,
              }}>NEXT_PUBLIC_SYNOPTIC_API_KEY</code> in your environment to enable the live news feed.
            </div>
          </div>
        ) : error && !connected && filteredItems.length === 0 ? (
          <div style={{
            padding: '40px 24px',
            textAlign: 'center',
          }}>
            <div style={{
              ...styles.metaLabel,
              color: th.no,
              marginBottom: 8,
            }}>
              Connection Error
            </div>
            <div style={{
              fontFamily: fonts.sans,
              fontSize: '12px',
              color: th.textSecondary,
            }}>
              {error}. Retrying...
            </div>
          </div>
        ) : !connected && filteredItems.length === 0 ? (
          <div style={{
            padding: '40px 24px',
            textAlign: 'center',
          }}>
            <div style={{
              ...styles.metaLabel,
              color: th.textTertiary,
              fontStyle: 'italic',
            }}>
              Connecting to Synoptic...
            </div>
          </div>
        ) : filteredItems.length === 0 ? (
          <div style={{
            padding: '40px 24px',
            textAlign: 'center',
          }}>
            <div style={{
              ...styles.metaLabel,
              color: th.textTertiary,
            }}>
              {selectedIds.size === 0 ? 'No streams selected' : 'No items yet -- waiting for updates'}
            </div>
          </div>
        ) : (
          filteredItems.map((item, i) => (
            <NewsItem
              key={item.id}
              item={item}
              th={th}
              styles={styles}
              isLast={i === filteredItems.length - 1}
            />
          ))
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Create Market Modal (from existing page)
// =============================================================================

function CreateMarketModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const { account, walletClient } = useAccount();
  const [question, setQuestion] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!account || !walletClient || !question.trim()) return;
    setSubmitting(true);
    setError("");
    try {
      await api.createMarket(walletClient, account.address, question.trim());
      await new Promise((r) => setTimeout(r, 500));
      onCreated();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create market");
    } finally {
      setSubmitting(false);
    }
  };

  const th = darkTheme;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 50,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0,0,0,0.50)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
      }}
    >
      <div style={{
        width: "100%", maxWidth: 460,
        borderRadius: 4,
        padding: 24,
        background: th.elevated,
        border: `0.8px solid ${th.border}`,
      }}>
        <h2 style={{ fontFamily: fonts.serif, fontSize: 20, fontWeight: 400, marginBottom: 20, color: th.textPrimary }}>
          Create Market
        </h2>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={{ display: "block", ...type.metaLabel, color: th.textSecondary, marginBottom: 6 }}>
              Question
            </label>
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Will X happen by Y?"
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 2,
                border: `0.8px solid ${th.border}`,
                background: "rgba(0, 0, 0, 0.20)",
                color: th.textPrimary,
                fontFamily: fonts.sans,
                fontSize: 14,
                outline: "none",
              }}
            />
          </div>

          {error && (
            <p style={{ fontSize: 11, color: th.no }}>{error}</p>
          )}

          <div style={{ display: "flex", gap: 8, paddingTop: 8 }}>
            <button
              onClick={onClose}
              style={{
                flex: 1, height: 40, borderRadius: 2,
                background: 'transparent', color: th.textSecondary,
                border: `0.8px solid ${th.border}`,
                fontFamily: fonts.sans, fontSize: 13, cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting || !question.trim()}
              style={{
                flex: 1, height: 40, borderRadius: 2,
                background: th.accentFrom, color: "#000",
                border: "none",
                fontFamily: fonts.sans, fontSize: 13, fontWeight: 600,
                cursor: "pointer",
                opacity: submitting || !question.trim() ? 0.5 : 1,
              }}
            >
              {submitting ? "Creating..." : "Create Market"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Main Page
// =============================================================================

export default function MarketsPage() {
  const { account, updateBalance } = useAccount();
  const { theme } = useTheme();
  const { addListener } = useWs();
  const reducedMotion = usePrefersReducedMotion();
  const isDark = theme === "dark";
  const th = isDark ? darkTheme : lightTheme;
  const styles = getStyles(th);

  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState("All Markets");
  const [showCreate, setShowCreate] = useState(false);
  const [prices, setPrices] = useState<Record<string, PriceData>>({});
  const [stats, setStats] = useState<Record<string, StatsData>>({});
  // Per-market most-recent trade timestamp, shared between ALL cards.
  // Populated from (a) one-shot REST bootstrap on market load (so age
  // is meaningful without waiting for a live trade) and (b) a single
  // page-level WS listener that reuses SitewideTradeTape's existing
  // subscriptions -- no extra `subscribe()` calls fan out per card.
  const [lastTradeByMarket, setLastTradeByMarket] = useState<Record<string, LastTrade>>({});
  // 24h price delta (percentage points) per market. Sourced client-side
  // from getCandles("1h", last 24h); if the endpoint errors or no 24h-ago
  // candle exists, the card simply omits the pill (see Δ24h pill comment).
  const [delta24hByMarket, setDelta24hByMarket] = useState<Record<string, number>>({});
  // Shared monotonic `now` tick so every card's age label stays live
  // without each card owning its own setInterval (N cards × 1 interval
  // was measurable at 30+ markets; one shared interval is cheaper).
  const [now, setNow] = useState(() => Date.now());
  const tradeLocalIdRef = useRef(0);

  const isAdmin = Boolean(
    process.env.NEXT_PUBLIC_ADMIN_ADDRESS &&
    account?.address?.toLowerCase() === process.env.NEXT_PUBLIC_ADMIN_ADDRESS.toLowerCase()
  );

  // Auto-update balance via WebSocket (e.g. after bridge deposit)
  const accountId = account?.address ?? null;
  useEffect(() => {
    if (!accountId) return;
    const remove = addListener((msg: WsServerMessage) => {
      if (msg.type === "balance_update") updateBalance(msg.balance);
    });
    return remove;
  }, [accountId, addListener, updateBalance]);

  // Shared page-level WS listener -- piggy-backs on the subscriptions
  // that SitewideTradeTape already opens (`subscribe(["trades"], mid)`
  // for every Open market). We deliberately do NOT subscribe here; the
  // WebSocket client routes every `trade` message to every listener, so
  // one extra listener is free. This is how we avoid fanning out N new
  // subscriptions from N MarketCards.
  //
  // NOTE: if SitewideTradeTape is ever removed from the home page, this
  // block would need its own subscribe() loop. Reassess then.
  useEffect(() => {
    const remove = addListener((msg: WsServerMessage) => {
      if (msg.type !== "trade") return;
      const mid = String(msg.market_id);
      const ts = Date.parse(msg.timestamp);
      if (!Number.isFinite(ts)) return;
      tradeLocalIdRef.current += 1;
      const localId = tradeLocalIdRef.current;
      setLastTradeByMarket((prev) => {
        const existing = prev[mid];
        // Guard against out-of-order delivery -- keep the newest by ts,
        // but still bump localId so cards can distinguish "actual new
        // trade" from "same trade re-observed" (shouldn't happen with
        // our WS, defensive).
        if (existing && existing.ts >= ts) return prev;
        return { ...prev, [mid]: { ts, localId } };
      });
    });
    return remove;
  }, [addListener]);

  // Tick `now` once per second so the per-card "Xs ago" labels stay
  // live. One interval for the whole page -- see state declaration.
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);

  // Fetch the 24h price delta for one market. Uses the existing 1h
  // candles endpoint: grab the last ~26h of candles, take the earliest
  // candle whose close is >= 24h old as the reference, compare to the
  // most recent close. Returns null when there's no 24h-ago reference
  // (brand-new market) or the endpoint errors.
  const fetchDelta24h = useCallback(async (marketId: string): Promise<number | null> => {
    const nowSec = Math.floor(Date.now() / 1000);
    // 26h window gives us slack -- if the market just crossed a bucket
    // boundary we still have an anchor candle to compare against.
    const fromSec = nowSec - 26 * 60 * 60;
    try {
      const candles = await api.getCandles(marketId, "1h", fromSec, nowSec);
      if (candles.length < 2) return null;
      const cutoff = nowSec - 24 * 60 * 60;
      // Candles ascending by time -- find the oldest candle within the
      // last 24h as the "24h ago" anchor, compare to the newest close.
      // If every candle is younger than 24h (market <24h old) we return
      // null rather than quoting a misleading sub-24h delta.
      const anchor = candles.find((c) => c.time >= cutoff - 60 * 60);
      if (!anchor) return null;
      if (anchor.time > cutoff + 60 * 60) return null; // no true 24h-ago point
      const latest = candles[candles.length - 1];
      if (anchor.close <= 0) return null;
      // Prices are ticks (0-1000 = 0-100%). Report as percentage-point
      // delta of the YES probability -- consistent with how we display
      // yesPercent elsewhere on the card.
      const anchorPct = (anchor.close / 1000) * 100;
      const latestPct = (latest.close / 1000) * 100;
      return latestPct - anchorPct;
    } catch {
      return null;
    }
  }, []);

  const refresh = useCallback(() => {
    api.listMarkets().then((m) => {
      setMarkets(m);
      const open = m.filter((mk) => mk.status === "Open");
      open.forEach((mk) => {
        fetchMidPrice(mk.id).then((p) => {
          setPrices((prev) => ({ ...prev, [mk.id]: p }));
        });
        fetchStats(mk.id).then((s) => {
          if (s) setStats((prev) => ({ ...prev, [mk.id]: s }));
        });
        // Seed the last-trade map so "Xs ago" has a value before the
        // first live WS trade arrives. One /recent call per market on
        // page load is acceptable; we don't refresh this on an interval
        // because WS covers the stream thereafter.
        api.getRecentTrades(mk.id, 1).then((trades) => {
          if (trades.length === 0) return;
          const ts = trades[0].timestamp; // already epoch ms from API
          if (!Number.isFinite(ts)) return;
          tradeLocalIdRef.current += 1;
          const localId = tradeLocalIdRef.current;
          setLastTradeByMarket((prev) => {
            const existing = prev[mk.id];
            if (existing && existing.ts >= ts) return prev;
            return { ...prev, [mk.id]: { ts, localId } };
          });
        }).catch(() => { /* silent -- card just shows "--" */ });
        // Fetch Δ24h for this market.
        fetchDelta24h(mk.id).then((d) => {
          if (d == null) return;
          setDelta24hByMarket((prev) => ({ ...prev, [mk.id]: d }));
        });
      });
    }).catch(console.error).finally(() => setLoading(false));
  }, [fetchDelta24h]);

  useEffect(() => { refresh(); }, [refresh]);

  // Refresh Δ24h every 5 minutes. We don't refresh last-trade on an
  // interval because the WS stream is authoritative once connected;
  // the 24h delta is the only piece that drifts over time regardless
  // of trades (the 24h window just keeps sliding forward).
  useEffect(() => {
    const i = setInterval(() => {
      const open = markets.filter((mk) => mk.status === "Open");
      for (const mk of open) {
        fetchDelta24h(mk.id).then((d) => {
          if (d == null) return;
          setDelta24hByMarket((prev) => ({ ...prev, [mk.id]: d }));
        });
      }
    }, 5 * 60 * 1000);
    return () => clearInterval(i);
  }, [markets, fetchDelta24h]);

  const openMarkets = markets.filter((m) => m.status === "Open");
  const totalVolume = useMemo(() => {
    return Object.values(stats).reduce((sum, s) => sum + s.totalVolume, 0);
  }, [stats]);

  // Lookup parent market questions for Conditional badge tooltips.
  // We only render the badge for children with `parent_market_id != null`;
  // the parent itself is almost always in the same `markets` payload.
  const marketsById = useMemo(() => {
    const map = new Map<number, Market>();
    for (const m of markets) map.set(Number(m.id), m);
    return map;
  }, [markets]);

  return (
    <>
      <div style={styles.grainOverlay} />
      <div style={styles.appShell}>
        {/* H1: sitewide live trade tape. Placed above the filter nav /
            market grid so it's the first thing below the Navbar -- the
            "heartbeat" signal for the chain. Hidden under 480px via CSS. */}
        <SitewideTradeTape markets={markets} th={th} />
        <main style={styles.main}>
          <section>
            {/* Admin create market button */}
            {isAdmin && (
              <div style={{ marginBottom: 20 }}>
                <button
                  onClick={() => setShowCreate(true)}
                  style={{
                    padding: '8px 14px',
                    background: 'transparent',
                    border: `0.8px solid ${th.border}`,
                    borderRadius: 4,
                    ...type.metaLabel,
                    color: th.textSecondary,
                    cursor: 'pointer',
                  }}
                >
                  + Create Market
                </button>
              </div>
            )}
            <nav style={styles.filterNav}>
              {filters.map((f) => (
                <div
                  key={f}
                  style={styles.filterItem(activeFilter === f)}
                  onClick={() => setActiveFilter(f)}
                >
                  {f}
                </div>
              ))}
            </nav>

            <div style={styles.marketList}>
              {loading ? (
                <div style={{ ...styles.metaLabel, padding: '40px 0', fontStyle: 'italic' }}>
                  Loading markets...
                </div>
              ) : openMarkets.length === 0 ? (
                <div style={{ ...styles.metaLabel, padding: '40px 0' }}>
                  No markets available yet.
                </div>
              ) : (
                openMarkets.map((market) => {
                  const parent =
                    market.parent_market_id != null
                      ? marketsById.get(market.parent_market_id)
                      : undefined;
                  return (
                    <MarketCard
                      key={market.id}
                      market={market}
                      prices={prices[market.id]}
                      stats={stats[market.id]}
                      parentQuestion={parent?.question ?? null}
                      lastTrade={lastTradeByMarket[market.id]}
                      now={now}
                      delta24h={delta24hByMarket[market.id] ?? null}
                      reducedMotion={reducedMotion}
                      styles={styles}
                      th={th}
                    />
                  );
                })
              )}
            </div>
          </section>

          <aside>
            <NewsFeed th={th} styles={styles} />
          </aside>
        </main>

        <footer style={styles.footer}>
          <span style={styles.metaLabel}>Caster v1.0.4</span>
          <span style={styles.metaLabel}>&copy; 2026 Caster Systems</span>
          <span style={styles.metaLabel}>
            {openMarkets.length} Market{openMarkets.length !== 1 ? "s" : ""} &middot; {formatVolume(totalVolume)} Volume
          </span>
        </footer>
      </div>

      {isAdmin && showCreate && (
        <CreateMarketModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); refresh(); }}
        />
      )}
    </>
  );
}
