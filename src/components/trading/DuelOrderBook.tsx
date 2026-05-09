"use client";

import { useMemo, useState } from "react";
import { formatDollars, notionalDollars } from "@/lib/format";

/* ================================================================
   Types
   ================================================================ */
interface Level {
  price: number;
  quantity: number;
}

interface DuelOrderBookProps {
  marketId: string;
  liveBids: Level[];
  liveAsks: Level[];
}

/* ================================================================
   Depth-bar rendering constants
   See docs/design/orderbook-alignment-2026-04-19.md for rationale.
   ================================================================ */
/** Minimum visible width of a non-zero depth bar. Without this clamp,
 * sub-3% fills render as 1-2px slivers that read as rendering artefacts
 * rather than "a small order sat here". */
const MIN_DEPTH_BAR_PX = 6;

/* ================================================================
   Constants
   ================================================================ */
const DISPLAY_LEVELS = 10;
const DISPLAY_LEVELS_SINGLE = 15;

type BookViewMode = "both" | "bids" | "asks";

/* ================================================================
   DuelOrderBook -- Static centered duel layout (prototype style)

   Two equal-width halves (YES | NO) separated by a thin gradient
   divider. Neither half grows or shrinks based on probability --
   the layout stays perfectly centered.
   ================================================================ */
export default function DuelOrderBook({
  liveBids,
  liveAsks,
}: DuelOrderBookProps) {
  // Derived data
  const derived = useMemo(() => {
    const bids = liveBids.length > 0 ? liveBids : [];
    const asks = liveAsks.length > 0 ? liveAsks : [];

    const bestBid = bids.length > 0 ? bids[0].price : null;
    const bestAsk = asks.length > 0 ? asks[0].price : null;

    // YES side: bids and asks as-is
    const yesBidsFull = [...bids].sort((a, b) => b.price - a.price);
    const yesAsksFull = [...asks].sort((a, b) => a.price - b.price);

    // NO side: invert prices (1000 - price)
    const noBidsFull = [...asks]
      .map((a) => ({ price: 1000 - a.price, quantity: a.quantity }))
      .sort((a, b) => b.price - a.price);
    const noAsksFull = [...bids]
      .map((b) => ({ price: 1000 - b.price, quantity: b.quantity }))
      .sort((a, b) => a.price - b.price);

    // Probability
    const mid =
      bestBid != null && bestAsk != null
        ? (bestBid + bestAsk) / 2
        : bestBid ?? bestAsk ?? null;
    const yesProbPct = mid != null ? Math.round(mid / 10) : 50;
    const noProbPct = 100 - yesProbPct;

    // Max quantity across ALL levels for depth bar normalization
    const allLevels = [...yesBidsFull, ...yesAsksFull, ...noBidsFull, ...noAsksFull];
    const maxQty = Math.max(...allLevels.map((l) => l.quantity), 1);

    // YES spread
    const yesSpread =
      bestBid != null && bestAsk != null ? bestAsk - bestBid : null;
    const yesSpreadCents =
      yesSpread != null ? (yesSpread / 10).toFixed(1) : "--";

    // NO spread
    const noBestBid = noBidsFull.length > 0 ? noBidsFull[0].price : null;
    const noBestAsk = noAsksFull.length > 0 ? noAsksFull[0].price : null;
    const noSpread =
      noBestBid != null && noBestAsk != null ? noBestAsk - noBestBid : null;
    const noSpreadCents =
      noSpread != null ? (noSpread / 10).toFixed(1) : "--";

    return {
      yesBidsFull,
      yesAsksFull,
      noBidsFull,
      noAsksFull,
      yesProbPct,
      noProbPct,
      maxQty,
      yesSpreadCents,
      noSpreadCents,
    };
  }, [liveBids, liveAsks]);

  return (
    <div
      style={{
        display: "flex",
        position: "relative",
        borderRadius: 2,
        overflow: "hidden",
        border: "0.8px solid var(--oracle-border)",
        background: "var(--oracle-surface)",
        minHeight: 360,
      }}
    >
      {/* YES Half -- flex:1 = static width */}
      <HalfBook
        side="yes"
        bids={derived.yesBidsFull}
        asks={derived.yesAsksFull}
        probability={derived.yesProbPct}
        maxQty={derived.maxQty}
        spreadCents={derived.yesSpreadCents}
      />

      {/* Center divider -- mirrors the HalfBook flex structure so the pill
          naturally aligns with the spread rows on both sides. */}
      <div
        style={{
          width: 1,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          background:
            "linear-gradient(180deg, var(--yes) 0%, var(--oracle-border) 50%, var(--no) 100%)",
        }}
      >
        {/* Spacer matching header (label + probability + marginBottom) */}
        <div style={{ height: 56, flexShrink: 0 }} />
        {/* Spacer matching the book well structure */}
        <div
          style={{
            flex: "1 1 0%",
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Spacer matching column headers */}
          <div style={{ height: 26, flexShrink: 0 }} />
          {/* Spacer matching asks section */}
          <div style={{ flex: "1 1 0%", minHeight: 0 }} />
          {/* Pill aligned with spread row */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              position: "relative",
              height: 28,
            }}
          >
            <div
              style={{
                position: "absolute",
                left: "50%",
                transform: "translateX(-50%)",
                fontSize: 10,
                fontWeight: 600,
                fontFamily: "var(--font-sans)",
                color: "var(--text-primary)",
                background: "var(--bg-elevated)",
                border: "1px solid var(--border-default)",
                padding: "4px 10px",
                borderRadius: 12,
                whiteSpace: "nowrap",
                zIndex: 11,
              }}
            >
              {derived.yesProbPct} / {derived.noProbPct}
            </div>
          </div>
          {/* Spacer matching bids section */}
          <div style={{ flex: "1 1 0%", minHeight: 0 }} />
        </div>
      </div>

      {/* NO Half -- flex:1 = static width */}
      <HalfBook
        side="no"
        bids={derived.noBidsFull}
        asks={derived.noAsksFull}
        probability={derived.noProbPct}
        maxQty={derived.maxQty}
        spreadCents={derived.noSpreadCents}
      />
    </div>
  );
}

