"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import * as api from "@/lib/api";
import type { Market, Side, WsServerMessage, AccountTradeRecord } from "@/lib/types";
import { useAccount } from "@/providers/AccountProvider";
import { useWs } from "@/providers/WebSocketProvider";
import {
  computeCostBasis,
  formatPnlDollars,
  formatPnlPercent,
  formatRelativeTime,
  formatAbsoluteTime,
  type CostBasisState,
} from "@/lib/portfolio";
import { formatDollars } from "@/lib/format";
import { useTheme } from "@/providers/ThemeProvider";
import { useOrderBook } from "@/hooks/useOrderBook";
import { useOrders } from "@/hooks/useOrders";
import DuelOrderBook from "@/components/trading/DuelOrderBook";
import PriceChart from "@/components/trading/PriceChart";
import { TradeTape } from "@/components/trading/TradeTape";
import { MarketLiveStats } from "@/components/trading/MarketLiveStats";
import { ResolvesInChip } from "@/components/ResolvesInChip";
import { useSessionKey, SessionKeyModal } from "@/components/SessionKeyManager";
import { MarketImage } from "@/components/MarketImage";
import { ConditionalBanner } from "@/components/ConditionalBanner";
import { ConditionalWarningIcon } from "@/components/ConditionalWarningIcon";
import { useParentMarket } from "@/hooks/useParentMarket";
import { HashLink } from "@/components/HashLink";
import {
  fonts,
  space,
  radii,
  lightTheme,
  darkTheme,
  type,
  motion,
  getTradeStyles,
  ticksToPrice,
  ticksToPct,
  type OracleTheme,
} from "@/lib/oracle-theme";

type MarketFull = Market & { status_raw: string };

// =============================================================================
// Main Page
// =============================================================================

export default function MarketPage() {
  const params = useParams();
  const marketId = params.id as string;
  const { account, walletClient, updateBalance } = useAccount();
  const { addListener } = useWs();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const th = isDark ? darkTheme : lightTheme;
  const s = getTradeStyles(th);

  const [market, setMarket] = useState<MarketFull | null>(null);
  const book = useOrderBook(marketId);

  // Subscribe to balance_update events so the cached balance stays fresh
  // after trades placed on this page (matches portfolio / home pattern).
  // Without this, users who trade here and never visit Portfolio see a stale
  // balance in the navbar and order-entry "Est. Cost" previews.
  const accountId = account?.address ?? null;
  useEffect(() => {
    if (!accountId) return;
    const remove = addListener((msg: WsServerMessage) => {
      if (msg.type === "balance_update") updateBalance(msg.balance);
    });
    return remove;
  }, [accountId, addListener, updateBalance]);

  // Prefill state from orderbook clicks
  const [prefillPrice, setPrefillPrice] = useState<number | null>(null);
  const [prefillOutcome, setPrefillOutcome] = useState<"yes" | "no" | null>(null);
  const qtyInputRef = useRef<HTMLInputElement>(null);

  const handlePriceClick = (price: number, side: string) => {
    setPrefillPrice(price);
    setPrefillOutcome(side as "yes" | "no");
    setTimeout(() => {
      if (qtyInputRef.current) {
        qtyInputRef.current.focus();
        qtyInputRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }, 50);
  };

  const refresh = useCallback(() => {
    api.getMarket(marketId).then(setMarket).catch(console.error);
  }, [marketId]);

  useEffect(() => { refresh(); }, [refresh]);

  if (!market) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        height: "calc(100vh - 48px)",
        backgroundColor: th.bg,
        color: th.textSecondary,
        fontFamily: fonts.sans,
        fontStyle: "italic",
      }}>
        Loading market...
      </div>
    );
  }

  // Derive prices from live book
  const bestBid = book.bids.length > 0 ? book.bids[0].price : null;
  const bestAsk = book.asks.length > 0 ? book.asks[0].price : null;
  const mid = bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : bestBid ?? bestAsk ?? null;
  const yesPrice = mid != null ? mid / 1000 : 0.5;
  const noPrice = 1 - yesPrice;
  const yesPct = mid != null ? ticksToPct(mid) : 50;
  const isYesFavored = yesPct >= 50;

  return (
    <div style={{ ...s.pageShell, padding: space[6] }}>
      {/* Two-column grid */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 380px",
        gap: space[12],
        maxWidth: 1380,
        margin: "0 auto",
        width: "100%",
      }}>
        {/* Left column */}
        <div>
          <MarketHeader
            market={market}
            marketId={marketId}
            yesPrice={yesPrice}
            noPrice={noPrice}
            yesPct={yesPct}
            isYesFavored={isYesFavored}
            th={th}
            account={account}
            onResolved={refresh}
          />
          {/* Conditional context banner -- rendered above the chart only when
              this market is a child of another. ConditionalBanner returns
              null otherwise, so it's safe to drop here unconditionally. */}
          <ConditionalBanner
            parentMarketId={market.parent_market_id}
            parentOutcome={market.parent_outcome}
            th={th}
          />
          <PriceChart marketId={marketId} th={th} s={s} />
          {/* Orderbook + Trade Tape (M1) side-by-side on desktop, stacked on
              narrow screens. `market-orderbook-row` defines the 1fr/220px
              grid at >=1024px with `align-items: stretch` so the tape
              matches the orderbook's height, and collapses to a single
              column below that. On <640px the tape is hidden entirely
              (see .market-trade-tape below) to keep the motion budget
              sane on mobile -- mobile users see trades via the home-page
              SitewideTradeTape instead.
              Placed in a div rather than adding a third top-level column
              to keep the existing `1fr 380px` page grid + the sticky
              trade panel untouched. */}
          <div className="market-orderbook-row" style={{ marginBottom: space[8] }}>
            <DuelOrderBook marketId={marketId} liveBids={book.bids} liveAsks={book.asks} />
            <div className="market-trade-tape">
              <TradeTape marketId={marketId} th={th} />
            </div>
          </div>
          <DataTabs marketId={marketId} market={market} th={th} s={s} book={book} />
          <ResolutionCriteria th={th} />
        </div>

        {/* Right column (sticky trade panel) */}
        <aside>
          <TradePanel
            marketId={marketId}
            statusRaw={market.status_raw}
            parentMarketId={market.parent_market_id}
            parentOutcome={market.parent_outcome}
            yesPrice={yesPrice}
            noPrice={noPrice}
            yesPct={yesPct}
            bestBid={bestBid}
            bestAsk={bestAsk}
            th={th}
            s={s}
            prefillPrice={prefillPrice}
            prefillOutcome={prefillOutcome}
            qtyInputRef={qtyInputRef}
          />
        </aside>
      </div>
    </div>
  );
}

// =============================================================================
// MarketHeader
// =============================================================================

function MarketHeader({
  market,
  marketId,
  yesPrice,
  noPrice,
  yesPct,
  isYesFavored,
  th,
  account,
  onResolved,
}: {
  market: MarketFull;
  marketId: string;
  yesPrice: number;
  noPrice: number;
  yesPct: number;
  isYesFavored: boolean;
  th: OracleTheme;
  account: { address: `0x${string}` } | null;
  onResolved: () => void;
}) {
  return (
    <div style={{
      paddingBottom: space[6],
      borderBottom: `0.8px solid ${th.border}`,
      marginBottom: space[8],
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: space[3], marginBottom: space[3] }}>
        <Link href="/" style={{
          ...type.tabLabel,
          color: th.textSecondary,
          textDecoration: "none",
          cursor: "pointer",
          transition: motion.hoverTransition,
        }}>
          &larr; Back
        </Link>
        <span style={{ color: th.textTertiary }}>|</span>
        <span style={{ ...type.metaLabel, color: th.textTertiary }}>
          {market.status === "Open" ? "Live" : market.status}
        </span>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: space[4] }}>
        {/* Thumbnail (72px) + question */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: space[4], flex: 1, minWidth: 0 }}>
          <div style={{ flexShrink: 0, marginTop: 2 }}>
            <MarketImage
              src={market.image_url}
              alt={market.question}
              size={72}
              radius={8}
              th={th}
            />
          </div>
          <h1 style={{
            fontFamily: fonts.serif,
            fontSize: 32,
            fontWeight: 400,
            lineHeight: 1.2,
            letterSpacing: "-0.02em",
            color: th.textPrimary,
            margin: 0,
            flex: 1,
            minWidth: 0,
          }}>
            {market.question}
          </h1>
        </div>

        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{
            fontFamily: fonts.mono,
            fontSize: 48,
            fontWeight: 400,
            letterSpacing: "-0.02em",
            lineHeight: 1,
            color: isYesFavored ? th.yes : th.no,
          }}>
            {yesPct}%
          </div>
          <div style={{ ...type.metaLabel, color: th.textTertiary, marginTop: 4 }}>
            {isYesFavored ? "YES" : "NO"} chance
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: space[6], marginTop: space[4], alignItems: "center", flexWrap: "wrap" as const }}>
        <span style={{ ...type.volumeLabel, color: th.textSecondary }}>
          {market.status === "Open" ? "Live" : market.status}
        </span>
        <span style={{ ...type.volumeLabel, color: th.textTertiary }}>---</span>
        <span style={{ ...type.volumeLabel, color: th.textSecondary }}>
          Market #{market.id}
        </span>
        {/* Resolves-in countdown -- renders nothing when the backend hasn't
            yet exposed `resolves_at`. No layout shift when the field lands. */}
        <ResolvesInChip
          resolvesAt={market.resolves_at}
          isResolved={market.status !== "Open"}
          th={th}
          variant="header"
        />
        {market.status === "Open" && account && Boolean(
          process.env.NEXT_PUBLIC_ADMIN_ADDRESS &&
          account.address.toLowerCase() === process.env.NEXT_PUBLIC_ADMIN_ADDRESS.toLowerCase()
        ) && (
          <ResolveButton marketId={Number(market.id)} onResolved={onResolved} th={th} />
        )}
      </div>

      {/* M3 Header live stats: last-trade age, 1h vol, 5m active. Hidden when
          the market is closed/resolved -- the numbers would just freeze at
          whatever was final, and the surface is already dedicating space to
          the resolution state in that case. */}
      {market.status === "Open" && (
        <div style={{ marginTop: space[3] }}>
          <MarketLiveStats marketId={marketId} th={th} />
        </div>
      )}
    </div>
  );
}

