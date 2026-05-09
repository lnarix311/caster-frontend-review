/**
 * Portfolio calculation utilities.
 *
 * All values are in ticks (1000 ticks = $1.00).
 * Prices range 1-999 where price represents YES probability.
 * NO value = 1000 - YES price.
 *
 * Uses VWAC (Volume-Weighted Average Cost) for cost basis.
 */

import type { AccountTradeRecord, ChainPosition, MarketPriceInfo, EnrichedOrder } from "./types";

// ---- Cost Basis State per (market, side) ----

export interface CostBasisState {
  yesShares: number;
  /** Ticks spent acquiring current YES inventory, fees included.
   *
   * UNIT INVARIANT: accumulated as `price * qty` on each opening YES fill,
   * where `price` is the YES-price in ticks (1-999). This matches the
   * collateral the chain locks when a trader goes long YES at that price
   * (see `crates/predx-chain/src/state.rs`, open-position branch).
   * Every downstream P&L calc -- unrealized on Open, realized on
   * Resolved(Yes|No|Unknown) -- assumes this unit. Do NOT change to
   * `(1000 - price) * qty` without also flipping the portfolio page's
   * settled-row payout math, which would be a money-display regression. */
  yesTotalCost: number;
  noShares: number;
  /** Ticks spent acquiring current NO inventory, fees included.
   *
   * UNIT INVARIANT: accumulated as `(1000 - price) * qty` on each opening
   * NO fill. Opening a NO position locks `(1000 - price)` ticks of
   * collateral per share on-chain, so cost basis per share = `1000 - price`.
   * See warning on `yesTotalCost` above -- the two fields are symmetric and
   * both must stay in "ticks of collateral paid". */
  noTotalCost: number;
  realizedPnl: number;
}

export interface MarketCostBasis {
  [marketId: number]: CostBasisState;
}

/**
 * Compute VWAC cost basis and realized P&L from trade history.
 *
 * IMPORTANT: The API returns trades newest-first. This function expects
 * trades in chronological order (oldest-first), so callers must reverse
 * the array before passing it in.
 */
export function computeCostBasis(
  trades: AccountTradeRecord[],
  userAddress: string,
): MarketCostBasis {
  const state: MarketCostBasis = {};

  for (const trade of trades) {
    if (!state[trade.market_id]) {
      state[trade.market_id] = {
        yesShares: 0,
        yesTotalCost: 0,
        noShares: 0,
        noTotalCost: 0,
        realizedPnl: 0,
      };
    }

    const mkt = state[trade.market_id];
    const isBuyer = trade.buyer.toLowerCase() === userAddress.toLowerCase();
    const isTaker = isBuyer
      ? trade.taker_side === "Buy"
      : trade.taker_side === "Sell";

    // Fee: taker pays taker_fee, maker receives maker_rebate
    const fee = isTaker ? trade.taker_fee : -trade.maker_rebate;

    if (isBuyer) {
      // Buying: could be opening YES or closing NO
      const closeQty = Math.min(trade.quantity, mkt.noShares);
      const openQty = trade.quantity - closeQty;

      // Close NO portion
      if (closeQty > 0 && mkt.noShares > 0) {
        const costOfClosed = Math.floor(mkt.noTotalCost * closeQty / mkt.noShares);
        const proceeds = (1000 - trade.price) * closeQty;
        const feeOnClose = closeQty === trade.quantity
          ? fee
          : Math.floor((fee * closeQty) / trade.quantity);
        mkt.realizedPnl += proceeds - costOfClosed - feeOnClose;
        mkt.noShares -= closeQty;
        mkt.noTotalCost -= costOfClosed;
        if (mkt.noShares === 0) mkt.noTotalCost = 0;
      }

      // Open YES portion
      if (openQty > 0) {
        const cost = trade.price * openQty;
        const feeOnOpen = closeQty > 0
          ? fee - Math.floor((fee * closeQty) / trade.quantity)
          : fee;
        mkt.yesShares += openQty;
        mkt.yesTotalCost += cost + feeOnOpen;
      }
    } else {
      // Selling: could be closing YES or opening NO
      const closeQty = Math.min(trade.quantity, mkt.yesShares);
      const openQty = trade.quantity - closeQty;

      // Close YES portion
      if (closeQty > 0 && mkt.yesShares > 0) {
        const costOfClosed = Math.floor(mkt.yesTotalCost * closeQty / mkt.yesShares);
        const proceeds = trade.price * closeQty;
        const feeOnClose = closeQty === trade.quantity
          ? fee
          : Math.floor((fee * closeQty) / trade.quantity);
        mkt.realizedPnl += proceeds - costOfClosed - feeOnClose;
        mkt.yesShares -= closeQty;
        mkt.yesTotalCost -= costOfClosed;
        if (mkt.yesShares === 0) mkt.yesTotalCost = 0;
      }

      // Open NO portion
      if (openQty > 0) {
        const cost = (1000 - trade.price) * openQty;
        const feeOnOpen = closeQty > 0
          ? fee - Math.floor((fee * closeQty) / trade.quantity)
          : fee;
        mkt.noShares += openQty;
        mkt.noTotalCost += cost + feeOnOpen;
      }
    }
  }

  return state;
}