/* ================================================================
   HalfBook -- one side (YES or NO) with header, book well, spread
   ================================================================ */
function HalfBook({
  side,
  bids,
  asks,
  probability,
  maxQty,
  spreadCents,
}: {
  side: "yes" | "no";
  bids: Level[];
  asks: Level[];
  probability: number;
  maxQty: number;
  spreadCents: string;
}) {
  const [viewMode, setViewMode] = useState<BookViewMode>("both");

  const levelCount =
    viewMode === "both" ? DISPLAY_LEVELS : DISPLAY_LEVELS_SINGLE;

  // Asks sorted high-to-low (highest at top), bids sorted high-to-low
  const displayAsks =
    viewMode === "bids"
      ? []
      : [...asks].sort((a, b) => b.price - a.price).slice(0, levelCount);
  const displayBids =
    viewMode === "asks"
      ? []
      : [...bids].sort((a, b) => b.price - a.price).slice(0, levelCount);

  const bidColor = side === "yes" ? "var(--yes)" : "var(--no)";
  const askPriceColor =
    side === "yes" ? "var(--duel-yes-ask-price)" : "var(--duel-no-ask-price)";
  const spreadBorder =
    side === "yes"
      ? "var(--duel-spread-border-yes)"
      : "var(--duel-spread-border-no)";
  const spreadBg =
    side === "yes" ? "var(--duel-spread-bg-yes)" : "var(--duel-spread-bg-no)";

  const washBg =
    side === "yes"
      ? "linear-gradient(180deg, rgba(34, 197, 94, 0.03) 0%, transparent 60%)"
      : "linear-gradient(180deg, rgba(239, 68, 68, 0.03) 0%, transparent 60%)";

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        padding: "14px 16px",
        background: washBg,
        position: "relative",
        overflow: "hidden",
        minWidth: 0,
      }}
    >
      {/* Watermark */}
      <div
        style={{
          position: "absolute",
          bottom: 12,
          ...(side === "yes" ? { left: 16 } : { right: 16 }),
          fontFamily: "var(--font-serif)",
          fontSize: 36,
          fontWeight: 400,
          fontStyle: "italic",
          letterSpacing: "-0.02em",
          opacity: 0.03,
          textTransform: "uppercase",
          color: side === "yes" ? "var(--yes)" : "var(--no)",
          pointerEvents: "none",
          userSelect: "none",
          ...(side === "no" ? { textAlign: "right" as const } : {}),
        }}
      >
        {side === "yes" ? "YES" : "NO"}
      </div>

      {/* Header: label + probability */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 12,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 10,
            fontWeight: 500,
            textTransform: "uppercase",
            letterSpacing: "0.15em",
            color: "var(--text-tertiary)",
          }}
        >
          {side === "yes" ? "Yes" : "No"}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 28,
            fontWeight: 400,
            letterSpacing: "-0.02em",
            lineHeight: 1,
            color: side === "yes" ? "var(--yes)" : "var(--no)",
          }}
        >
          {probability}%
        </span>
      </div>

      {/* Book well (inner container) */}
      <div
        style={{
          flex: "1 1 0%",
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          background: "var(--duel-book-well)",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        {/* Column headers with view toggle */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "4px 10px",
            fontFamily: "var(--font-sans)",
            fontSize: 10,
            fontWeight: 500,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            color: "var(--text-tertiary)",
            borderBottom: "0.8px solid var(--oracle-divider)",
            flexShrink: 0,
          }}
        >
          <span>Price</span>
          <ViewToggle
            viewMode={viewMode}
            setViewMode={setViewMode}
            bidColor={bidColor}
            askColor={askPriceColor}
          />
          <span>Size</span>
        </div>

        {/* Asks section (top, sorted high-to-low, bottom-aligned) */}
        {viewMode !== "bids" && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-end",
              flex: "1 1 0%",
              minHeight: 0,
              overflow: "hidden",
            }}
          >
            {displayAsks.length === 0 ? (
              <div
                style={{
                  padding: "6px 10px",
                  textAlign: "center",
                  fontSize: 11,
                  color: "var(--text-tertiary)",
                }}
              >
                --
              </div>
            ) : (
              (() => {
                // Cumulative $ sweep from best ask outward.
                // displayAsks is sorted high->low; best ask is at the bottom.
                // Walk the array in reverse so cumulative[i] = sum from best
                // up to and including this level.
                const cumulative: number[] = new Array(displayAsks.length);
                let running = 0;
                for (let i = displayAsks.length - 1; i >= 0; i--) {
                  running += notionalDollars(
                    displayAsks[i].price,
                    displayAsks[i].quantity,
                  );
                  cumulative[i] = running;
                }
                return displayAsks.map((level, i) => (
                  <BookRow
                    key={`a${level.price}`}
                    price={level.price}
                    quantity={level.quantity}
                    cumulative={cumulative[i]}
                    maxQty={maxQty}
                    priceColor={askPriceColor}
                    side={side}
                    isBid={false}
                  />
                ));
              })()
            )}
          </div>
        )}

        {/* Spread row */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: 8,
            padding: "5px 10px",
            borderTop: `0.8px solid ${spreadBorder}`,
            borderBottom: `0.8px solid ${spreadBorder}`,
            background: spreadBg,
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: 10,
              fontWeight: 500,
              color: "var(--text-tertiary)",
            }}
          >
            Spread
          </span>
          <span
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: 10,
              fontWeight: 500,
              color: bidColor,
            }}
          >
            {spreadCents}c
          </span>
        </div>

        {/* Bids section (bottom, sorted high-to-low, top-aligned) */}
        {viewMode !== "asks" && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flex: "1 1 0%",
              minHeight: 0,
              overflow: "hidden",
            }}
          >
            {displayBids.length === 0 ? (
              <div
                style={{
                  padding: "6px 10px",
                  textAlign: "center",
                  fontSize: 11,
                  color: "var(--text-tertiary)",
                }}
              >
                --
              </div>
            ) : (
              (() => {
                // Cumulative $ sweep from best bid downward.
                // displayBids is sorted high->low; best bid is at the top
                // (index 0). cumulative[i] = sum from best through level i.
                const cumulative: number[] = new Array(displayBids.length);
                let running = 0;
                for (let i = 0; i < displayBids.length; i++) {
                  running += notionalDollars(
                    displayBids[i].price,
                    displayBids[i].quantity,
                  );
                  cumulative[i] = running;
                }
                return displayBids.map((level, i) => (
                  <BookRow
                    key={`b${level.price}`}
                    price={level.price}
                    quantity={level.quantity}
                    cumulative={cumulative[i]}
                    maxQty={maxQty}
                    priceColor={bidColor}
                    side={side}
                    isBid={true}
                  />
                ));
              })()
            )}
          </div>
        )}
      </div>

      {/* Empty state -- check original data, not view-filtered arrays */}
      {asks.length === 0 && bids.length === 0 && (
        <div
          style={{
            textAlign: "center",
            padding: "24px 10px",
            fontSize: 12,
            color: "var(--text-tertiary)",
            fontFamily: "var(--font-sans)",
            fontStyle: "italic",
          }}
        >
          No orders
        </div>
      )}
    </div>
  );
}