// PriceChart: moved to @/components/trading/PriceChart.tsx (lightweight-charts)

// =============================================================================
// TradePanel
// =============================================================================

function TradePanel({
  marketId,
  statusRaw,
  parentMarketId,
  parentOutcome,
  yesPrice,
  noPrice,
  yesPct,
  bestBid,
  bestAsk,
  th,
  s,
  prefillPrice,
  prefillOutcome,
  qtyInputRef,
}: {
  marketId: string;
  /** Rust-debug-formatted status string from the chain API:
   *   "Open" | "Resolved(Yes)" | "Resolved(No)" | "Resolved(Unknown)" | "Closed".
   * Drives whether this panel renders the interactive order form or a
   * read-only terminal-state summary. Using the raw string (not the collapsed
   * `market.status` enum) is load-bearing: we need to distinguish YES/NO/Unknown
   * resolutions for the settlement mechanic copy. */
  statusRaw: string;
  /** Parent market id when this market is a conditional child; otherwise `null`.
   * Drives the inline 50/50-void disclaimer rendered above the submit button. */
  parentMarketId: number | null;
  /** Outcome of the parent that activates this child market ("Yes" / "No"). */
  parentOutcome: string | null;
  yesPrice: number;
  noPrice: number;
  yesPct: number;
  bestBid: number | null;
  bestAsk: number | null;
  th: OracleTheme;
  s: ReturnType<typeof getTradeStyles>;
  prefillPrice: number | null;
  prefillOutcome: "yes" | "no" | null;
  qtyInputRef: React.RefObject<HTMLInputElement | null>;
}) {
  // Derived terminal-state flag: if the chain has resolved (or closed) this
  // market, any order-placement tx will be rejected. We render a read-only
  // settlement summary further down instead of the interactive form.
  //
  // NOT gated via an early return because `statusRaw` can change during the
  // component's lifetime (admin resolves while user is on the page) -- an
  // early return would violate the Rules of Hooks by switching hook order
  // on that transition. Instead the hooks always run and we branch in JSX.
  const isTerminal = statusRaw !== "Open";

  // Resolve parent question for the void disclaimer. Re-uses the same hook the
  // ConditionalBanner relies on, so we avoid double-fetching: React's identity
  // cache + dedupe behaviour from useParentMarket means both call sites share
  // a render-cycle network round-trip. Returns sentinel state ("loading" /
  // "missing") that lets us gracefully fall back to "the parent market".
  const parentInfo = useParentMarket(parentMarketId, parentOutcome);
  const isConditional = parentMarketId != null;
  const parentLabel = parentInfo.parent?.question ?? null;
  const oppositeOutcome = parentOutcome
    ? parentOutcome.toLowerCase() === "yes" ? "NO" : "YES"
    : "the opposite outcome";
  const { account, walletClient, refresh: refreshAccount } = useAccount();
  const { isActive: hasSessionKey } = useSessionKey();
  const [activeOutcome, setActiveOutcome] = useState<"yes" | "no">(prefillOutcome || "yes");
  const [activeSide, setActiveSide] = useState<"buy" | "sell">("buy");
  const [orderType, setOrderType] = useState<"limit" | "market">("limit");
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSessionKeyModal, setShowSessionKeyModal] = useState(false);

  // Sync prefill from orderbook clicks
  useEffect(() => {
    if (prefillPrice !== null && prefillPrice !== undefined) {
      setPrice(prefillPrice.toFixed(3));
    }
  }, [prefillPrice]);

  useEffect(() => {
    if (prefillOutcome) {
      setActiveOutcome(prefillOutcome);
    }
  }, [prefillOutcome]);

  const parsedPrice = parseFloat(price) || 0;
  const parsedQty = parseInt(qty) || 0;

  // Convert display price (0.620) to ticks (620) for submission
  const priceTicks = Math.round(parsedPrice * 1000);
  // Map (outcome, side) to chain-level (Side, price):
  //   Buy  YES -> chain Buy  at priceTicks
  //   Sell YES -> chain Sell at priceTicks
  //   Buy  NO  -> chain Sell at (1000 - priceTicks)
  //   Sell NO  -> chain Buy  at (1000 - priceTicks)
  const isNoOutcome = activeOutcome === "no";
  const submitTicks = isNoOutcome ? 1000 - priceTicks : priceTicks;
  const isBuying = activeSide === "buy";
  const submitSide: Side = (isBuying && !isNoOutcome) || (!isBuying && isNoOutcome) ? "Buy" : "Sell";

  // Compute market order price with buffer to avoid locking excessive collateral.
  // Buffer = max(50 ticks, 10% of reference price) -- enough to sweep the book
  // without locking 4x more collateral than needed.
  const computeMarketPrice = (): number => {
    // Chain-level: submitSide "Buy" sweeps asks (high price), "Sell" sweeps bids (low price)
    if (submitSide === "Buy") {
      if (bestAsk == null) return 999;
      const buffer = Math.max(50, Math.round(bestAsk * 0.1));
      return Math.min(bestAsk + buffer, 999);
    } else {
      if (bestBid == null) return 1;
      const buffer = Math.max(50, Math.round(bestBid * 0.1));
      return Math.max(bestBid - buffer, 1);
    }
  };

  const marketPriceTicks = orderType === "market" ? computeMarketPrice() : submitTicks;

  const effectivePrice = orderType === "market"
    ? (activeOutcome === "yes"
        ? (isBuying
            ? (bestAsk != null ? bestAsk / 1000 : 0.5)
            : (bestBid != null ? bestBid / 1000 : 0.5))
        : (isBuying
            ? (bestBid != null ? (1000 - bestBid) / 1000 : 0.5)
            : (bestAsk != null ? (1000 - bestAsk) / 1000 : 0.5)))
    : parsedPrice;

  const estCost = effectivePrice * parsedQty;
  const potentialReturn = isBuying ? parsedQty * 1.0 - estCost : estCost;
  const fee = estCost * 0.0009;

  // Dollar-risk (Max loss) — the framing retail users actually grok.
  // user-advocate flagged "BUY 0.55 x 100 shares = $55" as too abstract:
  // most users want "you are risking $X" stated explicitly.
  //
  // For binary [0,1] outcomes:
  //   BUY  at price P, qty Q: pay P*Q upfront. If the bet loses you forfeit
  //                            the whole premium -> max loss = P * Q (= estCost).
  //   SELL at price P, qty Q: receive P*Q now, owe 1*Q back if the bet
  //                            loses -> max loss = (1 - P) * Q.
  //
  // `effectivePrice` is already in DOLLARS (0..1), `parsedQty` is share
  // count, so the product is dollars — same convention as `estCost` above.
  // For market orders this is an estimate based on top-of-book.
  const maxLossDollars = isBuying
    ? estCost
    : (1 - effectivePrice) * parsedQty;

  // Empty-book guard: when both sides of the book are empty AND the user is
  // placing a market order, `effectivePrice` falls back to the 0.5 default —
  // which makes the Max-loss line show a fabricated dollar number ("$50.00"
  // on 100 shares) even though there's literally no liquidity to estimate
  // against. Show "--" instead so we don't lie about the risk. Limit orders
  // are unaffected (the user is providing the price themselves).
  const bookIsEmpty = bestBid == null && bestAsk == null;
  const maxLossUnknown = orderType === "market" && bookIsEmpty;

  const isValid = parsedQty > 0 && (orderType === "market" || parsedPrice > 0);

  const handleSubmit = async () => {
    if (!isValid || !account) return;
    // Require either a wallet client or an active session key for signing
    if (!walletClient && !hasSessionKey) {
      setError("Connect wallet or enable a session key to trade");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await api.placeOrder(walletClient, account.address, {
        market_id: parseInt(marketId),
        side: submitSide,
        price: orderType === "market" ? marketPriceTicks : submitTicks,
        quantity: parsedQty,
        // Market orders use IOC so any unfilled remainder is cancelled
        // instead of resting on the book at an aggressive price (which
        // would be toxic liquidity for the user). Limit orders stay GTC.
        ...(orderType === "market" ? { time_in_force: "IOC" as const } : {}),
      });
      // Refresh account balance/nonce after the order settles. The WS
      // `balance_update` fast-path normally handles this, but subscribing
      // happens elsewhere and we want an authoritative sync in case the
      // event was missed (dropped WS, race, etc.). Also ensures the cached
      // balance reflects locked collateral for resting limit orders.
      refreshAccount().catch(() => { /* non-fatal */ });
      setConfirmed(true);
      setTimeout(() => {
        setConfirmed(false);
        setPrice("");
        setQty("");
      }, 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Order failed");
    } finally {
      setSubmitting(false);
    }
  };

  const outcomeLabel = activeOutcome === "yes" ? "YES" : "NO";
  const sideLabel = `${isBuying ? "Buy" : "Sell"} ${outcomeLabel}`;

  // Render a read-only settlement summary for terminal markets. The chart +
  // orderbook remain visible on the left column so users retain full
  // historical context; this panel just replaces the interactive form.
  if (isTerminal) {
    return <ResolvedTradePanel statusRaw={statusRaw} th={th} s={s} />;
  }

  return (
    <div style={{ ...s.tradePanel, position: "relative" }}>

      {/* Header */}
      <div style={s.tradePanelHeader}>Place Prediction</div>

      {/* Outcome selector */}
      <div style={{ ...type.metaLabel, color: th.textTertiary, marginBottom: space[2] }}>
        Outcome
      </div>
      <div style={s.tradeOutcomeContainer}>
        <button
          style={s.tradeOutcomeBtn(activeOutcome === "yes")}
          onClick={() => setActiveOutcome("yes")}
        >
          <span style={s.tradeOutcomeLabel(activeOutcome === "yes")}>Yes</span>
          <div style={s.tradeOutcomePrice}>${yesPrice.toFixed(3)}</div>
        </button>
        <button
          style={s.tradeOutcomeBtn(activeOutcome === "no")}
          onClick={() => setActiveOutcome("no")}
        >
          <span style={s.tradeOutcomeLabel(activeOutcome === "no")}>No</span>
          <div style={s.tradeOutcomePrice}>${noPrice.toFixed(3)}</div>
        </button>
      </div>

      {/* Buy / Sell toggle */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 1,
        background: th.border,
        marginBottom: space[6],
      }}>
        <button
          style={{
            background: activeSide === "buy" ? th.yes : th.outcomeInactiveBg,
            border: "none",
            borderRadius: 0,
            padding: "10px 0",
            cursor: "pointer",
            textAlign: "center" as const,
            transition: "all 300ms ease",
            ...type.tabLabel,
            fontWeight: 600,
            color: activeSide === "buy" ? "#000000" : th.textSecondary,
            letterSpacing: "0.06em",
          }}
          onClick={() => setActiveSide("buy")}
        >
          Buy
        </button>
        <button
          style={{
            background: activeSide === "sell" ? th.no : th.outcomeInactiveBg,
            border: "none",
            borderRadius: 0,
            padding: "10px 0",
            cursor: "pointer",
            textAlign: "center" as const,
            transition: "all 300ms ease",
            ...type.tabLabel,
            fontWeight: 600,
            color: activeSide === "sell" ? "#FFFFFF" : th.textSecondary,
            letterSpacing: "0.06em",
          }}
          onClick={() => setActiveSide("sell")}
        >
          Sell
        </button>
      </div>

      {/* Order type tabs */}
      <div style={s.tradeOrderTypeTabs}>
        <button
          style={s.tradeOrderTypeTab(orderType === "limit")}
          onClick={() => setOrderType("limit")}
        >
          Limit
        </button>
        <button
          style={s.tradeOrderTypeTab(orderType === "market")}
          onClick={() => setOrderType("market")}
        >
          Market
        </button>
      </div>

      {/* Price input (limit) or best-available (market) */}
      {orderType === "limit" ? (
        <div style={s.tradePriceInputGroup}>
          <label style={s.tradePriceLabel}>Limit Price</label>
          <input
            type="text"
            style={s.tradePriceInput}
            placeholder="0.000"
            value={price}
            onChange={e => {
              const val = e.target.value;
              if (/^\d*\.?\d*$/.test(val)) setPrice(val);
            }}
          />
        </div>
      ) : (
        <div style={{ marginBottom: space[5] }}>
          <span style={{ ...type.metaLabel, color: th.textTertiary }}>
            Best available: <span style={{ fontFamily: fonts.mono, color: th.textPrimary }}>
              {activeOutcome === "yes"
                ? (isBuying
                    ? (bestAsk != null ? `$${(bestAsk / 1000).toFixed(3)}` : "--")
                    : (bestBid != null ? `$${(bestBid / 1000).toFixed(3)}` : "--"))
                : (isBuying
                    ? (bestBid != null ? `$${((1000 - bestBid) / 1000).toFixed(3)}` : "--")
                    : (bestAsk != null ? `$${((1000 - bestAsk) / 1000).toFixed(3)}` : "--"))}
            </span>
          </span>
        </div>
      )}

      {/* Quantity input */}
      <div style={s.tradeQtyInputGroup}>
        <label style={s.tradePriceLabel}>Shares</label>
        <input
          ref={qtyInputRef}
          type="text"
          style={s.tradeQtyInput}
          placeholder="0"
          value={qty}
          onChange={e => {
            const val = e.target.value;
            if (/^\d*$/.test(val)) setQty(val);
          }}
        />
        {/* Quick-set buttons */}
        <div style={{ display: "flex", gap: space[2], marginTop: space[2] }}>
          {[10, 25, 50, 100].map(v => (
            <button
              key={v}
              style={{
                ...type.metaLabel,
                fontFamily: fonts.mono,
                color: th.textSecondary,
                background: "transparent",
                border: `0.8px solid ${th.border}`,
                borderRadius: radii.sm,
                padding: "4px 10px",
                cursor: "pointer",
                transition: motion.hoverTransition,
              }}
              onClick={() => setQty(String(v))}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Cost summary */}
      <div style={s.tradeCostSummary}>
        <div style={s.tradeCostRow}>
          <span style={s.tradeCostLabel}>{isBuying ? "Est. Cost" : "Est. Proceeds"}</span>
          <span style={s.tradeCostValue}>
            {isValid ? `$${estCost.toFixed(2)}` : "---"}
          </span>
        </div>
        {/* Max loss — the dollar-risk framing retail users actually grok.
            Hidden when qty is empty/zero (no "Max loss: $0.00" noise).
            Amber/warning tint matches ConditionalWarningIcon — soft, not
            alarmist (red would train users to ignore it). Tooltip lives on
            both label and value spans so any hover surfaces it. For market
            orders we prefix "~" because effectivePrice is a top-of-book
            estimate, not a guaranteed fill. */}
        {isValid && parsedQty > 0 && (
          <div style={s.tradeCostRow}>
            <span
              style={{ ...s.tradeCostLabel, color: th.isDark ? "#EAB308" : "#B45309", cursor: "help" }}
              title={maxLossUnknown
                ? "No liquidity on the book — can't estimate max loss. Place a limit order to set your own price."
                : "If the market resolves against you, you lose this much. Maximum possible loss."}
            >
              Max loss
            </span>
            <span
              style={{ ...s.tradeCostValue, color: th.isDark ? "#EAB308" : "#B45309", cursor: maxLossUnknown ? "help" : undefined }}
              title={maxLossUnknown
                ? "No liquidity on the book — can't estimate max loss. Place a limit order to set your own price."
                : "If the market resolves against you, you lose this much. Maximum possible loss."}
            >
              {maxLossUnknown
                ? "--"
                : `${orderType === "market" ? "~" : ""}$${maxLossDollars.toFixed(2)}`}
            </span>
          </div>
        )}
        <div style={s.tradeCostRow}>
          {/* Existing row: kept for parity with prior UI. Renamed sell-side
              label from the old "Max Loss" (which was misleading — value
              shown was `estCost`, the proceeds, not the loss) to
              "Potential Return". The dedicated Max-loss row above now
              carries the correct dollar-risk number for both sides. */}
          <span style={s.tradeCostLabel}>Potential Return</span>
          <span style={s.tradeCostValueAccent(isBuying ? potentialReturn > 0 : true)}>
            {isValid ? `$${potentialReturn.toFixed(2)}` : "---"}
          </span>
        </div>
        <div style={s.tradeCostRow}>
          <span style={s.tradeCostLabel}>Fee (9 bps)</span>
          <span style={s.tradeCostValue}>
            {isValid ? `$${fee.toFixed(4)}` : "---"}
          </span>
        </div>
        {/* Conditional-void disclaimer: surfaced inline so users see the 50/50
            void condition before clicking Buy/Sell. We don't gate the trade
            with a checkbox -- the chain ConditionalBanner above already
            establishes the rule, this is a final-mile reminder at the moment
            of commitment. Amber tint matches ConditionalWarningIcon for a
            consistent visual language across the void mechanic. */}
        {isConditional && (
          <div
            role="note"
            aria-label={
              parentLabel
                ? `Voids at 50/50 if "${parentLabel}" resolves ${oppositeOutcome}`
                : `Voids at 50/50 if parent market resolves ${oppositeOutcome}`
            }
            style={{
              ...s.tradeCostRow,
              alignItems: "flex-start",
              gap: 6,
              marginTop: 6,
              paddingTop: 8,
              borderTop: `0.8px solid ${th.border}`,
              fontFamily: fonts.sans,
              fontSize: 11,
              lineHeight: 1.45,
              color: th.isDark ? "#EAB308" : "#B45309",
            }}
          >
            <span aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }}>&#9888;</span>
            <span style={{ flex: 1, textAlign: "left" }}>
              Voids at 50&cent; per share if{" "}
              {parentLabel
                ? <em style={{ fontStyle: "italic" }}>&ldquo;{parentLabel}&rdquo;</em>
                : "the parent market"}{" "}
              resolves <strong style={{ fontWeight: 600 }}>{oppositeOutcome}</strong>.
            </span>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div style={{ fontSize: 12, color: th.no, marginBottom: 12 }}>{error}</div>
      )}

      {/* Session key indicator */}
      {account && hasSessionKey && (
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: space[3],
        }}>
          <span style={{
            display: "inline-block",
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "#22C55E",
            boxShadow: "0 0 4px rgba(34, 197, 94, 0.4)",
          }} />
          <span style={{
            ...type.metaLabel,
            color: "#22C55E",
            letterSpacing: "0.08em",
          }}>
            Instant Trading
          </span>
        </div>
      )}

      {/* Submit button */}
      <button
        style={{
          ...(isBuying ? s.tradeSubmitBtnBuy : s.tradeSubmitBtnSell),
          opacity: isValid && account ? 1 : 0.4,
          cursor: isValid && account ? "pointer" : "not-allowed",
        }}
        onClick={handleSubmit}
        disabled={!isValid || !account || submitting}
        onMouseDown={e => { if (isValid) (e.currentTarget as HTMLButtonElement).style.transform = "scale(0.98)"; }}
        onMouseUp={e => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"; }}
      >
        {!account ? "Connect Wallet" : submitting ? "Submitting..." : confirmed ? "Confirmed" : sideLabel}
      </button>

      {/* Enable session key prompt (when no session key) */}
      {account && !hasSessionKey && (
        <button
          onClick={() => setShowSessionKeyModal(true)}
          style={{
            ...type.metaLabel,
            width: "100%",
            marginTop: space[3],
            padding: "8px 0",
            background: "transparent",
            border: `0.8px solid rgba(34, 197, 94, 0.45)`,
            borderRadius: radii.sm,
            color: "rgba(34, 197, 94, 0.8)",
            cursor: "pointer",
            transition: motion.hoverTransition,
            letterSpacing: "0.08em",
          }}
        >
          Enable instant trading (no popups)
        </button>
      )}

      {/* Session key modal */}
      {showSessionKeyModal && (
        <SessionKeyModal onClose={() => setShowSessionKeyModal(false)} />
      )}

      {/* Probability bar */}
      <div style={s.tradeProbBar}>
        <span style={s.metaLabel}>Market Probability</span>
        <div style={s.tradeProbBarTrack}>
          <div style={s.tradeProbBarFill(yesPct)} />
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// ResolvedTradePanel -- read-only settlement summary for terminal markets
// =============================================================================

/**
 * Read-only panel that replaces the interactive order form once the market
 * has resolved or otherwise entered a non-Open state. The chain rejects all
 * PlaceOrder txs against non-Open markets, so we deliberately strip every
 * interactive surface (outcome pills, Buy/Sell toggle, Limit/Market tabs,
 * price/qty inputs, submit button, session-key prompt) and render only the
 * settlement mechanic.
 *
 * Copy focuses on the *mechanic* (what each share paid out) -- the parent
 * ConditionalBanner rendered at the top of the page is the one responsible
 * for explaining *why* a child voided via parent cascade, so we don't duplicate
 * that context here.
 *
 * Accepts the full `statusRaw` string (not the collapsed enum) to distinguish
 * `Resolved(Yes)` vs `Resolved(No)` vs `Resolved(Unknown)`.
 */
function ResolvedTradePanel({
  statusRaw,
  th,
  s,
}: {
  statusRaw: string;
  th: OracleTheme;
  s: ReturnType<typeof getTradeStyles>;
}) {
  // Derive header/body strings from the raw debug-formatted status. Each
  // branch is explicit (rather than regex) so future variants we haven't
  // mapped yet fall into a defensive default instead of silently rendering
  // wrong settlement copy.
  const { title, body, accent, accentBg } = (() => {
    if (statusRaw === "Resolved(Yes)") {
      return {
        title: "MARKET RESOLVED YES",
        body: "YES holders paid $1.00 per share. NO holders paid $0.00 per share.",
        accent: th.yes,
        accentBg: th.isDark ? "rgba(34,197,94,0.10)" : "rgba(34,197,94,0.08)",
      };
    }
    if (statusRaw === "Resolved(No)") {
      return {
        title: "MARKET RESOLVED NO",
        body: "NO holders paid $1.00 per share. YES holders paid $0.00 per share.",
        accent: th.no,
        accentBg: th.isDark ? "rgba(239,68,68,0.10)" : "rgba(239,68,68,0.08)",
      };
    }
    if (statusRaw === "Resolved(Unknown)") {
      return {
        title: "MARKET VOIDED",
        body: "All positions settled at $0.50 per share, regardless of cost basis.",
        // Amber: mirrors ConditionalWarningIcon / void-disclaimer palette.
        // These hex values are used in 6+ places across the frontend (see
        // ConditionalWarningIcon, ConditionalBanner, ResolvesInChip,
        // portfolio page). Not yet promoted to `oracle-theme.ts` tokens
        // because the palette is scoped to the void/pending-settlement
        // semantic only; when it expands or needs dark-mode tuning we
        // should hoist them into `OracleTheme.warnFg` / `warnBg`.
        accent: th.isDark ? "#EAB308" : "#B45309",
        accentBg: th.isDark ? "rgba(234,179,8,0.10)" : "rgba(234,179,8,0.08)",
      };
    }
    if (statusRaw === "MissingMarket" || statusRaw === "Unknown") {
      // Defensive sentinel -- we have positions but the /market lookup
      // returned no owning record. Distinct from `Resolved(Unknown)`
      // which is a legitimate 50/50 void resolution. Render as
      // "settlement pending" so the user knows funds aren't lost -- the
      // chain just hasn't surfaced a status yet (usually a transient
      // propagation gap). Re-uses the amber palette because this is a
      // warning-adjacent state, not a clean terminal. The chain is
      // transitioning from `"Unknown"` to `"MissingMarket"` for this
      // case; we handle both until the rename ships.
      return {
        title: "SETTLEMENT PENDING",
        body: "This market is being finalized. Payouts will credit automatically once resolution propagates.",
        accent: th.isDark ? "#EAB308" : "#B45309",
        accentBg: th.isDark ? "rgba(234,179,8,0.10)" : "rgba(234,179,8,0.08)",
      };
    }
    // Defensive fallback: covers `"Closed"` and any future terminal variant
    // we haven't explicitly handled. We intentionally don't try to invent
    // settlement numbers here -- just say the market is closed to trading.
    return {
      title: "MARKET CLOSED",
      body: "This market is no longer accepting orders.",
      accent: th.textSecondary,
      accentBg: th.isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)",
    };
  })();

  return (
    <div
      role="status"
      aria-live="polite"
      style={{ ...s.tradePanel, position: "relative" }}
    >
      {/* Header mirrors the active TradePanel's header slot so the sticky
          right rail doesn't jump vertically between Open and Resolved
          renders of the same market. */}
      <div style={s.tradePanelHeader}>Settlement</div>

      <div
        style={{
          padding: `${space[4]}px ${space[4]}px`,
          borderRadius: radii.md,
          background: accentBg,
          border: `0.8px solid ${th.border}`,
          marginBottom: space[4],
        }}
      >
        <div
          style={{
            ...type.metaLabel,
            color: accent,
            letterSpacing: "0.08em",
            marginBottom: space[2],
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontFamily: fonts.sans,
            fontSize: 13,
            lineHeight: 1.55,
            color: th.textPrimary,
          }}
        >
          {body}
        </div>
      </div>

      <div
        style={{
          fontFamily: fonts.sans,
          fontSize: 11,
          lineHeight: 1.5,
          color: th.textTertiary,
        }}
      >
        Payouts have been credited to holders&rsquo; balances automatically.
        View your position history on the{" "}
        <Link
          href="/portfolio"
          style={{ color: th.textSecondary, textDecoration: "underline" }}
        >
          Portfolio
        </Link>{" "}
        page.
      </div>
    </div>
  );
}