// ---- Portfolio Metrics ----

export interface PortfolioMetrics {
  balance: number; // account.balance in ticks
  lockedCollateral: number; // sum of locked in open orders
  positionsValue: number; // mark-to-market value of all positions
  portfolioValue: number; // balance + lockedCollateral + positionsValue
  unrealizedPnl: number;
  realizedPnl: number;
  totalCostBasis: number;
  numTrades: number;
  largestWin: number; // max realized P&L across markets (0 if none positive)
}

export function computePortfolioMetrics(
  balance: number,
  positions: ChainPosition[],
  priceMap: Map<number, MarketPriceInfo>,
  costBasis: MarketCostBasis,
  orders: EnrichedOrder[],
  numTrades: number,
): PortfolioMetrics {
  let positionsValue = 0;
  let unrealizedPnl = 0;
  let totalCostBasis = 0;
  let realizedPnl = 0;
  let largestWin = 0;

  // Sum locked collateral from open orders
  const lockedCollateral = orders.reduce((sum, o) => sum + (o.locked_collateral ?? 0), 0);

  for (const pos of positions) {
    const price = priceMap.get(pos.market_id);
    if (!price) continue;

    const mid = price.mid;
    const yesValue = pos.yes_shares * mid;
    const noValue = pos.no_shares * (1000 - mid);
    positionsValue += yesValue + noValue;

    const cb = costBasis[pos.market_id];
    if (cb) {
      const yesUnrealized = pos.yes_shares > 0 ? yesValue - cb.yesTotalCost : 0;
      const noUnrealized = pos.no_shares > 0 ? noValue - cb.noTotalCost : 0;
      unrealizedPnl += yesUnrealized + noUnrealized;
      totalCostBasis += cb.yesTotalCost + cb.noTotalCost;
    }
  }

  // Sum realized P&L across all markets
  for (const marketId of Object.keys(costBasis)) {
    const cb = costBasis[Number(marketId)];
    realizedPnl += cb.realizedPnl;
    if (cb.realizedPnl > largestWin) {
      largestWin = cb.realizedPnl;
    }
  }

  const portfolioValue = balance + lockedCollateral + positionsValue;

  return {
    balance,
    lockedCollateral,
    positionsValue,
    portfolioValue,
    unrealizedPnl,
    realizedPnl,
    totalCostBasis,
    numTrades,
    largestWin,
  };
}

// ---- Position Row Data ----

export interface PositionRow {
  marketId: number;
  marketQuestion: string;
  side: "YES" | "NO";
  qty: number;
  avgEntry: number | null; // ticks, null if no cost basis
  currentPrice: number | null; // ticks, null if no market data
  marginUsed: number | null; // ticks: avgEntry * qty for YES, (1000 - avgEntry) * qty for NO
  currentValue: number | null; // ticks: currentPrice * qty
  unrealizedPnl: number | null; // ticks
  unrealizedPnlPct: number | null; // percentage
  /** Parent market id when this row's market is a conditional child.
   * Drives the row-level void-warning icon in the portfolio + per-market
   * positions tables. `null` for unconditional markets. */
  parentMarketId: number | null;
  /** Parent outcome that activates the child ("Yes" / "No"); `null` when
   * `parentMarketId` is null. */
  parentOutcome: string | null;
  /** Resolved parent question, used for tooltip text. May be `null` if the
   * caller doesn't have parent metadata loaded yet -- the warning icon
   * falls back to a generic phrasing in that case. */
  parentQuestion: string | null;
}

/** Lightweight slice of `Market` for conditional metadata lookup. Callers
 * can pass either the full `Market` or this subset via `Map<id, ...>`. */
export interface MarketConditionalInfo {
  question: string;
  parent_market_id: number | null;
  parent_outcome: string | null;
}