/* ================================================================
   ViewToggle -- switch between both / bids / asks views
   ================================================================ */
function ViewToggle({
  viewMode,
  setViewMode,
  bidColor,
  askColor,
}: {
  viewMode: BookViewMode;
  setViewMode: (m: BookViewMode) => void;
  bidColor: string;
  askColor: string;
}) {
  const btnStyle = (active: boolean): React.CSSProperties => ({
    padding: "2px 5px",
    border: "none",
    borderRadius: 2,
    cursor: "pointer",
    background: active ? "rgba(255,255,255,0.08)" : "transparent",
    display: "flex",
    alignItems: "center",
    transition: "background 150ms",
  });

  return (
    <div style={{ display: "flex", gap: 2 }}>
      <button
        style={btnStyle(viewMode === "both")}
        onClick={() => setViewMode("both")}
        title="Both sides"
      >
        <svg width="12" height="10" viewBox="0 0 12 10" fill="none">
          <rect
            x="0"
            y="0"
            width="12"
            height="4"
            rx="1"
            fill={viewMode === "both" ? askColor : "currentColor"}
            opacity={viewMode === "both" ? 0.7 : 0.3}
          />
          <rect
            x="0"
            y="6"
            width="12"
            height="4"
            rx="1"
            fill={viewMode === "both" ? bidColor : "currentColor"}
            opacity={viewMode === "both" ? 0.7 : 0.3}
          />
        </svg>
      </button>
      <button
        style={btnStyle(viewMode === "bids")}
        onClick={() => setViewMode("bids")}
        title="Bids only"
      >
        <svg width="12" height="10" viewBox="0 0 12 10" fill="none">
          <rect
            x="0"
            y="0"
            width="12"
            height="10"
            rx="1"
            fill={viewMode === "bids" ? bidColor : "currentColor"}
            opacity={viewMode === "bids" ? 0.7 : 0.3}
          />
        </svg>
      </button>
      <button
        style={btnStyle(viewMode === "asks")}
        onClick={() => setViewMode("asks")}
        title="Asks only"
      >
        <svg width="12" height="10" viewBox="0 0 12 10" fill="none">
          <rect
            x="0"
            y="0"
            width="12"
            height="10"
            rx="1"
            fill={viewMode === "asks" ? askColor : "currentColor"}
            opacity={viewMode === "asks" ? 0.7 : 0.3}
          />
        </svg>
      </button>
    </div>
  );
}