// =============================================================================
// DataTabs (Trades / Open Orders / Position)
// =============================================================================

function DataTabs({
  marketId,
  market,
  th,
  s,
  book,
}: {
  marketId: string;
  market: MarketFull;
  th: OracleTheme;
  s: ReturnType<typeof getTradeStyles>;
  book: { bids: { price: number; quantity: number }[]; asks: { price: number; quantity: number }[]; spread: number | null };
}) {
  const { account, walletClient, refresh: refreshAccount } = useAccount();
  const { isActive: hasSessionKey } = useSessionKey();
  const orders = useOrders();
  const { addListener } = useWs();
  const [position, setPosition] = useState<{ yes_quantity: number; no_quantity: number } | null>(null);
  // Market-wide "Trades" tab was removed from this panel because the
  // right-rail TradeTape already surfaces the same live feed. Default
  // tab is now "My Trades" (for connected wallets) or "Open Orders".
  const [activeTab, setActiveTab] = useState<"mytrades" | "orders" | "position">("mytrades");
  const [costBasis, setCostBasis] = useState<CostBasisState | null>(null);
  const [myTrades, setMyTrades] = useState<AccountTradeRecord[]>([]);
  const [closingPosition, setClosingPosition] = useState<string | null>(null); // "YES" | "NO" | null
  const [closeError, setCloseError] = useState<string | null>(null);

  // Cancel-All state. We keep an optimistic set of "pending cancel" order ids
  // so the rows disappear from the list immediately on click; on partial
  // failure we restore the failed ids by clearing them from the set after the
  // batch resolves. The status banner reports success / partial failure for a
  // few seconds and then auto-dismisses.
  const [confirmCancelAll, setConfirmCancelAll] = useState(false);
  const [cancellingAll, setCancellingAll] = useState(false);
  const [pendingCancelIds, setPendingCancelIds] = useState<Set<string>>(new Set());
  const [cancelAllStatus, setCancelAllStatus] = useState<
    | { kind: "success"; count: number }
    | { kind: "partial"; ok: number; total: number }
    | { kind: "error"; message: string }
    | null
  >(null);
  const [closeModalPos, setCloseModalPos] = useState<{ side: "YES" | "NO"; qty: number } | null>(null);

  // Mounted-ref pattern: the Cancel-All batch loop is sequential and can
  // outlive the component if the user navigates away mid-cancel. We must NOT
  // abort the in-flight cancellations (the user wants their orders gone even
  // after navigation) — we only suppress the post-batch UI state setters and
  // clear the auto-dismiss timer to avoid a setTimeout leak + dev-mode warnings
  // about setState on an unmounted component.
  const mountedRef = useRef(true);
  const cancelAllTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (cancelAllTimeoutRef.current !== null) {
        clearTimeout(cancelAllTimeoutRef.current);
        cancelAllTimeoutRef.current = null;
      }
    };
  }, []);

  const marketOrdersAll = orders.filter((o) => String(o.market_id) === String(marketId));
  // Optimistic: rows in `pendingCancelIds` are hidden from the visible list
  // immediately on Cancel-All click. They reappear if the cancel txn fails
  // (we drop them from the pending set when the batch completes).
  const marketOrders = marketOrdersAll.filter((o) => !pendingCancelIds.has(o.id));

  // Cancel each order via the existing per-order signing flow, sequentially.
  //
  // Why sequential: `api.cancelOrder` does its own `getAccount(addr)` to
  // read the current nonce. Running in parallel would have every call read
  // the same nonce and only one would land — the rest would fail with
  // nonce-mismatch. Awaiting each in turn lets the chain advance the nonce
  // between submissions. With session keys this is ~50ms/cancel (network-
  // bound, not signing-bound). Without session keys the user already has
  // to approve each in their wallet, so sequencing is what they expect.
  const handleCancelAll = useCallback(async () => {
    if (!account) return;
    if (!walletClient && !hasSessionKey) {
      setCancelAllStatus({ kind: "error", message: "Connect wallet or enable a session key to cancel" });
      return;
    }
    const ids = marketOrdersAll.map((o) => o.id);
    if (ids.length === 0) {
      setConfirmCancelAll(false);
      return;
    }
    setConfirmCancelAll(false);
    setCancellingAll(true);
    setCancelAllStatus(null);
    setPendingCancelIds(new Set(ids));

    const failedIds = new Set<string>();
    let ok = 0;
    for (const id of ids) {
      try {
        await api.cancelOrder(walletClient, account.address, parseInt(id, 10));
        ok += 1;
      } catch (e) {
        failedIds.add(id);
        console.error(`Cancel-All: order ${id} failed:`, e);
      }
    }

    // Component may have unmounted while the batch was running. The cancels
    // already completed on-chain (we deliberately did NOT abort them), but
    // there's no UI left to update — skip the state setters and the
    // auto-dismiss timer to avoid an unmount-leak.
    if (!mountedRef.current) return;

    setCancellingAll(false);
    // Restore failed orders to the visible list (clear them from pending);
    // successful ones stay hidden — the WS `order_cancelled` event will
    // permanently remove them from the underlying `orders` list shortly.
    setPendingCancelIds(failedIds);

    if (failedIds.size === 0) {
      setCancelAllStatus({ kind: "success", count: ok });
    } else {
      setCancelAllStatus({ kind: "partial", ok, total: ids.length });
    }
    // Auto-dismiss after 5s so the banner doesn't linger. Track the timer id
    // so the unmount cleanup can clear it (otherwise the callback fires
    // post-unmount and tries to setState on a dead component).
    if (cancelAllTimeoutRef.current !== null) {
      clearTimeout(cancelAllTimeoutRef.current);
    }
    cancelAllTimeoutRef.current = setTimeout(() => {
      cancelAllTimeoutRef.current = null;
      if (mountedRef.current) setCancelAllStatus(null);
    }, 5000);
  }, [account, walletClient, hasSessionKey, marketOrdersAll]);

  // Fetch position from chain
  const fetchPosition = useCallback(async () => {
    if (!account) return;
    try {
      const positions = await api.getPositions(account.address);
      const pos = positions.find((p) => String(p.market_id) === marketId);
      if (pos) {
        setPosition({ yes_quantity: pos.yes_shares, no_quantity: pos.no_shares });
      } else {
        setPosition({ yes_quantity: 0, no_quantity: 0 });
      }
    } catch (e) {
      console.error("Failed to fetch positions:", e);
    }
  }, [account, marketId]);

  useEffect(() => { fetchPosition(); }, [fetchPosition]);

  // Fetch cost basis and user trades from trade history.
  // Both derive from the same `/account/{addr}/trades` response, so we fetch
  // once and populate both to avoid a redundant round-trip.
  useEffect(() => {
    if (!account) {
      setMyTrades([]);
      setCostBasis(null);
      return;
    }
    api.getAccountTrades(account.address).then((accountTrades) => {
      // API returns newest-first; computeCostBasis expects chronological (oldest-first)
      const chronological = [...accountTrades].reverse();
      const allCostBasis = computeCostBasis(chronological, account.address);
      const marketIdNum = Number(marketId);
      setCostBasis(allCostBasis[marketIdNum] ?? null);
      // My Trades tab: filter to this market only, keep newest-first ordering.
      setMyTrades(accountTrades.filter((t) => t.market_id === marketIdNum));
    }).catch(console.error);
  }, [account, marketId]);

  // WebSocket position updates
  useEffect(() => {
    if (!account) return;
    const remove = addListener((msg: WsServerMessage) => {
      if (msg.type === "position_update" && String(msg.market_id) === marketId) {
        setPosition({ yes_quantity: msg.yes_quantity, no_quantity: msg.no_quantity });
        // Refresh cost basis and user trades when position changes (new trade happened)
        api.getAccountTrades(account.address).then((accountTrades) => {
          const chronological = [...accountTrades].reverse();
          const allCostBasis = computeCostBasis(chronological, account.address);
          const marketIdNum = Number(marketId);
          setCostBasis(allCostBasis[marketIdNum] ?? null);
          setMyTrades(accountTrades.filter((t) => t.market_id === marketIdNum));
        }).catch(console.error);
      }
    });
    return remove;
  }, [account, marketId, addListener]);

  // Derive mark price from the live orderbook
  const markPrice = useMemo(() => {
    const bestBid = book.bids.length > 0 ? book.bids[0].price : null;
    const bestAsk = book.asks.length > 0 ? book.asks[0].price : null;
    if (bestBid != null && bestAsk != null) return (bestBid + bestAsk) / 2;
    return bestBid ?? bestAsk ?? null;
  }, [book.bids, book.asks]);

  // Build enriched position rows for this single market
  const positionRows = useMemo(() => {
    if (!position) return [];
    const rows: {
      side: "YES" | "NO";
      qty: number;
      avgEntry: number | null;
      mark: number | null;
      marginUsed: number | null;
      unrealizedPnl: number | null;
      unrealizedPnlPct: number | null;
    }[] = [];

    if (position.yes_quantity > 0) {
      let avgEntry: number | null = null;
      let pnl: number | null = null;
      let pnlPct: number | null = null;
      if (costBasis && costBasis.yesShares > 0) {
        avgEntry = costBasis.yesTotalCost / costBasis.yesShares;
      }
      if (markPrice !== null && avgEntry !== null) {
        pnl = (markPrice - avgEntry) * position.yes_quantity;
        const costBase = avgEntry * position.yes_quantity;
        pnlPct = costBase > 0 ? (pnl / costBase) * 100 : 0;
      }
      // Margin used = cost basis paid for this side (ticks).
      const marginUsed = avgEntry !== null ? avgEntry * position.yes_quantity : null;
      rows.push({ side: "YES", qty: position.yes_quantity, avgEntry, mark: markPrice, marginUsed, unrealizedPnl: pnl, unrealizedPnlPct: pnlPct });
    }

    if (position.no_quantity > 0) {
      let avgEntry: number | null = null;
      let pnl: number | null = null;
      let pnlPct: number | null = null;
      const noMark = markPrice !== null ? 1000 - markPrice : null;
      if (costBasis && costBasis.noShares > 0) {
        avgEntry = costBasis.noTotalCost / costBasis.noShares;
      }
      if (noMark !== null && avgEntry !== null) {
        pnl = (noMark - avgEntry) * position.no_quantity;
        const costBase = avgEntry * position.no_quantity;
        pnlPct = costBase > 0 ? (pnl / costBase) * 100 : 0;
      }
      // Margin used = cost basis paid for this side (ticks).
      // For NO positions, avgEntry is already the NO-book cost basis, so margin = avgEntry * qty.
      const marginUsed = avgEntry !== null ? avgEntry * position.no_quantity : null;
      rows.push({ side: "NO", qty: position.no_quantity, avgEntry, mark: noMark, marginUsed, unrealizedPnl: pnl, unrealizedPnlPct: pnlPct });
    }

    return rows;
  }, [position, costBasis, markPrice]);

  // Close position handler
  // mode="market": IOC at price 1 (YES close) or 999 (NO close) — crosses book aggressively.
  // mode="limit": GTC at user-specified YES-book price (applies to both YES sell and NO buy).
  //   For a NO close, `priceTicks` is the YES-book buy price (paying price_ticks/1000 per share,
  //   recovering (1000 - price_ticks)/1000 as net proceeds on the NO leg via netting).
  const handleClosePosition = useCallback(async (opts: {
    side: "YES" | "NO";
    qty: number;
    mode: "market" | "limit";
    priceTicks?: number;
  }) => {
    const { side, qty, mode, priceTicks } = opts;
    if (!account) return;
    if (!walletClient && !hasSessionKey) return;
    setClosingPosition(side);
    setCloseError(null);

    try {
      // YES position: Sell YES shares (side=Sell)
      // NO position: Buy YES shares, which nets against NO (side=Buy)
      const orderSide: Side = side === "YES" ? "Sell" : "Buy";
      const marketPrice = side === "YES" ? 1 : 999;
      const price = mode === "limit" && priceTicks != null ? priceTicks : marketPrice;

      const result = await api.placeOrder(walletClient ?? null, account.address, {
        market_id: Number(marketId),
        side: orderSide,
        price,
        quantity: qty,
        // Market close is IOC to avoid leaving a toxic resting order.
        // Limit close is GTC so the order can rest and fill at the user's price.
        ...(mode === "market" ? { time_in_force: "IOC" as const } : {}),
      });

      if (result?.tx_hash) {
        await api.waitForTx(result.tx_hash);
      }

      // Refresh position and account balance
      await fetchPosition();
      await refreshAccount();
    } catch (e) {
      console.error("Close position error:", e);
      setCloseError(e instanceof Error ? e.message : "Failed to close position");
      throw e;
    } finally {
      setClosingPosition(null);
    }
  }, [account, walletClient, hasSessionKey, marketId, fetchPosition, refreshAccount]);

  // P&L color helper
  const pnlColor = (val: number | null): string => {
    if (val === null || val === 0) return th.textSecondary;
    return val > 0 ? th.yes : th.no;
  };

  // Derive per-trade action (BUY/SELL + YES/NO) from chronological running
  // position for display in the My Trades tab. Sell-YES with no YES shares
  // opens a NO, and Buy-YES closes NO before opening YES (mirrors the
  // semantics in computeCostBasis / portfolio page trade history).
  const myTradeRows = useMemo(() => {
    if (!account || myTrades.length === 0) return [];
    const chronological = [...myTrades].reverse();
    const pos = { yes: 0, no: 0 };
    const sideByChronoIdx: ("YES" | "NO")[] = [];
    for (let i = 0; i < chronological.length; i++) {
      const t = chronological[i];
      const isBuyer = t.buyer.toLowerCase() === account.address.toLowerCase();
      if (isBuyer) {
        sideByChronoIdx.push(pos.no > 0 ? "NO" : "YES");
        const closeNo = Math.min(pos.no, t.quantity);
        pos.no -= closeNo;
        pos.yes += t.quantity - closeNo;
      } else {
        sideByChronoIdx.push(pos.yes > 0 ? "YES" : "NO");
        const closeYes = Math.min(pos.yes, t.quantity);
        pos.yes -= closeYes;
        pos.no += t.quantity - closeYes;
      }
    }
    // Map newest-first myTrades back to derived sides
    const total = chronological.length;
    return myTrades.map((t, i) => {
      const isBuyer = t.buyer.toLowerCase() === account.address.toLowerCase();
      const chronoIdx = total - 1 - i;
      const outcome = sideByChronoIdx[chronoIdx] ?? "YES";
      const action: "BUY" | "SELL" = isBuyer ? "BUY" : "SELL";
      return {
        key: `${t.block_height}-${t.maker_order_id}-${t.taker_order_id}-${i}`,
        timestamp: t.timestamp,
        price: t.price,
        quantity: t.quantity,
        action,
        outcome,
        taker_tx_hash: t.taker_tx_hash,
      };
    });
  }, [myTrades, account]);

  const hasPosition = position && (position.yes_quantity > 0 || position.no_quantity > 0);
  const posCount = positionRows.length;

  const tabs = [
    { id: "mytrades" as const, label: "My Trades", count: myTradeRows.length },
    { id: "orders" as const, label: "Open Orders", count: marketOrdersAll.length },
    { id: "position" as const, label: "Position", count: posCount > 0 ? posCount : undefined },
  ];

  return (
    <div style={{ ...s.dataTabsContainer, marginBottom: space[10] }}>
      {/* Tab bar */}
      <div style={s.dataTabBar}>
        {tabs.map(tab => {
          return (
            <button
              key={tab.id}
              style={s.dataTab(activeTab === tab.id)}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
              {tab.count != null && tab.count > 0 && (
                <span style={s.dataTabBadge}>{tab.count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content -- the market-wide "Trades" tab has moved to the
          right-rail TradeTape, so only personal/position data lives
          here now. */}
      <div>
        {activeTab === "mytrades" && (
          !account ? (
            <div style={s.dataEmptyState}>Connect wallet to see your trades</div>
          ) : myTradeRows.length === 0 ? (
            <div style={s.dataEmptyState}>No trades yet in this market</div>
          ) : (
            <div>
              <div style={{ ...s.dataColumnHeaders, gridTemplateColumns: '1.3fr 1.2fr 0.8fr 0.7fr 0.9fr 0.6fr' }}>
                <span>Time</span>
                <span>Side</span>
                <span style={{ textAlign: 'right' }}>Price</span>
                <span style={{ textAlign: 'right' }}>Qty</span>
                <span style={{ textAlign: 'right' }}>Total</span>
                <span style={{ textAlign: 'right' }}>Tx</span>
              </div>
              {myTradeRows.slice(0, 30).map((t) => {
                const label = `${t.action} ${t.outcome}`;
                return (
                  <div
                    key={t.key}
                    style={{ ...s.dataRow, gridTemplateColumns: '1.3fr 1.2fr 0.8fr 0.7fr 0.9fr 0.6fr' }}
                    title={formatAbsoluteTime(t.timestamp)}
                  >
                    <span style={s.dataTradesTime}>
                      {formatRelativeTime(t.timestamp)}
                    </span>
                    <span style={s.dataTradesSide(t.action === "BUY" ? "buy" : "sell")}>
                      {label}
                    </span>
                    <span style={s.dataTradesPrice}>{ticksToPrice(t.price)}</span>
                    <span style={s.dataTradesQty}>{t.quantity}</span>
                    <span style={s.dataTradesPrice}>
                      {formatDollars((t.price * t.quantity) / 1000)}
                    </span>
                    <span style={{ textAlign: 'right', fontSize: 10, color: 'var(--text-tertiary)' }}>
                      {t.taker_tx_hash ? (
                        <HashLink hash={t.taker_tx_hash} compact />
                      ) : (
                        <span style={{ opacity: 0.3 }}>—</span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )
        )}

        {activeTab === "orders" && (
          !account ? (
            <div style={s.dataEmptyState}>Connect wallet to view orders</div>
          ) : marketOrdersAll.length === 0 ? (
            <div style={s.dataEmptyState}>No open orders</div>
          ) : (
            <div>
              {/* Status banner: success / partial / error from a Cancel-All
                  batch. Inline (not toast) so we don't pull in a toast lib
                  for one feature; matches the existing closeError pattern. */}
              {cancelAllStatus && (
                <div
                  role="status"
                  style={{
                    padding: `${space[2]}px ${space[3]}px`,
                    fontFamily: fonts.sans,
                    fontSize: 12,
                    color: cancelAllStatus.kind === "success" ? th.yes : cancelAllStatus.kind === "partial" ? (th.isDark ? "#EAB308" : "#B45309") : th.no,
                    borderBottom: `0.8px solid ${th.border}`,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span>
                    {cancelAllStatus.kind === "success"
                      ? `Cancelled ${cancelAllStatus.count} order${cancelAllStatus.count === 1 ? "" : "s"}`
                      : cancelAllStatus.kind === "partial"
                      ? `Cancelled ${cancelAllStatus.ok} of ${cancelAllStatus.total} (${cancelAllStatus.total - cancelAllStatus.ok} failed)`
                      : cancelAllStatus.message}
                  </span>
                  <button
                    onClick={() => setCancelAllStatus(null)}
                    style={{ background: "none", border: "none", color: th.textTertiary, cursor: "pointer", fontSize: 14, padding: "0 4px" }}
                    aria-label="Dismiss"
                  >
                    x
                  </button>
                </div>
              )}

              {/* Confirmation strip: appears in-place rather than a modal so
                  it doesn't trap focus / require an Escape handler. Primary
                  "Cancel All" is destructive-coloured (no = th.no); secondary
                  "Keep" dismisses without action. */}
              {confirmCancelAll && (
                <div
                  role="alertdialog"
                  aria-label={`Confirm cancel of ${marketOrdersAll.length} open orders`}
                  style={{
                    padding: `${space[2]}px ${space[3]}px`,
                    fontFamily: fonts.sans,
                    fontSize: 12,
                    color: th.textPrimary,
                    background: th.isDark ? "rgba(239,68,68,0.06)" : "rgba(220,38,38,0.04)",
                    borderBottom: `0.8px solid ${th.border}`,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: space[2],
                  }}
                >
                  <span>Cancel all {marketOrdersAll.length} open orders?</span>
                  <span style={{ display: "flex", gap: space[2] }}>
                    <button
                      onClick={() => setConfirmCancelAll(false)}
                      style={{
                        background: "transparent",
                        border: `0.8px solid ${th.border}`,
                        color: th.textSecondary,
                        padding: "4px 10px",
                        borderRadius: radii.sm,
                        cursor: "pointer",
                        fontFamily: fonts.sans,
                        fontSize: 12,
                      }}
                    >
                      Keep
                    </button>
                    <button
                      onClick={handleCancelAll}
                      style={{
                        background: th.no,
                        border: "none",
                        color: "#FFFFFF",
                        padding: "4px 10px",
                        borderRadius: radii.sm,
                        cursor: "pointer",
                        fontFamily: fonts.sans,
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      Cancel All
                    </button>
                  </span>
                </div>
              )}

              {/* Header row with Cancel-All button on the right. Only shows
                  when the user has 2+ open orders (per spec). Disabled while
                  a batch is in-flight. */}
              {marketOrdersAll.length >= 2 && !confirmCancelAll && (
                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    alignItems: "center",
                    padding: `${space[2]}px ${space[3]}px ${space[1]}px`,
                  }}
                >
                  <button
                    onClick={() => setConfirmCancelAll(true)}
                    disabled={cancellingAll}
                    title={`Cancel all ${marketOrdersAll.length} open orders in this market`}
                    aria-label={`Cancel all ${marketOrdersAll.length} open orders`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      background: "transparent",
                      border: `0.8px solid ${th.border}`,
                      color: cancellingAll ? th.textTertiary : th.no,
                      padding: "4px 10px",
                      borderRadius: radii.sm,
                      cursor: cancellingAll ? "not-allowed" : "pointer",
                      fontFamily: fonts.sans,
                      fontSize: 11,
                      fontWeight: 500,
                      letterSpacing: "0.04em",
                      opacity: cancellingAll ? 0.6 : 1,
                      transition: motion.hoverTransition,
                    }}
                  >
                    {/* Subtle X icon to signal destructive-batch action. */}
                    <span aria-hidden style={{ fontSize: 13, lineHeight: 1, fontWeight: 600 }}>x</span>
                    <span>{cancellingAll ? "Cancelling..." : "Cancel All"}</span>
                  </button>
                </div>
              )}

              <div style={{ ...s.dataColumnHeaders, gridTemplateColumns: '0.7fr 0.8fr 0.7fr 0.8fr 0.7fr 0.7fr' }}>
                <span>Side</span>
                <span style={{ textAlign: 'right' }}>Price</span>
                <span style={{ textAlign: 'right' }}>Qty</span>
                <span style={{ textAlign: 'right' }}>Filled</span>
                <span>Status</span>
                <span style={{ textAlign: 'center' }}>Action</span>
              </div>
              {marketOrders.length === 0 ? (
                <div style={s.dataEmptyState}>
                  {cancellingAll ? "Cancelling all orders..." : "No open orders"}
                </div>
              ) : (
                marketOrders.map((order) => (
                  <OrderRow key={order.id} order={order} th={th} s={s} />
                ))
              )}
            </div>
          )
        )}

        {activeTab === "position" && (
          !account ? (
            <div style={s.dataEmptyState}>Connect wallet to view position</div>
          ) : !hasPosition ? (
            <div style={s.dataEmptyState}>No position in this market</div>
          ) : (
            <div>
              {closeError && (
                <div style={{
                  padding: `${space[2]}px ${space[3]}px`,
                  fontFamily: fonts.sans,
                  fontSize: 12,
                  color: th.no,
                  borderBottom: `0.8px solid ${th.isDark ? "rgba(239,68,68,0.15)" : "rgba(239,68,68,0.12)"}`,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}>
                  <span>{closeError}</span>
                  <button
                    onClick={() => setCloseError(null)}
                    style={{
                      background: "none",
                      border: "none",
                      color: th.textTertiary,
                      cursor: "pointer",
                      fontSize: 14,
                      padding: "0 4px",
                    }}
                  >
                    x
                  </button>
                </div>
              )}
              <div style={{ ...s.dataColumnHeaders, gridTemplateColumns: '0.6fr 0.5fr 0.7fr 0.7fr 0.7fr 1.1fr 0.7fr' }}>
                <span>Side</span>
                <span style={{ textAlign: 'right' }}>Qty</span>
                <span style={{ textAlign: 'right' }}>Margin</span>
                <span style={{ textAlign: 'right' }}>Avg Entry</span>
                <span style={{ textAlign: 'right' }}>Mark</span>
                <span style={{ textAlign: 'right' }}>Unrealized P&L</span>
                <span style={{ textAlign: 'center' }}>Action</span>
              </div>
              {positionRows.map((row) => {
                const isClosing = closingPosition === row.side;
                return (
                  <div
                    key={row.side}
                    style={{
                      ...s.dataRow,
                      gridTemplateColumns: '0.6fr 0.5fr 0.7fr 0.7fr 0.7fr 1.1fr 0.7fr',
                      opacity: isClosing ? 0.5 : 1,
                      transition: "background 150ms, opacity 150ms",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLDivElement).style.background = th.isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLDivElement).style.background = "transparent";
                    }}
                  >
                    {/* Side badge + conditional void warning. The icon is
                        co-located with the side label (rather than the close
                        button) so users scan it at the same glance as their
                        position direction. */}
                    <span style={{ display: "inline-flex", alignItems: "center" }}>
                      <span style={{
                        display: "inline-block",
                        padding: "1px 6px",
                        borderRadius: 2,
                        fontSize: 10,
                        fontWeight: 600,
                        fontFamily: fonts.sans,
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        background: row.side === "YES"
                          ? (th.isDark ? "rgba(34,197,94,0.12)" : "rgba(34,197,94,0.1)")
                          : (th.isDark ? "rgba(239,68,68,0.12)" : "rgba(239,68,68,0.1)"),
                        color: row.side === "YES" ? th.yes : th.no,
                      }}>
                        {row.side}
                      </span>
                      {market.parent_market_id != null && (
                        <ConditionalWarningIcon
                          parentQuestion={null}
                          parentOutcome={market.parent_outcome}
                          th={th}
                          size={11}
                        />
                      )}
                    </span>
                    {/* Qty */}
                    <span style={s.dataTradesQty}>{row.qty}</span>
                    {/* Margin Used */}
                    <span style={{ ...s.dataTradesPrice, color: th.textSecondary }}>
                      {row.marginUsed != null ? `$${(row.marginUsed / 1000).toFixed(2)}` : "\u2014"}
                    </span>
                    {/* Avg Entry */}
                    <span style={s.dataTradesPrice}>
                      {row.avgEntry != null ? ticksToPrice(row.avgEntry) : "--"}
                    </span>
                    {/* Mark Price */}
                    <span style={s.dataTradesPrice}>
                      {row.mark != null ? ticksToPrice(row.mark) : "--"}
                    </span>
                    {/* Unrealized P&L */}
                    <span style={{ ...s.dataTradesPrice, color: pnlColor(row.unrealizedPnl) }}>
                      {row.unrealizedPnl != null ? formatPnlDollars(row.unrealizedPnl) : "--"}
                      {row.unrealizedPnlPct != null && (
                        <span style={{ fontSize: 10, opacity: 0.6, marginLeft: 4 }}>
                          ({formatPnlPercent(row.unrealizedPnlPct)})
                        </span>
                      )}
                    </span>
                    {/* Close button */}
                    <span style={{ textAlign: "center" }}>
                      <button
                        onClick={() => setCloseModalPos({ side: row.side, qty: row.qty })}
                        disabled={isClosing}
                        aria-label={`Close ${row.side} position`}
                        style={s.dataOrderCancel}
                        onMouseEnter={(e) => {
                          if (!isClosing) {
                            (e.currentTarget as HTMLButtonElement).style.background = th.isDark ? "rgba(239,68,68,0.12)" : "rgba(239,68,68,0.08)";
                            (e.currentTarget as HTMLButtonElement).style.opacity = "1";
                          }
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                          (e.currentTarget as HTMLButtonElement).style.opacity = isClosing ? "0.4" : "0.7";
                        }}
                      >
                        {isClosing ? "..." : "Close"}
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>

      {/* Close position modal */}
      {closeModalPos && (
        <ClosePositionModal
          side={closeModalPos.side}
          maxQty={closeModalPos.qty}
          bestBid={book.bids.length > 0 ? book.bids[0].price : null}
          bestAsk={book.asks.length > 0 ? book.asks[0].price : null}
          isSubmitting={closingPosition === closeModalPos.side}
          th={th}
          onClose={() => setCloseModalPos(null)}
          onSubmit={async (opts) => {
            await handleClosePosition({
              side: closeModalPos.side,
              qty: opts.qty,
              mode: opts.mode,
              priceTicks: opts.priceTicks,
            });
            setCloseModalPos(null);
          }}
        />
      )}
    </div>
  );
}

// =============================================================================
// ClosePositionModal
// =============================================================================

function ClosePositionModal({
  side,
  maxQty,
  bestBid,
  bestAsk,
  isSubmitting,
  th,
  onClose,
  onSubmit,
}: {
  side: "YES" | "NO";
  maxQty: number;
  bestBid: number | null;
  bestAsk: number | null;
  isSubmitting: boolean;
  th: OracleTheme;
  onClose: () => void;
  onSubmit: (opts: { qty: number; mode: "market" | "limit"; priceTicks?: number }) => Promise<void>;
}) {
  // YES close = Sell YES (hits best bid); NO close = Buy YES (hits best ask).
  const marketRefPrice = side === "YES" ? bestBid : bestAsk;

  const [mode, setMode] = useState<"market" | "limit">("market");
  const [sliderPct, setSliderPct] = useState(100);
  // Price shown to the user is always YES-book price in cents (0.1 - 99.9).
  const [priceInput, setPriceInput] = useState<string>(
    marketRefPrice != null ? (marketRefPrice / 10).toFixed(1) : "",
  );
  const [localError, setLocalError] = useState<string | null>(null);

  // Derived quantity from slider (min 1 share).
  const qty = Math.max(1, Math.min(maxQty, Math.floor((maxQty * sliderPct) / 100)));

  // Parse limit price (cents) -> ticks (1000 ticks/$1 = 10 ticks/¢).
  const parsedPriceCents = (() => {
    const v = parseFloat(priceInput);
    return Number.isFinite(v) ? v : null;
  })();
  const limitTicks = parsedPriceCents != null ? Math.round(parsedPriceCents * 10) : null;
  const limitValid = limitTicks != null && limitTicks >= 1 && limitTicks <= 999;

  // Effective fill price in ticks used for proceeds estimate.
  // Market mode uses best bid (YES close) or best ask (NO close).
  // Limit mode uses the user's limit price.
  const effectiveTicks = mode === "market" ? marketRefPrice : (limitValid ? limitTicks! : null);

  // Net $ proceeds.
  // YES close: sell YES at price -> receive (price_ticks / 1000) per share.
  // NO close: buy YES at price -> net recovery on NO position is (1000 - price_ticks)/1000 per share.
  const proceedsDollars = (() => {
    if (effectiveTicks == null) return null;
    const perShareTicks = side === "YES" ? effectiveTicks : (1000 - effectiveTicks);
    return (qty * perShareTicks) / 1000;
  })();

  // "Worse than market" warning for limit mode.
  const worseThanMarket = (() => {
    if (mode !== "limit" || limitTicks == null || marketRefPrice == null) return false;
    if (side === "YES") {
      // Selling YES: your limit is worse if BELOW the best bid (less received).
      return limitTicks < marketRefPrice;
    } else {
      // Buying YES to close NO: your limit is worse if ABOVE the best ask (pay more).
      return limitTicks > marketRefPrice;
    }
  })();

  const handleSubmit = async () => {
    setLocalError(null);
    if (mode === "limit" && !limitValid) {
      setLocalError("Enter a price between 0.1¢ and 99.9¢");
      return;
    }
    if (qty < 1) {
      setLocalError("Quantity must be at least 1");
      return;
    }
    try {
      await onSubmit({
        qty,
        mode,
        priceTicks: mode === "limit" ? limitTicks! : undefined,
      });
    } catch {
      // Parent sets closeError banner; modal stays open for retry.
    }
  };

  const tabBtn = (active: boolean): React.CSSProperties => ({
    background: active ? (th.isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)") : "transparent",
    border: `0.8px solid ${active ? th.textPrimary : th.border}`,
    borderRadius: radii.sm,
    padding: "10px 0",
    cursor: "pointer",
    textAlign: "center" as const,
    fontFamily: fonts.sans,
    fontSize: 13,
    fontWeight: 600,
    color: active ? th.textPrimary : th.textSecondary,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    transition: "all 150ms ease",
  });

  const chipBtn: React.CSSProperties = {
    ...type.metaLabel,
    fontFamily: fonts.mono,
    color: th.textSecondary,
    background: "transparent",
    border: `0.8px solid ${th.border}`,
    borderRadius: radii.sm,
    padding: "4px 10px",
    cursor: "pointer",
    transition: motion.hoverTransition,
  };

  const sideLabel = side === "YES" ? "YES" : "NO";
  const sideColor = side === "YES" ? th.yes : th.no;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0, 0, 0, 0.6)",
        backdropFilter: "blur(4px)",
        padding: space[4],
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: 440,
          maxWidth: "100%",
          maxHeight: "90vh",
          overflowY: "auto",
          background: th.elevated,
          border: `0.8px solid ${th.border}`,
          borderRadius: radii.lg,
          padding: space[8],
          position: "relative",
        }}
      >
        {/* Close (x) button */}
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            position: "absolute",
            top: space[4],
            right: space[4],
            background: "transparent",
            border: "none",
            color: th.textSecondary,
            cursor: "pointer",
            fontSize: 18,
            lineHeight: 1,
            padding: 4,
          }}
        >
          x
        </button>

        {/* Title */}
        <h2 style={{
          fontFamily: fonts.serif,
          fontSize: 20,
          fontWeight: 400,
          color: th.textPrimary,
          margin: 0,
          marginBottom: space[2],
          letterSpacing: "-0.02em",
        }}>
          Close <span style={{ color: sideColor }}>{sideLabel}</span> position
        </h2>
        <div style={{
          fontFamily: fonts.sans,
          fontSize: 12,
          color: th.textTertiary,
          marginBottom: space[6],
        }}>
          Position size: {maxQty} shares
        </div>

        {/* Mode toggle */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: space[2], marginBottom: space[6] }}>
          <button style={tabBtn(mode === "market")} onClick={() => setMode("market")}>
            Market
          </button>
          <button style={tabBtn(mode === "limit")} onClick={() => setMode("limit")}>
            Limit
          </button>
        </div>

        {/* Limit price input */}
        {mode === "limit" && (
          <div style={{ marginBottom: space[6] }}>
            <label style={{
              ...type.metaLabel,
              color: th.textTertiary,
              marginBottom: 8,
              display: "block",
            }}>
              Price (¢)
            </label>
            <div style={{ position: "relative" }}>
              <input
                type="text"
                inputMode="decimal"
                value={priceInput}
                onChange={(e) => {
                  const v = e.target.value;
                  if (/^\d*\.?\d*$/.test(v)) setPriceInput(v);
                }}
                placeholder="0.0"
                style={{
                  ...type.monoInput,
                  width: "100%",
                  background: th.inputBg,
                  border: "none",
                  borderBottom: `0.8px solid ${th.inputBorder}`,
                  borderRadius: 0,
                  padding: "10px 24px 10px 0",
                  outline: "none",
                  color: th.textPrimary,
                  textAlign: "right" as const,
                }}
              />
              <span style={{
                position: "absolute",
                right: 0,
                top: "50%",
                transform: "translateY(-50%)",
                color: th.textTertiary,
                fontFamily: fonts.mono,
                fontSize: 14,
                pointerEvents: "none",
              }}>
                ¢
              </span>
            </div>
            {limitTicks != null && !limitValid && (
              <div style={{
                fontFamily: fonts.sans,
                fontSize: 11,
                color: th.no,
                marginTop: 6,
              }}>
                Price must be between 0.1¢ and 99.9¢
              </div>
            )}
            {worseThanMarket && marketRefPrice != null && (
              <div style={{
                fontFamily: fonts.sans,
                fontSize: 11,
                color: th.textTertiary,
                marginTop: 6,
              }}>
                {side === "YES"
                  ? `Best bid is ${(marketRefPrice / 10).toFixed(1)}¢`
                  : `Best ask is ${(marketRefPrice / 10).toFixed(1)}¢`}
                {" — your limit may not fill immediately."}
              </div>
            )}
          </div>
        )}

        {/* Quantity slider */}
        <div style={{ marginBottom: space[6] }}>
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: space[2],
          }}>
            <label style={{ ...type.metaLabel, color: th.textTertiary }}>
              Quantity
            </label>
            <div style={{ display: "flex", gap: 6 }}>
              {[25, 50, 75, 100].map((p) => (
                <button
                  key={p}
                  onClick={() => setSliderPct(p)}
                  style={{
                    ...chipBtn,
                    borderColor: sliderPct === p ? th.textPrimary : th.border,
                    color: sliderPct === p ? th.textPrimary : th.textSecondary,
                    padding: "2px 8px",
                    fontSize: 10,
                  }}
                >
                  {p}%
                </button>
              ))}
            </div>
          </div>
          <input
            type="range"
            min={1}
            max={100}
            value={sliderPct}
            onChange={(e) => setSliderPct(Number(e.target.value))}
            style={{
              width: "100%",
              accentColor: sideColor,
              cursor: "pointer",
            }}
          />
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: space[2],
            fontFamily: fonts.sans,
            fontSize: 12,
          }}>
            <span style={{ color: th.textSecondary }}>
              Closing: <span style={{ fontFamily: fonts.mono, color: th.textPrimary }}>{qty}</span> of {maxQty} shares
            </span>
            <span style={{ fontFamily: fonts.mono, color: th.textTertiary, fontSize: 11 }}>
              {sliderPct}%
            </span>
          </div>
        </div>

        {/* Proceeds summary */}
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          paddingTop: space[3],
          paddingBottom: space[5],
          borderTop: `0.8px solid ${th.divider}`,
        }}>
          <span style={{ ...type.metaLabel, color: th.textTertiary }}>
            Est. proceeds
          </span>
          <span style={{
            ...type.monoPrice,
            fontWeight: 600,
            color: th.textPrimary,
          }}>
            {proceedsDollars != null ? formatDollars(proceedsDollars) : "--"}
          </span>
        </div>

        {/* Local error */}
        {localError && (
          <div style={{
            fontFamily: fonts.sans,
            fontSize: 12,
            color: th.no,
            marginBottom: space[3],
          }}>
            {localError}
          </div>
        )}

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={isSubmitting || (mode === "limit" && !limitValid)}
          style={{
            ...type.buttonText,
            width: "100%",
            padding: 14,
            background: sideColor,
            color: side === "YES" ? "#000000" : "#FFFFFF",
            border: "none",
            borderRadius: radii.sm,
            cursor: isSubmitting ? "not-allowed" : "pointer",
            opacity: isSubmitting || (mode === "limit" && !limitValid) ? 0.5 : 1,
            transition: motion.buttonTransition,
          }}
        >
          {isSubmitting ? "Submitting..." : mode === "market" ? "Close at market" : "Place limit close"}
        </button>
      </div>
    </div>
  );
}

function OrderRow({
  order,
  th,
  s,
}: {
  order: ReturnType<typeof useOrders>[number];
  th: OracleTheme;
  s: ReturnType<typeof getTradeStyles>;
}) {
  const { account, walletClient } = useAccount();
  const { isActive: hasSessionKey } = useSessionKey();
  const [cancelling, setCancelling] = useState(false);

  const handleCancel = async () => {
    if (!account) return;
    if (!walletClient && !hasSessionKey) return;
    setCancelling(true);
    try {
      await api.cancelOrder(walletClient, account.address, parseInt(order.id));
    } catch (e) {
      console.error("Cancel failed:", e);
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div style={{ ...s.dataRow, gridTemplateColumns: '0.7fr 0.8fr 0.7fr 0.8fr 0.7fr 0.7fr' }}>
      <span style={s.dataTradesSide(order.side === "Buy" ? "buy" : "sell")}>
        {order.side === "Buy" ? "BUY" : "SELL"}
      </span>
      <span style={s.dataTradesPrice}>{ticksToPrice(order.price)}</span>
      <span style={s.dataTradesQty}>{order.quantity}</span>
      <span style={s.dataTradesQty}>{order.quantity - order.remaining}/{order.quantity}</span>
      <span style={{ ...type.metaLabel, color: th.textSecondary }}>
        {order.remaining === order.quantity ? "Open" : "Partial"}
      </span>
      <button
        style={{ ...s.dataOrderCancel, textAlign: 'center' as const }}
        onClick={handleCancel}
        disabled={cancelling}
      >
        {cancelling ? "..." : "Cancel"}
      </button>
    </div>
  );
}

// =============================================================================
// ResolutionCriteria
// =============================================================================

function ResolutionCriteria({ th }: { th: OracleTheme }) {
  return (
    <div style={{ marginTop: space[10] }}>
      <h3 style={{
        ...type.sectionTitle,
        fontSize: 20,
        color: th.textPrimary,
        marginBottom: space[4],
      }}>
        Resolution Criteria
      </h3>
      <p style={{
        fontFamily: fonts.sans,
        fontSize: 15,
        lineHeight: 1.7,
        color: th.textSecondary,
        maxWidth: 680,
        margin: 0,
      }}>
        This market resolves &ldquo;Yes&rdquo; if the event described in the question occurs before the
        market close date. Resolution is determined based on publicly verifiable
        information. If the outcome cannot be determined, the market may resolve as &ldquo;Unknown&rdquo;
        and all positions will be refunded at their entry cost.
      </p>
    </div>
  );
}

// =============================================================================
// ResolveButton (admin-only)
// =============================================================================

function ResolveButton({
  marketId,
  onResolved,
  th,
}: {
  marketId: number;
  onResolved: () => void;
  th: OracleTheme;
}) {
  const { account, walletClient } = useAccount();
  const [show, setShow] = useState(false);
  const [resolving, setResolving] = useState(false);

  const handleResolve = async (outcome: "Yes" | "No" | "Unknown") => {
    if (!account || !walletClient) return;
    setResolving(true);
    try {
      await api.resolveMarket(walletClient, account.address, marketId, outcome);
      await new Promise((r) => setTimeout(r, 500));
      onResolved();
      setShow(false);
    } catch (e) {
      console.error("Resolve failed:", e);
    } finally {
      setResolving(false);
    }
  };

  if (!show) {
    return (
      <button
        onClick={() => setShow(true)}
        style={{
          ...type.metaLabel,
          padding: "2px 8px",
          borderRadius: 2,
          background: "transparent",
          color: th.textSecondary,
          border: `0.8px solid ${th.border}`,
          cursor: "pointer",
        }}
      >
        Resolve
      </button>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ ...type.metaLabel, color: th.textSecondary }}>Resolve:</span>
      <button
        onClick={() => handleResolve("Yes")}
        disabled={resolving}
        style={{ ...type.metaLabel, padding: "2px 8px", borderRadius: 2, background: th.yesDim, color: th.yes, border: "none", cursor: "pointer" }}
      >
        YES
      </button>
      <button
        onClick={() => handleResolve("No")}
        disabled={resolving}
        style={{ ...type.metaLabel, padding: "2px 8px", borderRadius: 2, background: th.noDim, color: th.no, border: "none", cursor: "pointer" }}
      >
        NO
      </button>
      <button
        onClick={() => setShow(false)}
        style={{ ...type.metaLabel, color: th.textSecondary, background: "none", border: "none", cursor: "pointer" }}
      >
        Cancel
      </button>
    </div>
  );
}