export function buildPositionRows(
  positions: ChainPosition[],
  priceMap: Map<number, MarketPriceInfo>,
  costBasis: MarketCostBasis,
  /** Either a name-only map (legacy) or a richer map keyed by conditional info.
   * The richer form is preferred so the void-warning icon can render. */
  marketInfo: Map<number, string> | Map<number, MarketConditionalInfo>,
): PositionRow[] {
  const rows: PositionRow[] = [];

  // Resolve a single lookup helper that handles both the legacy name-only
  // map shape and the new MarketConditionalInfo shape. We can't switch on
  // map type at runtime, so we probe the first value once.
  const probe = marketInfo.values().next().value;
  const isRichMap =
    probe != null && typeof probe === "object" && "question" in probe;
  const lookup = (id: number): MarketConditionalInfo => {
    const v = (marketInfo as Map<number, unknown>).get(id);
    if (v == null) {
      return { question: `Market #${id}`, parent_market_id: null, parent_outcome: null };
    }
    if (isRichMap) {
      return v as MarketConditionalInfo;
    }
    return { question: v as string, parent_market_id: null, parent_outcome: null };
  };

  for (const pos of positions) {
    const price = priceMap.get(pos.market_id);
    const cb = costBasis[pos.market_id];
    const info = lookup(pos.market_id);
    const question = info.question;

    if (pos.yes_shares > 0) {
      const mid = price?.mid ?? null;
      let avgEntry: number | null = null;
      let pnl: number | null = null;
      let pnlPct: number | null = null;

      if (cb && cb.yesShares > 0) {
        avgEntry = cb.yesTotalCost / cb.yesShares;
      }

      if (mid !== null && avgEntry !== null) {
        pnl = (mid - avgEntry) * pos.yes_shares;
        const costBase = avgEntry * pos.yes_shares;
        pnlPct = costBase > 0 ? (pnl / costBase) * 100 : 0;
      }

      // Margin used = cost basis (what was paid to acquire)
      const marginUsed = avgEntry !== null ? avgEntry * pos.yes_shares : null;
      // Current value = mark price * qty
      const currentValue = mid !== null ? mid * pos.yes_shares : null;

      rows.push({
        marketId: pos.market_id,
        marketQuestion: question,
        side: "YES",
        qty: pos.yes_shares,
        avgEntry,
        currentPrice: mid,
        marginUsed,
        currentValue,
        unrealizedPnl: pnl,
        unrealizedPnlPct: pnlPct,
        parentMarketId: info.parent_market_id,
        parentOutcome: info.parent_outcome,
        parentQuestion: null,
      });
    }

    if (pos.no_shares > 0) {
      const mid = price?.mid ?? null;
      const noPrice = mid !== null ? 1000 - mid : null;
      let avgEntry: number | null = null;
      let pnl: number | null = null;
      let pnlPct: number | null = null;

      if (cb && cb.noShares > 0) {
        avgEntry = cb.noTotalCost / cb.noShares;
      }

      if (noPrice !== null && avgEntry !== null) {
        pnl = (noPrice - avgEntry) * pos.no_shares;
        const costBase = avgEntry * pos.no_shares;
        pnlPct = costBase > 0 ? (pnl / costBase) * 100 : 0;
      }

      // Margin used = cost basis (what was paid to acquire)
      const marginUsed = avgEntry !== null ? avgEntry * pos.no_shares : null;
      // Current value = mark price * qty
      const currentValue = noPrice !== null ? noPrice * pos.no_shares : null;

      rows.push({
        marketId: pos.market_id,
        marketQuestion: question,
        side: "NO",
        qty: pos.no_shares,
        avgEntry,
        currentPrice: noPrice,
        marginUsed,
        currentValue,
        unrealizedPnl: pnl,
        unrealizedPnlPct: pnlPct,
        parentMarketId: info.parent_market_id,
        parentOutcome: info.parent_outcome,
        parentQuestion: null,
      });
    }
  }

  // Once all rows are produced, backfill `parentQuestion` from the same
  // `marketInfo` map (only possible when caller passed the rich shape).
  // We do this after the loop to keep the per-row construction tight, and
  // because the parent's question lives at a different key than the child's.
  if (isRichMap) {
    for (const r of rows) {
      if (r.parentMarketId != null) {
        const parent = (marketInfo as Map<number, MarketConditionalInfo>).get(r.parentMarketId);
        if (parent) r.parentQuestion = parent.question;
      }
    }
  }

  return rows;
}

// ---- Per-Trade Realized P&L ----

/**
 * Compute per-trade realized P&L for display in the Trade History table.
 *
 * Returns a Map from trade index (in chronological order) to realized P&L
 * for that specific trade. Only trades that close a position have non-zero
 * realized P&L. Opening trades have null.
 *
 * IMPORTANT: trades must be in chronological order (oldest-first).
 */