/* ================================================================
   BookRow -- single price level with depth bar.

   Displays three pieces of info per level, ordered by trader value:
     1. Price (strongest visual weight)
     2. $ notional (primary -- what the user actually cares about)
     3. Share count (muted secondary, hidden on narrow viewports)

   The depth bar still scales off share quantity because that
   represents fillable depth more faithfully than $ notional
   (a 100-share level at 0.05 has more shares to fill than a
   50-share level at 0.90, even if the dollars are tiny).
   ================================================================ */
function BookRow({
  price,
  quantity,
  cumulative,
  maxQty,
  priceColor,
  side,
  isBid,
}: {
  price: number;
  quantity: number;
  cumulative: number;
  maxQty: number;
  priceColor: string;
  side: "yes" | "no";
  isBid: boolean;
}) {
  // Alignment (docs/design/orderbook-alignment-2026-04-19.md, Option A):
  //   YES panel: bar anchored right, grows left.
  //   NO panel:  bar anchored left, grows right.
  // The bid/ask distinction doesn't flip the anchor any more -- both
  // sides of a single book radiate outward from the centre divider so
  // asymmetric book weight reads at a glance.
  //
  // On stacked mobile (<640px) the centre-fulcrum intuition disappears,
  // so both books flip to YES-style (anchor right, grow left) for
  // consistent top-to-bottom reading. That's handled via the
  // `depth-bar--mobile-align` CSS class + media query below.
  const widthPct = Math.min((quantity / maxQty) * 100, 100);
  const notional = notionalDollars(price, quantity);
  const notionalLabel = formatDollars(notional);
  const cumulativeLabel = formatDollars(cumulative);
  const sweepLabel = isBid ? "sell into this level" : "sweep to this level";

  // Gradient: dense end (`-max`) sits at the anchor, fades to `-min` at
  // the growing edge. YES anchor = right -> gradient flows right-to-left.
  // NO anchor = left -> gradient flows left-to-right.
  const depthGradient =
    side === "yes"
      ? "linear-gradient(to left, var(--depth-bar-yes-max), var(--depth-bar-yes-min))"
      : "linear-gradient(to right, var(--depth-bar-no-max), var(--depth-bar-no-min))";

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        padding: "3px 10px",
        fontSize: 12,
        fontFamily: "var(--font-mono)",
        position: "relative",
        lineHeight: 1.4,
        cursor: "pointer",
        transition: "background 100ms",
      }}
      title={`${quantity.toLocaleString()} shares at ${(price / 10).toFixed(1)}c = ${notionalLabel}\nCumulative ${sweepLabel}: ${cumulativeLabel}`}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--duel-row-hover)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      {/* Depth bar -- two-stop gradient, anchored per Option A (outward
          mirror). The `depth-bar--side-{yes,no}` class lets the mobile
          media query in globals.css flip NO bars to right-anchor when
          the two panels stack vertically. Non-zero bars get a 6px min
          width so tiny slivers don't look like rendering glitches. */}
      <div
        className={`depth-bar depth-bar--side-${side}`}
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          width: `${widthPct}%`,
          minWidth: quantity > 0 ? MIN_DEPTH_BAR_PX : 0,
          background: depthGradient,
          pointerEvents: "none",
          transition: "width 300ms ease-out",
        }}
      />
      {/* Price */}
      <span
        style={{
          position: "relative",
          zIndex: 1,
          fontWeight: 500,
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          color: priceColor,
        }}
      >
        {(price / 10).toFixed(1)}c
      </span>
      {/* Size -- $ notional (primary) + share count (muted subscript) */}
      <span
        style={{
          position: "relative",
          zIndex: 1,
          display: "inline-flex",
          alignItems: "baseline",
          gap: 5,
          fontFamily: "var(--font-mono)",
          fontSize: 12,
        }}
      >
        <span
          style={{
            color: "var(--text-secondary)",
            fontWeight: 500,
          }}
        >
          {notionalLabel}
        </span>
        <span
          className="duel-row-shares"
          style={{
            color: "var(--text-tertiary)",
            fontWeight: 400,
            fontSize: 10,
          }}
        >
          {quantity.toLocaleString()}
        </span>
      </span>
    </div>
  );
}