export function computePerTradeRealizedPnl(
  trades: AccountTradeRecord[],
  userAddress: string,
): Map<number, number> {
  const result = new Map<number, number>();
  const state: Record<number, {
    yesShares: number;
    yesTotalCost: number;
    noShares: number;
    noTotalCost: number;
  }> = {};

  for (let idx = 0; idx < trades.length; idx++) {
    const trade = trades[idx];
    if (!state[trade.market_id]) {
      state[trade.market_id] = {
        yesShares: 0,
        yesTotalCost: 0,
        noShares: 0,
        noTotalCost: 0,
      };
    }

    const mkt = state[trade.market_id];
    const isBuyer = trade.buyer.toLowerCase() === userAddress.toLowerCase();
    const isTaker = isBuyer
      ? trade.taker_side === "Buy"
      : trade.taker_side === "Sell";
    const fee = isTaker ? trade.taker_fee : -trade.maker_rebate;
    let tradePnl = 0;
    let hasRealized = false;

    if (isBuyer) {
      const closeQty = Math.min(trade.quantity, mkt.noShares);
      const openQty = trade.quantity - closeQty;

      if (closeQty > 0 && mkt.noShares > 0) {
        const costOfClosed = Math.floor(mkt.noTotalCost * closeQty / mkt.noShares);
        const proceeds = (1000 - trade.price) * closeQty;
        const feeOnClose = closeQty === trade.quantity
          ? fee
          : Math.floor((fee * closeQty) / trade.quantity);
        tradePnl += proceeds - costOfClosed - feeOnClose;
        mkt.noShares -= closeQty;
        mkt.noTotalCost -= costOfClosed;
        if (mkt.noShares === 0) mkt.noTotalCost = 0;
        hasRealized = true;
      }

      if (openQty > 0) {
        const cost = trade.price * openQty;
        const feeOnOpen = closeQty > 0
          ? fee - Math.floor((fee * closeQty) / trade.quantity)
          : fee;
        mkt.yesShares += openQty;
        mkt.yesTotalCost += cost + feeOnOpen;
      }
    } else {
      const closeQty = Math.min(trade.quantity, mkt.yesShares);
      const openQty = trade.quantity - closeQty;

      if (closeQty > 0 && mkt.yesShares > 0) {
        const costOfClosed = Math.floor(mkt.yesTotalCost * closeQty / mkt.yesShares);
        const proceeds = trade.price * closeQty;
        const feeOnClose = closeQty === trade.quantity
          ? fee
          : Math.floor((fee * closeQty) / trade.quantity);
        tradePnl += proceeds - costOfClosed - feeOnClose;
        mkt.yesShares -= closeQty;
        mkt.yesTotalCost -= costOfClosed;
        if (mkt.yesShares === 0) mkt.yesTotalCost = 0;
        hasRealized = true;
      }

      if (openQty > 0) {
        const cost = (1000 - trade.price) * openQty;
        const feeOnOpen = closeQty > 0
          ? fee - Math.floor((fee * closeQty) / trade.quantity)
          : fee;
        mkt.noShares += openQty;
        mkt.noTotalCost += cost + feeOnOpen;
      }
    }

    if (hasRealized) {
      result.set(idx, tradePnl);
    }
  }

  return result;
}

// ---- Formatting Utilities ----

/** Convert ticks to dollar string: 1000 ticks = $1.00 */
export function ticksToDollars(ticks: number): string {
  const dollars = ticks / 1000;
  return dollars.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Format ticks as a price in cents: 650 ticks = "65.0c" */
export function ticksToCents(ticks: number): string {
  return `${(ticks / 10).toFixed(1)}c`;
}

/** Format ticks as probability: 650 ticks = "0.650" */
export function ticksToProb(ticks: number): string {
  return (ticks / 1000).toFixed(3);
}

/** Format signed dollar P&L: +$12.50 or -$3.20 */
export function formatPnlDollars(ticks: number): string {
  const dollars = ticks / 1000;
  const sign = dollars >= 0 ? "+" : "";
  return `${sign}$${Math.abs(dollars).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Format P&L percentage: +12.5% or -3.2% */
export function formatPnlPercent(pct: number): string {
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

/** Format relative time: "2m ago", "1h ago", "Mar 30, 14:23" */
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;

  const date = new Date(timestamp);
  const month = date.toLocaleString("en-US", { month: "short" });
  const day = date.getDate();
  const hours = date.getHours().toString().padStart(2, "0");
  const mins = date.getMinutes().toString().padStart(2, "0");
  return `${month} ${day}, ${hours}:${mins}`;
}

/** Format absolute time for title tooltips */
export function formatAbsoluteTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}
