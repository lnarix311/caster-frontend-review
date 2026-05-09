"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "@/providers/AccountProvider";
import { useTheme } from "@/providers/ThemeProvider";
import { useWs } from "@/providers/WebSocketProvider";
import * as api from "@/lib/api";
import type {
  Market,
  AccountTradeRecord,
  MarketPriceInfo,
  EnrichedOrder,
  ChainPosition,
  WsServerMessage,
} from "@/lib/types";
import {
  computeCostBasis,
  computePortfolioMetrics,
  buildPositionRows,
  formatRelativeTime,
  formatAbsoluteTime,
  type PortfolioMetrics,
  type PositionRow,
  type MarketCostBasis,
  type MarketConditionalInfo,
} from "@/lib/portfolio";
import { ConditionalWarningIcon } from "@/components/ConditionalWarningIcon";
import {
  fonts,
  space,
  lightTheme,
  darkTheme,
  type as typePresets,
  motion,
} from "@/lib/oracle-theme";
import EquityChart from "@/components/portfolio/EquityChart";
import AllTimeStatsCard from "@/components/portfolio/AllTimeStatsCard";
import LifetimeFillsTable from "@/components/portfolio/LifetimeFillsTable";
import LifetimeEquityCurve from "@/components/portfolio/LifetimeEquityCurve";
import { useLifetimeStats } from "@/hooks/useLifetimeStats";
import { useLifetimeFills } from "@/hooks/useLifetimeFills";

// ---- Constants ----

const FULL_POLL_INTERVAL = 10_000;  // Full data refresh every 10s
const PRICE_POLL_INTERVAL = 3_000;  // Price-only refresh every 3s (drives P&L)
const BRIDGE_PER_PAGE = 10;
const MAX_CHART_SNAPSHOTS = 5000;
const WS_REFETCH_THROTTLE = 500;

// ---- Sort types ----

type SortField = "market" | "side" | "qty" | "avgEntry" | "currentPrice" | "marginUsed" | "currentValue" | "pnl";
type SortDir = "asc" | "desc";

// ---- Settled position row ----

/**
 * Row shape for the Settled Positions section. Mirrors `PositionRow` loosely
 * but replaces live-market fields (currentPrice, marginUsed, unrealizedPnl)
 * with realized settlement fields (payoutPerShare, payout, realizedPnl)
 * since the market is terminal and those live values are meaningless.
 *
 * Derived in the portfolio page from the enriched `/positions` response --
 * not a shared library type because no other surface needs it (yet).
 */
interface SettledRow {
  marketId: number;
  marketQuestion: string;
  side: "YES" | "NO";
  qty: number;
  /** Cost basis per share in ticks (1000 = $1). `null` if trade history
   * hasn't rehydrated yet -- we show "--" rather than guessing. */
  avgEntry: number | null;
  /** Per-share payout in ticks: 1000 for winning side, 0 for losing,
   * 500 for voided. `null` for defensive "Unknown" sentinel. */
  payoutPerShare: number | null;
  /** Total payout (payoutPerShare * qty) in ticks. `null` when undefined. */
  payout: number | null;
  /** Realized P&L in ticks (payout - cost basis). `null` when either side
   * of the math is unknown. */
  realizedPnl: number | null;
  /** `"Yes"` | `"No"` | `"Unknown"` | null. Mirrors API field verbatim. */
  resolvedOutcome: "Yes" | "No" | "Unknown" | null;
  /** Raw market status for defensive rendering of unmapped variants. */
  marketStatus: string;
  /** Unix-millisecond resolution time; drives recency sort + display. */
  resolvesAt: number | null;
  /** Conditional lineage (null for top-level markets). */
  parentMarketId: number | null;
  parentOutcome: string | null;
  parentQuestion: string | null;
}

// ---- Bridge transaction union type ----

type BridgeTransaction =
  | { type: "deposit"; data: api.DepositRecord }
  | { type: "withdrawal"; data: api.WithdrawalRecord };

const ARBISCAN_BASE = process.env.NEXT_PUBLIC_TESTNET_MODE === "true"
  ? "https://sepolia.arbiscan.io/tx"
  : "https://arbiscan.io/tx";

// ---- Format helpers (oracle theme) ----

const fmtDollars = (v: number): string => {
  const abs = Math.abs(v);
  const str = (abs / 1000).toFixed(2);
  return v < 0 ? `-$${str}` : `$${str}`;
};

const fmtPnl = (v: number | null): string => {
  if (v === null || v === undefined) return "--";
  const sign = v > 0 ? "+" : "";
  return `${sign}${fmtDollars(v)}`;
};

const fmtPct = (v: number): string => {
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
};

// ---- Main Page ----

export default function PortfolioPage() {
  const { account, walletClient, refresh: refreshAccount, updateBalance } = useAccount();
  const { theme } = useTheme();
  const { addListener } = useWs();
  const isDark = theme === "dark";
  const th = isDark ? darkTheme : lightTheme;

  // Data state
  const [positions, setPositions] = useState<ChainPosition[]>([]);
  const [trades, setTrades] = useState<AccountTradeRecord[]>([]);
  const [prices, setPrices] = useState<Map<number, MarketPriceInfo>>(new Map());
  const [orders, setOrders] = useState<EnrichedOrder[]>([]);
  // Rich market metadata map: name + parent conditional fields. Lets the
  // positions table render the void-warning icon without an extra fetch.
  // (Previously this was a name-only `Map<number, string>` — kept the same
  // var name where we read names elsewhere via `.question`.)
  const [marketInfo, setMarketInfo] = useState<Map<number, MarketConditionalInfo>>(new Map());
  const [deposits, setDeposits] = useState<api.DepositRecord[]>([]);
  const [withdrawals, setWithdrawals] = useState<api.WithdrawalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Chart snapshots
  const [chartSnapshots, setChartSnapshots] = useState<{ time: number; value: number }[]>([]);

  // Table state
  const [sortField, setSortField] = useState<SortField>("pnl");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [bridgePage, setBridgePage] = useState(0);

  // Close position state: tracks which positions are currently being closed
  const [closingPositions, setClosingPositions] = useState<Set<string>>(new Set());
  const [closeError, setCloseError] = useState<string | null>(null);

  // Settled Positions section: collapsed by default when the list exceeds
  // SETTLED_COLLAPSE_THRESHOLD so the active-trader view isn't dominated
  // by historical rows. Small lists (<= threshold) render the toggle hidden
  // and the body always shown -- see `showToggle` / `isExpanded` below.
  const SETTLED_COLLAPSE_THRESHOLD = 5;
  const [settledExpanded, setSettledExpanded] = useState(false);

  // Refs
  const fullPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pricePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const accountRef = useRef(account);
  accountRef.current = account;

  // ---- Lifetime analytics (chain task #21) ----
  // Independent fetchers for the new /lifetime + /fills + /equity-curve
  // endpoints. These run alongside (not inside) the legacy fetchAllData
  // poll so a slow lifetime endpoint can never block the existing
  // positions/orders/balance flow that the active trading flows depend on.
  const lifetimeAddress = account?.address ?? null;
  const {
    stats: lifetimeStats,
    loading: lifetimeStatsLoading,
    error: lifetimeStatsError,
    refresh: refreshLifetimeStats,
  } = useLifetimeStats(lifetimeAddress);
  const {
    fills: lifetimeFills,
    loading: lifetimeFillsLoading,
    error: lifetimeFillsError,
    hasMore: lifetimeFillsHasMore,
    loadMore: loadMoreLifetimeFills,
  } = useLifetimeFills(lifetimeAddress, { pageSize: 50 });

  // ---- Data Fetching ----

  // Lightweight: only fetch prices (drives mark-to-market P&L)
  const fetchPrices = useCallback(async () => {
    try {
      const priceData = await api.getMarketPrices().catch(() => ({ markets: [] as MarketPriceInfo[] }));
      setPrices(new Map(priceData.markets.map((p) => [p.market_id, p])));
    } catch {
      // Silent fail for price polling -- full fetch will catch errors
    }
  }, []);

  // Full fetch: all portfolio data (positions, trades, orders, bridge history)
  const fetchAllData = useCallback(async () => {
    const acc = accountRef.current;
    if (!acc) return;
    try {
      const [posData, tradeData, priceData, orderData, marketData, depositData, withdrawalData] = await Promise.all([
        api.getPositions(acc.address).catch(() => [] as ChainPosition[]),
        api.getAccountTrades(acc.address).catch(() => [] as AccountTradeRecord[]),
        api.getMarketPrices().catch(() => ({ markets: [] as MarketPriceInfo[] })),
        api.getAccountOrders(acc.address).catch(() => [] as EnrichedOrder[]),
        api.listMarkets().catch(() => [] as Market[]),
        api.getDeposits(acc.address).catch(() => [] as api.DepositRecord[]),
        api.getWithdrawals(acc.address).catch(() => [] as api.WithdrawalRecord[]),
      ]);

      setPositions(posData);
      setTrades(tradeData);
      setPrices(new Map(priceData.markets.map((p) => [p.market_id, p])));
      setOrders(orderData);
      setMarketInfo(
        new Map(
          marketData.map((m) => [
            Number(m.id),
            {
              question: m.question,
              parent_market_id: m.parent_market_id,
              parent_outcome: m.parent_outcome,
            } as MarketConditionalInfo,
          ]),
        ),
      );
      setDeposits(depositData);
      setWithdrawals(withdrawalData);
      setError(null);
    } catch (e) {
      console.error("Portfolio fetch error:", e);
      setError("Unable to load portfolio data.");
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const accountId = account?.address ?? null;
  useEffect(() => {
    if (!accountId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchAllData();

    // Full data poll every 10s (trades, orders, bridge history)
    fullPollRef.current = setInterval(fetchAllData, FULL_POLL_INTERVAL);
    // Price-only poll every 3s (lightweight, drives P&L updates)
    pricePollRef.current = setInterval(fetchPrices, PRICE_POLL_INTERVAL);

    return () => {
      if (fullPollRef.current) clearInterval(fullPollRef.current);
      if (pricePollRef.current) clearInterval(pricePollRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  // ---- WebSocket real-time updates ----

  const wsRefetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsPriceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchAllDataRef = useRef(fetchAllData);
  fetchAllDataRef.current = fetchAllData;
  const fetchPricesRef = useRef(fetchPrices);
  fetchPricesRef.current = fetchPrices;

  // Throttled full refetch (trades, orders, bridge -- heavier)
  const scheduleRefetch = useCallback(() => {
    if (wsRefetchTimer.current) return;
    wsRefetchTimer.current = setTimeout(() => {
      wsRefetchTimer.current = null;
      fetchAllDataRef.current();
      refreshAccount();
    }, WS_REFETCH_THROTTLE);
  }, [refreshAccount]);

  // Throttled price-only refresh (coalesce rapid trade events)
  const schedulePriceRefresh = useCallback(() => {
    if (wsPriceTimer.current) return;
    wsPriceTimer.current = setTimeout(() => {
      wsPriceTimer.current = null;
      fetchPricesRef.current();
    }, 300); // 300ms throttle: fast enough for responsiveness, avoids flooding
  }, []);

  useEffect(() => {
    if (!accountId) return;
    const remove = addListener((msg: WsServerMessage) => {
      switch (msg.type) {
        case "balance_update":
          // Use balance directly from WS event for instant update (no API round-trip)
          updateBalance(msg.balance);
          break;
        case "position_update":
          setPositions((prev) => {
            const marketId = Number(msg.market_id);
            const idx = prev.findIndex((p) => p.market_id === marketId);
            const updated: ChainPosition = {
              market_id: marketId,
              yes_shares: msg.yes_quantity,
              no_shares: msg.no_quantity,
            };
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = updated;
              return next;
            }
            return [...prev, updated];
          });
          break;
        case "order_fill":
          // Fill = trade happened: prices changed + need full data refresh
          schedulePriceRefresh();
          scheduleRefetch();
          // Lifetime aggregates change on every fill -- piggyback on the
          // throttled WS refetch path. The hook itself is cheap (single
          // GET) but we still let `scheduleRefetch` coalesce bursty
          // PnL flips so we don't fan out N fetches for N consecutive
          // fills on the same tx.
          refreshLifetimeStats();
          break;
        case "order_accepted":
        case "order_cancelled":
          scheduleRefetch();
          break;
        case "trade":
          // Any trade shifts market prices -> update P&L via prices
          schedulePriceRefresh();
          break;
      }
    });

    return () => {
      remove();
      if (wsRefetchTimer.current) {
        clearTimeout(wsRefetchTimer.current);
        wsRefetchTimer.current = null;
      }
      if (wsPriceTimer.current) {
        clearTimeout(wsPriceTimer.current);
        wsPriceTimer.current = null;
      }
    };
  }, [accountId, addListener, updateBalance, scheduleRefetch, schedulePriceRefresh, refreshLifetimeStats]);

  // ---- Compute derived data ----

  const costBasis = useMemo<MarketCostBasis>(() => {
    if (!account || trades.length === 0) return {};
    const chronological = [...trades].reverse();
    return computeCostBasis(chronological, account.address);
  }, [trades, account]);

  const metrics = useMemo<PortfolioMetrics | null>(() => {
    if (!account) return null;
    return computePortfolioMetrics(
      account.balance, positions, prices, costBasis, orders, trades.length,
    );
  }, [account, positions, prices, costBasis, orders, trades.length]);

  useEffect(() => {
    if (metrics && metrics.portfolioValue > 0) {
      setChartSnapshots((prev) => {
        const now = Date.now();
        if (prev.length > 0 && now - prev[prev.length - 1].time < 10_000) return prev;
        const next = [...prev, { time: now, value: metrics.portfolioValue }];
        return next.length > MAX_CHART_SNAPSHOTS ? next.slice(next.length - MAX_CHART_SNAPSHOTS) : next;
      });
    }
  }, [metrics]);

  // Split positions into Open vs Settled BEFORE shape-mapping. A market that
  // has resolved still carries the position row for audit history even
  // though payouts have already credited to balance -- showing those rows
  // in the "Active Positions" section (with a live mark price and an
  // interactive "Close" button that would silently fail on-chain) would be
  // misleading.
  //
  // Classification rule:
  //   - Treat as Open iff market_status is missing (legacy row, e.g. one
  //     just hydrated from a WS `position_update` before a REST refresh
  //     caught it) OR explicitly "Open". Anything else -- Resolved(*),
  //     Closed, or the "Unknown" defensive sentinel -- is Settled.
  //   - Filter out 0/0 share rows on both sides: they provide no signal
  //     and are a side-effect of how the chain persists position records.
  const { openPositions, settledPositions } = useMemo(() => {
    const open: ChainPosition[] = [];
    const settled: ChainPosition[] = [];
    for (const p of positions) {
      if (p.yes_shares <= 0 && p.no_shares <= 0) continue;
      const status = p.market_status;
      if (status == null || status === "Open") {
        open.push(p);
      } else {
        settled.push(p);
      }
    }
    return { openPositions: open, settledPositions: settled };
  }, [positions]);

  const positionRows = useMemo<PositionRow[]>(() => {
    // Pass only OPEN positions to buildPositionRows -- Settled positions
    // get their own non-trading render path below.
    return buildPositionRows(openPositions, prices, costBasis, marketInfo);
  }, [openPositions, prices, costBasis, marketInfo]);

  // Adapter for <LifetimeFillsTable>: it only needs the question text per
  // market id, not the full conditional-info object. Memoised so the Map
  // identity is stable across WS-driven re-renders -- otherwise the
  // table's row useMemo busts on every render and re-walks fills.
  const lifetimeMarketQuestions = useMemo(() => {
    const m = new Map<number, string>();
    for (const [id, info] of marketInfo.entries()) {
      m.set(id, info.question);
    }
    return m;
  }, [marketInfo]);

  // Settled position rows: mirror PositionRow shape but compute a realized
  // payout instead of live P&L, and carry the resolved outcome so the row
  // can badge VOIDED/RESOLVED correctly.
  //
  // Payout math (in ticks, 1000 = $1):
  //   Resolved(Yes):     YES shares -> 1000 each,  NO shares -> 0
  //   Resolved(No):      YES shares -> 0,          NO shares -> 1000 each
  //   Resolved(Unknown): both sides -> 500 each  (conditional-void, 50/50)
  //   Closed / Unknown sentinel: payout shown as "--" (cannot be computed).
  //
  // We keep YES/NO as separate rows (matching Active Positions structure)
  // so merged positions in the same market stay legible.
  const settledRows = useMemo<SettledRow[]>(() => {
    const rows: SettledRow[] = [];
    for (const p of settledPositions) {
      const cb = costBasis[p.market_id];
      // Resolve question + conditional lineage. Prefer the enrichment fields
      // on the position itself (authoritative snapshot from the chain);
      // fall back to the separate marketInfo map when the API is pre-enrich.
      const info = marketInfo.get(p.market_id);
      const question = p.question ?? info?.question ?? `Market #${p.market_id}`;
      const parentMarketId = p.parent_market_id ?? info?.parent_market_id ?? null;
      const parentOutcome = p.parent_outcome ?? info?.parent_outcome ?? null;
      const parentQuestion = parentMarketId != null
        ? (marketInfo.get(parentMarketId)?.question ?? null)
        : null;
      const outcome = p.resolved_outcome ?? null;
      const status = p.market_status ?? "Unknown";

      // Per-row per-side payout in ticks. `null` when we can't compute
      // (status is defensive "Unknown" or a future variant we haven't mapped).
      const payoutPerShare = (side: "YES" | "NO"): number | null => {
        if (outcome === "Yes") return side === "YES" ? 1000 : 0;
        if (outcome === "No") return side === "YES" ? 0 : 1000;
        if (outcome === "Unknown") return 500;
        return null;
      };

      if (p.yes_shares > 0) {
        const pps = payoutPerShare("YES");
        const payout = pps != null ? pps * p.yes_shares : null;
        const avgEntry = cb && cb.yesShares > 0 ? cb.yesTotalCost / cb.yesShares : null;
        // Realized P&L vs cost basis. We only expose it when both sides
        // of the math are known; otherwise leave null so the UI shows "--"
        // rather than making up a number.
        const realizedPnl = payout != null && avgEntry != null
          ? payout - avgEntry * p.yes_shares
          : null;
        rows.push({
          marketId: p.market_id,
          marketQuestion: question,
          side: "YES",
          qty: p.yes_shares,
          avgEntry,
          payoutPerShare: pps,
          payout,
          realizedPnl,
          resolvedOutcome: outcome,
          marketStatus: status,
          resolvesAt: p.resolves_at ?? null,
          parentMarketId,
          parentOutcome,
          parentQuestion,
        });
      }
      if (p.no_shares > 0) {
        const pps = payoutPerShare("NO");
        const payout = pps != null ? pps * p.no_shares : null;
        const avgEntry = cb && cb.noShares > 0 ? cb.noTotalCost / cb.noShares : null;
        const realizedPnl = payout != null && avgEntry != null
          ? payout - avgEntry * p.no_shares
          : null;
        rows.push({
          marketId: p.market_id,
          marketQuestion: question,
          side: "NO",
          qty: p.no_shares,
          avgEntry,
          payoutPerShare: pps,
          payout,
          realizedPnl,
          resolvedOutcome: outcome,
          marketStatus: status,
          resolvesAt: p.resolves_at ?? null,
          parentMarketId,
          parentOutcome,
          parentQuestion,
        });
      }
    }
    // Sort by resolution recency: `resolves_at` desc, fall back to market_id
    // desc (newest market first) as a proxy when the timestamp is missing.
    // Stable when both fields tie (keeps YES above NO as we inserted them).
    rows.sort((a, b) => {
      const at = a.resolvesAt ?? 0;
      const bt = b.resolvesAt ?? 0;
      if (at !== bt) return bt - at;
      return b.marketId - a.marketId;
    });
    return rows;
  }, [settledPositions, costBasis, marketInfo]);

  const sortedPositions = useMemo(() => {
    const rows = [...positionRows];
    rows.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "market": cmp = a.marketQuestion.localeCompare(b.marketQuestion); break;
        case "side": cmp = a.side.localeCompare(b.side); break;
        case "qty": cmp = a.qty - b.qty; break;
        case "avgEntry": cmp = (a.avgEntry ?? 0) - (b.avgEntry ?? 0); break;
        case "currentPrice": cmp = (a.currentPrice ?? 0) - (b.currentPrice ?? 0); break;
        case "marginUsed": cmp = (a.marginUsed ?? 0) - (b.marginUsed ?? 0); break;
        case "currentValue": cmp = (a.currentValue ?? 0) - (b.currentValue ?? 0); break;
        case "pnl": cmp = Math.abs(a.unrealizedPnl ?? 0) - Math.abs(b.unrealizedPnl ?? 0); break;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });
    return rows;
  }, [positionRows, sortField, sortDir]);

  // (Per-trade tradeRows / pagination state removed — the legacy Trade
  //  History view was replaced by `LifetimeFillsTable` over the new
  //  /account/{addr}/fills cursor-paginated endpoint. The chronological
  //  cost-basis derivation feeding the Open/Settled Positions tables
  //  still lives in `costBasis` above.)

  // ---- Bridge transactions (merged + sorted) ----

  const bridgeTransactions = useMemo<BridgeTransaction[]>(() => {
    const txns: BridgeTransaction[] = [
      ...deposits.map((d): BridgeTransaction => ({ type: "deposit", data: d })),
      ...withdrawals.map((w): BridgeTransaction => ({ type: "withdrawal", data: w })),
    ];
    txns.sort((a, b) => {
      // Sort by timestamp if available, fall back to block_height
      const aTime = a.data.timestamp || a.data.block_height;
      const bTime = b.data.timestamp || b.data.block_height;
      return bTime - aTime;
    });
    return txns;
  }, [deposits, withdrawals]);

  const totalBridgePages = Math.max(1, Math.ceil(bridgeTransactions.length / BRIDGE_PER_PAGE));
  const pagedBridge = bridgeTransactions.slice(bridgePage * BRIDGE_PER_PAGE, (bridgePage + 1) * BRIDGE_PER_PAGE);

  const handleSort = useCallback((field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }, [sortField]);

  const sortArrow = (field: SortField): string => {
    if (sortField !== field) return "";
    return sortDir === "desc" ? " \u2193" : " \u2191";
  };

  /**
   * Close a position by placing a market-crossing limit order on the opposite side.
   *
   * For a YES position: place a Sell order at price 1 (aggressive, will cross the book)
   * For a NO position: place a Buy order at price 999 (aggressive, will cross the book)
   *
   * This effectively market-sells the position at the best available price.
   */
  const handleClosePosition = useCallback(async (pos: PositionRow) => {
    if (!account) return;
    const key = `${pos.marketId}-${pos.side}`;
    setClosingPositions((prev) => new Set(prev).add(key));
    setCloseError(null);

    try {
      // To close a YES position, sell YES shares (side=Sell at aggressive price)
      // To close a NO position, buy YES shares (side=Buy at aggressive price)
      // because the exchange only deals in Buy/Sell of YES shares.
      // IOC ensures any unfilled remainder is cancelled — closing a position
      // must never leave a toxic resting order on the book.
      const side = pos.side === "YES" ? "Sell" : "Buy";
      const price = pos.side === "YES" ? 1 : 999; // Cross the book aggressively

      const result = await api.placeOrder(walletClient ?? null, account.address, {
        market_id: pos.marketId,
        side: side as "Buy" | "Sell",
        price,
        quantity: pos.qty,
        time_in_force: "IOC",
      });

      // Wait for confirmation
      if (result?.tx_hash) {
        await api.waitForTx(result.tx_hash);
      }

      // Refresh data
      await fetchAllData();
      await refreshAccount();
    } catch (e) {
      console.error("Close position error:", e);
      setCloseError(e instanceof Error ? e.message : "Failed to close position");
    } finally {
      setClosingPositions((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, [account, walletClient, fetchAllData, refreshAccount]);

  // ---- Not connected state ----

  if (!account) {
    return (
      <div style={{
        minHeight: "100vh",
        backgroundColor: th.bg,
        color: th.textPrimary,
        fontFamily: fonts.sans,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: `${space[6]}px ${space[8]}px`,
      }}>
        <div style={{
          fontFamily: fonts.serif,
          fontSize: 18,
          color: th.textSecondary,
          marginBottom: 24,
          textAlign: "center",
          maxWidth: 360,
          lineHeight: 1.5,
        }}>
          Connect your wallet to view your portfolio and track performance.
        </div>
        <ConnectButton />
      </div>
    );
  }

  // ---- Loading state ----

  if (loading) {
    return (
      <div style={{
        minHeight: "100vh",
        backgroundColor: th.bg,
        color: th.textPrimary,
        fontFamily: fonts.sans,
        padding: `${space[6]}px ${space[8]}px`,
        WebkitFontSmoothing: "antialiased",
      }}>
        <div style={{
          textAlign: "center",
          padding: "80px 0",
          fontFamily: fonts.serif,
          fontStyle: "italic",
          color: th.textTertiary,
        }}>
          Loading portfolio...
        </div>
      </div>
    );
  }

  // ---- Error state ----

  if (error && !metrics) {
    return (
      <div style={{
        minHeight: "100vh",
        backgroundColor: th.bg,
        color: th.textPrimary,
        fontFamily: fonts.sans,
        padding: `${space[6]}px ${space[8]}px`,
      }}>
        <div style={{ textAlign: "center", padding: "60px 0", color: th.textSecondary }}>
          <div style={{ marginBottom: 16, fontSize: 14 }}>{error}</div>
          <button
            onClick={() => { setLoading(true); setError(null); fetchAllData(); }}
            style={{
              padding: "8px 20px",
              borderRadius: 2,
              background: th.accentFrom,
              color: "#000",
              border: "none",
              fontFamily: fonts.sans,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  const m = metrics!;
  const portfolioValue = m.portfolioValue;
  const totalUnrealized = m.unrealizedPnl;
  const totalRealized = m.realizedPnl;
  const positionsValue = m.positionsValue;
  const numTrades = m.numTrades;
  const largestWin = m.largestWin;
  const unrealizedPct = (portfolioValue - totalUnrealized) > 0
    ? (totalUnrealized / (portfolioValue - totalUnrealized)) * 100
    : 0;

  const stats = [
    { label: "Positions Value", value: fmtDollars(positionsValue), isPnl: false, raw: 0 },
    { label: "Available Balance", value: fmtDollars(account.balance), isPnl: false, raw: 0 },
    { label: "Locked Collateral", value: fmtDollars(m.lockedCollateral), isPnl: false, raw: 0 },
    { label: "Realized P&L", value: fmtPnl(totalRealized), isPnl: true, raw: totalRealized },
    { label: "Unrealized P&L", value: fmtPnl(totalUnrealized), isPnl: true, raw: totalUnrealized },
    { label: "Number of Trades", value: numTrades.toString(), isPnl: false, raw: 0 },
  ];

  // Positions table grid template (9 columns: Market, Side, Qty, Avg Entry, Mark, Margin, Value, P&L, Close)
  const posGrid = "minmax(0, 2fr) 52px 56px 76px 76px 82px 82px 100px 60px";

  const pnlColor = (v: number | null) => {
    if (v === null) return th.textTertiary;
    return v > 0 ? th.yes : v < 0 ? th.no : th.textTertiary;
  };

  return (
    <div style={{
      minHeight: "100vh",
      backgroundColor: th.bg,
      color: th.textPrimary,
      fontFamily: fonts.sans,
      padding: `${space[6]}px ${space[8]}px`,
      WebkitFontSmoothing: "antialiased",
    }}>
      {/* Hero + Chart side by side */}
      <div style={{
        display: "flex",
        gap: space[6],
        borderTop: `0.8px solid ${th.border}`,
        borderBottom: `0.8px solid ${th.border}`,
        marginBottom: space[8],
      }}>
        {/* Left: stats */}
        <div style={{
          flex: "0 0 280px",
          padding: `${space[6]}px 0`,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          borderRight: `0.8px solid ${th.border}`,
          paddingRight: space[6],
        }}>
          <div style={{ ...typePresets.metaLabel, color: th.textTertiary, marginBottom: 4 }}>
            Portfolio Value
          </div>
          <div style={{
            fontFamily: fonts.mono,
            fontSize: 48,
            fontWeight: 400,
            letterSpacing: "-0.02em",
            lineHeight: 1,
            color: th.textPrimary,
          }}>
            {fmtDollars(portfolioValue)}
          </div>
          <div style={{
            fontFamily: fonts.mono,
            fontSize: 14,
            fontWeight: 500,
            marginTop: 8,
            color: totalUnrealized > 0 ? th.yes : totalUnrealized < 0 ? th.no : th.textTertiary,
          }}>
            {fmtPnl(totalUnrealized)} ({fmtPct(unrealizedPct)}) unrealized
          </div>
          <div style={{ marginTop: space[6], paddingTop: space[4], borderTop: `0.8px solid ${th.border}` }}>
            <div style={{ ...typePresets.metaLabel, color: th.textTertiary, marginBottom: 4 }}>
              Largest Win
            </div>
            <div style={{
              fontFamily: fonts.mono,
              fontSize: 24,
              fontWeight: 400,
              color: largestWin > 0 ? th.yes : th.textTertiary,
            }}>
              {largestWin > 0 ? fmtPnl(largestWin) : "--"}
            </div>
          </div>
        </div>

        {/* Right: equity chart */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <EquityChart th={th} snapshots={chartSnapshots} isPositive={totalUnrealized >= 0} />
        </div>
      </div>

      {/* Stat Grid (3x2) */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        borderTop: `0.8px solid ${th.border}`,
        marginBottom: space[8],
      }}>
        {stats.map((stat, i) => (
          <div key={stat.label} style={{
            padding: `${space[4]}px ${space[4]}px`,
            borderBottom: `0.8px solid ${th.border}`,
            borderRight: i % 3 !== 2 ? `0.8px solid ${th.border}` : "none",
          }}>
            <div style={{ ...typePresets.metaLabel, color: th.textTertiary, marginBottom: 4 }}>
              {stat.label}
            </div>
            <div style={{
              fontFamily: fonts.mono,
              fontSize: 20,
              fontWeight: 400,
              letterSpacing: "-0.02em",
              lineHeight: 1,
              color: stat.isPnl
                ? (stat.raw > 0 ? th.yes : stat.raw < 0 ? th.no : th.textTertiary)
                : th.textPrimary,
            }}>
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      {/* All-Time Stats card -- lifetime aggregates from /account/{addr}/lifetime.
          Independent of the hero stats above (which are session-scoped /
          mark-to-market). Renders an empty-state placeholder for never-traded
          accounts; full skeleton on first load. */}
      <AllTimeStatsCard
        th={th}
        stats={lifetimeStats}
        loading={lifetimeStatsLoading}
        error={lifetimeStatsError}
        onRetry={refreshLifetimeStats}
      />

      {/* Lifetime equity curve -- persisted history from
          /account/{addr}/equity-curve. Falls back to a "Coming soon"
          placeholder when the backend returns the
          EQUITY_CURVE_PENDING_TASK_19 sentinel; the frontend will pick up
          the real data the moment the api-engineer's PR lands without
          any further wiring. */}
      <LifetimeEquityCurve th={th} address={lifetimeAddress} />

      {/* Open Positions Table */}
      <div style={{ marginBottom: space[10] }}>
        <div style={{
          fontFamily: fonts.serif,
          fontSize: 20,
          fontWeight: 400,
          letterSpacing: "-0.01em",
          color: th.textPrimary,
          marginBottom: space[4],
          paddingBottom: space[2],
          borderBottom: `0.8px solid ${th.border}`,
        }}>
          Open Positions
        </div>

        <div style={{
          display: "grid",
          gridTemplateColumns: posGrid,
          padding: `${space[2]}px ${space[3]}px`,
          ...typePresets.columnHeader,
          color: th.textTertiary,
          borderBottom: `0.8px solid ${th.border}`,
        }}>
          <span onClick={() => handleSort("market")} style={{ cursor: "pointer" }}>Market{sortArrow("market")}</span>
          <span onClick={() => handleSort("side")} style={{ cursor: "pointer" }}>Side{sortArrow("side")}</span>
          <span onClick={() => handleSort("qty")} style={{ cursor: "pointer", textAlign: "right" }}>Qty{sortArrow("qty")}</span>
          <span onClick={() => handleSort("avgEntry")} style={{ cursor: "pointer", textAlign: "right" }}>Entry{sortArrow("avgEntry")}</span>
          <span onClick={() => handleSort("currentPrice")} style={{ cursor: "pointer", textAlign: "right" }}>Mark{sortArrow("currentPrice")}</span>
          <span onClick={() => handleSort("marginUsed")} style={{ cursor: "pointer", textAlign: "right" }}>Margin{sortArrow("marginUsed")}</span>
          <span onClick={() => handleSort("currentValue")} style={{ cursor: "pointer", textAlign: "right" }}>Value{sortArrow("currentValue")}</span>
          <span onClick={() => handleSort("pnl")} style={{ cursor: "pointer", textAlign: "right" }}>Unreal. P&L{sortArrow("pnl")}</span>
          <span style={{ textAlign: "center" }}></span>
        </div>

        {/* Close error banner */}
        {closeError && (
          <div style={{
            padding: `${space[2]}px ${space[3]}px`,
            fontSize: 12,
            fontFamily: fonts.sans,
            color: th.no,
            background: isDark ? "rgba(239,68,68,0.08)" : "rgba(239,68,68,0.06)",
            borderBottom: `0.8px solid ${isDark ? "rgba(239,68,68,0.15)" : "rgba(239,68,68,0.12)"}`,
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

        {sortedPositions.length === 0 ? (
          <div style={{
            textAlign: "center",
            padding: `${space[10]}px 0`,
            fontFamily: fonts.serif,
            fontSize: 16,
            fontStyle: "italic",
            color: th.textTertiary,
          }}>
            No open positions
          </div>
        ) : (
          sortedPositions.map((pos, i) => {
            const posKey = `${pos.marketId}-${pos.side}`;
            const isClosing = closingPositions.has(posKey);

            return (
              <div
                key={`${pos.marketId}-${pos.side}-${i}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: posGrid,
                  padding: `${space[2]}px ${space[3]}px`,
                  alignItems: "center",
                  fontFamily: fonts.mono,
                  fontSize: 13,
                  lineHeight: 1.6,
                  borderBottom: `0.8px solid ${isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.06)"}`,
                  transition: "background 150ms",
                  cursor: "default",
                  opacity: isClosing ? 0.5 : 1,
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLDivElement).style.background = isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.background = "transparent";
                }}
              >
                {/* Market — with conditional void warning when this is a
                    child market. The icon sits *outside* the truncating text
                    span so ellipsis truncation never clips it; both share a
                    flex row with the icon pinned to the right of the title. */}
                <span style={{
                  display: "flex",
                  alignItems: "center",
                  minWidth: 0,
                  fontFamily: fonts.sans,
                  fontSize: 13,
                }}>
                  <Link
                    href={`/market/${pos.marketId}`}
                    style={{
                      color: "inherit",
                      textDecoration: "none",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      minWidth: 0,
                    }}
                  >
                    {pos.marketQuestion}
                  </Link>
                  {pos.parentMarketId != null && (
                    <ConditionalWarningIcon
                      parentQuestion={pos.parentQuestion}
                      parentOutcome={pos.parentOutcome}
                      th={th}
                      size={11}
                    />
                  )}
                </span>
                {/* Side */}
                <span>
                  <span style={{
                    display: "inline-block",
                    padding: "1px 6px",
                    borderRadius: 2,
                    fontSize: 10,
                    fontWeight: 600,
                    fontFamily: fonts.sans,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    background: pos.side === "YES"
                      ? (isDark ? "rgba(34,197,94,0.12)" : "rgba(34,197,94,0.1)")
                      : (isDark ? "rgba(239,68,68,0.12)" : "rgba(239,68,68,0.1)"),
                    color: pos.side === "YES" ? th.yes : th.no,
                  }}>
                    {pos.side}
                  </span>
                </span>
                {/* Qty */}
                <span style={{ textAlign: "right" }}>{pos.qty}</span>
                {/* Avg Entry */}
                <span style={{ textAlign: "right" }}>{pos.avgEntry != null ? (pos.avgEntry / 1000).toFixed(3) : "--"}</span>
                {/* Mark Price */}
                <span style={{ textAlign: "right" }}>{pos.currentPrice != null ? (pos.currentPrice / 1000).toFixed(3) : "--"}</span>
                {/* Margin Used */}
                <span style={{ textAlign: "right", color: th.textSecondary }}>
                  {pos.marginUsed != null ? fmtDollars(pos.marginUsed) : "--"}
                </span>
                {/* Current Value */}
                <span style={{ textAlign: "right" }}>
                  {pos.currentValue != null ? fmtDollars(pos.currentValue) : "--"}
                </span>
                {/* Unrealized P&L */}
                <span style={{ textAlign: "right", color: pnlColor(pos.unrealizedPnl ?? null) }}>
                  {pos.unrealizedPnl != null ? fmtPnl(pos.unrealizedPnl) : "--"}
                  {pos.unrealizedPnlPct != null && (
                    <span style={{ fontSize: 10, opacity: 0.6, marginLeft: 4 }}>
                      ({fmtPct(pos.unrealizedPnlPct)})
                    </span>
                  )}
                </span>
                {/* Close Button */}
                <span style={{ textAlign: "center" }}>
                  <button
                    onClick={() => handleClosePosition(pos)}
                    disabled={isClosing}
                    aria-label={`Close ${pos.side} position in ${pos.marketQuestion}`}
                    style={{
                      padding: "2px 10px",
                      borderRadius: 2,
                      fontSize: 10,
                      fontWeight: 600,
                      fontFamily: fonts.sans,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      background: "transparent",
                      border: `0.8px solid ${th.no}`,
                      color: th.no,
                      cursor: isClosing ? "not-allowed" : "pointer",
                      transition: "all 150ms",
                      opacity: isClosing ? 0.4 : 0.7,
                    }}
                    onMouseEnter={(e) => {
                      if (!isClosing) {
                        (e.currentTarget as HTMLButtonElement).style.background = isDark ? "rgba(239,68,68,0.12)" : "rgba(239,68,68,0.08)";
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
          })
        )}
      </div>

      {/* Settled Positions -- resolved markets where position records are
          retained for audit history even though payouts have already been
          credited to balance. Rendered as non-interactive history: no
          live mark price, no close button, no sortable columns. */}
      {settledRows.length > 0 && (() => {
        // Expansion logic: lists at/below threshold always render expanded
        // (no toggle rendered). Above the threshold, start collapsed and
        // flip on user toggle.
        const showToggle = settledRows.length > SETTLED_COLLAPSE_THRESHOLD;
        const isExpanded = !showToggle || settledExpanded;
        // Grid: Market | Side | Qty | Entry | Outcome | Payout | Realized P&L
        // Wider Outcome column than Side because "VOIDED" is the longest label.
        const settledGrid = "minmax(0, 2fr) 52px 56px 76px 84px 92px 104px";
        return (
          <div style={{ marginBottom: space[10] }}>
            <div
              style={{
                fontFamily: fonts.serif,
                fontSize: 20,
                fontWeight: 400,
                letterSpacing: "-0.01em",
                color: th.textPrimary,
                marginBottom: space[4],
                paddingBottom: space[2],
                borderBottom: `0.8px solid ${th.border}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                cursor: showToggle ? "pointer" : "default",
                userSelect: "none",
              }}
              onClick={() => {
                if (showToggle) setSettledExpanded((prev) => !prev);
              }}
              role={showToggle ? "button" : undefined}
              aria-expanded={showToggle ? isExpanded : undefined}
              aria-controls="settled-positions-body"
            >
              <span>
                Settled Positions{" "}
                <span style={{
                  ...typePresets.metaLabel,
                  color: th.textTertiary,
                  marginLeft: space[2],
                }}>
                  ({settledRows.length})
                </span>
              </span>
              {showToggle && (
                <span style={{
                  ...typePresets.metaLabel,
                  color: th.textTertiary,
                  fontFamily: fonts.sans,
                }}>
                  {isExpanded ? "Hide" : `Show all (${settledRows.length})`}{" "}
                  <span aria-hidden="true" style={{ opacity: 0.6 }}>
                    {isExpanded ? "\u2191" : "\u2193"}
                  </span>
                </span>
              )}
            </div>

            {isExpanded && (
              <div id="settled-positions-body">
                {/* Header row */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: settledGrid,
                    padding: `${space[2]}px ${space[3]}px`,
                    ...typePresets.columnHeader,
                    color: th.textTertiary,
                    borderBottom: `0.8px solid ${th.border}`,
                  }}
                >
                  <span>Market</span>
                  <span>Side</span>
                  <span style={{ textAlign: "right" }}>Qty</span>
                  <span style={{ textAlign: "right" }}>Entry</span>
                  <span style={{ textAlign: "center" }}>Outcome</span>
                  <span style={{ textAlign: "right" }}>Payout</span>
                  <span style={{ textAlign: "right" }}>Realized</span>
                </div>

                {settledRows.map((row, i) => {
                  // Outcome badge copy + color. VOIDED gets amber to match
                  // the same palette used on the conditional-warning icon
                  // and inline void disclaimer elsewhere in the app.
                  //
                  // "PENDING" covers the defensive sentinel cases where we
                  // have a position but no resolved outcome:
                  //   - `marketStatus === "MissingMarket"` (new chain sentinel)
                  //   - `marketStatus === "Unknown"`       (legacy sentinel)
                  // Both mean "the chain hasn't surfaced the owning market
                  // yet" -- funds aren't at risk, the UI just can't compute
                  // a payout. Distinct from `Resolved(Unknown)` which is a
                  // *legitimate* void resolution (50/50 payout).
                  const isPendingSentinel =
                    row.marketStatus === "MissingMarket" ||
                    row.marketStatus === "Unknown";
                  const outcomeLabel = row.resolvedOutcome === "Yes"
                    ? "YES"
                    : row.resolvedOutcome === "No"
                    ? "NO"
                    : row.resolvedOutcome === "Unknown"
                    ? "VOIDED"
                    : isPendingSentinel
                    ? "PENDING"
                    : "PENDING"; // any other unmapped status -> pending
                  const amber = isDark ? "#EAB308" : "#B45309";
                  const outcomeColor =
                    row.resolvedOutcome === "Yes" ? th.yes
                      : row.resolvedOutcome === "No" ? th.no
                      : row.resolvedOutcome === "Unknown" ? amber
                      : isPendingSentinel ? amber
                      : th.textTertiary;
                  const outcomeBg =
                    row.resolvedOutcome === "Yes"
                      ? (isDark ? "rgba(34,197,94,0.12)" : "rgba(34,197,94,0.1)")
                      : row.resolvedOutcome === "No"
                      ? (isDark ? "rgba(239,68,68,0.12)" : "rgba(239,68,68,0.1)")
                      : row.resolvedOutcome === "Unknown"
                      ? (isDark ? "rgba(234,179,8,0.12)" : "rgba(234,179,8,0.1)")
                      : isPendingSentinel
                      ? (isDark ? "rgba(234,179,8,0.12)" : "rgba(234,179,8,0.1)")
                      : (isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)");

                  // Per-share payout display ($1.00 / $0.00 / $0.50 / --).
                  const ppsDisplay = row.payoutPerShare != null
                    ? `$${(row.payoutPerShare / 1000).toFixed(2)}`
                    : "--";

                  return (
                    <div
                      key={`${row.marketId}-${row.side}-${i}`}
                      style={{
                        display: "grid",
                        gridTemplateColumns: settledGrid,
                        padding: `${space[2]}px ${space[3]}px`,
                        alignItems: "center",
                        fontFamily: fonts.mono,
                        fontSize: 13,
                        lineHeight: 1.6,
                        borderBottom: `0.8px solid ${isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.06)"}`,
                        transition: "background 150ms",
                        // Muted baseline opacity -- settled positions are
                        // history, not signal. Lifts to full opacity on
                        // hover for legibility.
                        opacity: 0.82,
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLDivElement).style.background = isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)";
                        (e.currentTarget as HTMLDivElement).style.opacity = "1";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLDivElement).style.background = "transparent";
                        (e.currentTarget as HTMLDivElement).style.opacity = "0.82";
                      }}
                    >
                      {/* Market (question text + conditional warning icon
                          for voided child markets, matching the Open
                          Positions row treatment). */}
                      <span style={{
                        display: "flex",
                        alignItems: "center",
                        minWidth: 0,
                        fontFamily: fonts.sans,
                        fontSize: 13,
                      }}>
                        <Link
                          href={`/market/${row.marketId}`}
                          style={{
                            color: "inherit",
                            textDecoration: "none",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            minWidth: 0,
                          }}
                        >
                          {row.marketQuestion}
                        </Link>
                        {row.parentMarketId != null && row.resolvedOutcome === "Unknown" && (
                          // Only surface the warning on voided children --
                          // on a child that resolved cleanly (Yes/No), the
                          // conditional nature is now history, not a caveat.
                          <ConditionalWarningIcon
                            parentQuestion={row.parentQuestion}
                            parentOutcome={row.parentOutcome}
                            th={th}
                            size={11}
                          />
                        )}
                      </span>
                      {/* Side (YES/NO user held) */}
                      <span>
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
                            ? (isDark ? "rgba(34,197,94,0.12)" : "rgba(34,197,94,0.1)")
                            : (isDark ? "rgba(239,68,68,0.12)" : "rgba(239,68,68,0.1)"),
                          color: row.side === "YES" ? th.yes : th.no,
                        }}>
                          {row.side}
                        </span>
                      </span>
                      {/* Qty */}
                      <span style={{ textAlign: "right" }}>{row.qty}</span>
                      {/* Avg entry (cost basis per share) */}
                      <span style={{ textAlign: "right" }}>
                        {row.avgEntry != null ? (row.avgEntry / 1000).toFixed(3) : "--"}
                      </span>
                      {/* Outcome badge */}
                      <span style={{ textAlign: "center" }}>
                        <span style={{
                          display: "inline-block",
                          padding: "1px 6px",
                          borderRadius: 2,
                          fontSize: 10,
                          fontWeight: 600,
                          fontFamily: fonts.sans,
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                          background: outcomeBg,
                          color: outcomeColor,
                        }}>
                          {outcomeLabel}
                        </span>
                      </span>
                      {/* Total payout (realized, not mark-to-market).
                          Right-aligned like the Value column on Open
                          Positions so the table eye-tracks cleanly when
                          the two sections sit stacked. */}
                      <span
                        style={{ textAlign: "right" }}
                        title={row.payoutPerShare != null
                          ? `${ppsDisplay} per share x ${row.qty} shares`
                          : undefined}
                      >
                        {row.payout != null ? fmtDollars(row.payout) : "--"}
                      </span>
                      {/* Realized P&L */}
                      <span style={{
                        textAlign: "right",
                        color: pnlColor(row.realizedPnl),
                      }}>
                        {row.realizedPnl != null ? fmtPnl(row.realizedPnl) : "--"}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {/* Lifetime Fills (replaces the legacy paginated Trade History view).
          Cursor-based infinite scroll over /account/{addr}/fills, walks back
          to first fill rather than capping at the in-memory window the
          old endpoint exposed. The legacy `tradeRows` derivation is still
          used by the cost-basis machinery (see `costBasis` upstream) --
          we just don't render that derived table any more. */}
      <LifetimeFillsTable
        th={th}
        isDark={isDark}
        fills={lifetimeFills}
        loading={lifetimeFillsLoading}
        hasMore={lifetimeFillsHasMore}
        error={lifetimeFillsError}
        marketQuestions={lifetimeMarketQuestions}
        loadMore={loadMoreLifetimeFills}
      />

      {/* Bridge History */}
      <div style={{ marginBottom: space[10] }}>
        <div style={{
          fontFamily: fonts.serif,
          fontSize: 20,
          fontWeight: 400,
          letterSpacing: "-0.01em",
          color: th.textPrimary,
          marginBottom: space[4],
          paddingBottom: space[2],
          borderBottom: `0.8px solid ${th.border}`,
        }}>
          Bridge History
        </div>

        <div style={{
          display: "grid",
          gridTemplateColumns: "90px minmax(0, 1fr) 90px minmax(0, 1.2fr) 120px",
          padding: `${space[2]}px ${space[3]}px`,
          ...typePresets.columnHeader,
          color: th.textTertiary,
          borderBottom: `0.8px solid ${th.border}`,
        }}>
          <span>Type</span>
          <span style={{ textAlign: "right" }}>Amount</span>
          <span style={{ textAlign: "center" }}>Status</span>
          <span>Arbitrum TX</span>
          <span style={{ textAlign: "right" }}>Date</span>
        </div>

        {pagedBridge.length === 0 ? (
          <div style={{
            textAlign: "center",
            padding: `${space[10]}px 0`,
            fontFamily: fonts.serif,
            fontSize: 16,
            fontStyle: "italic",
            color: th.textTertiary,
          }}>
            No bridge transactions yet
          </div>
        ) : (
          pagedBridge.map((txn) => {
            const isDeposit = txn.type === "deposit";
            const amount = txn.data.amount;
            const timestamp = txn.data.timestamp;
            const arbHash = txn.data.arbitrum_tx_hash;
            const status = isDeposit ? "Confirmed" : (txn.data as api.WithdrawalRecord).status;
            const truncHash = arbHash
              ? `${arbHash.slice(0, 6)}...${arbHash.slice(-4)}`
              : null;

            const statusBg = (() => {
              switch (status) {
                case "Confirmed":
                case "Finalized":
                  return isDark ? "rgba(34,197,94,0.12)" : "rgba(34,197,94,0.1)";
                case "Pending":
                  return isDark ? "rgba(234,179,8,0.12)" : "rgba(234,179,8,0.1)";
                case "Refunded":
                  return isDark ? "rgba(239,68,68,0.12)" : "rgba(239,68,68,0.1)";
                default:
                  return isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)";
              }
            })();

            const statusColor = (() => {
              switch (status) {
                case "Confirmed":
                case "Finalized":
                  return th.yes;
                case "Pending":
                  return isDark ? "#eab308" : "#b45309";
                case "Refunded":
                  return th.no;
                default:
                  return th.textTertiary;
              }
            })();

            return (
              <div
                key={`${txn.type}-${txn.data.id}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "90px minmax(0, 1fr) 90px minmax(0, 1.2fr) 120px",
                  padding: `${space[2]}px ${space[3]}px`,
                  fontFamily: fonts.mono,
                  fontSize: 13,
                  lineHeight: 1.6,
                  borderBottom: `0.8px solid ${isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.06)"}`,
                  transition: "background 150ms",
                  cursor: "default",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLDivElement).style.background = isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.background = "transparent";
                }}
              >
                {/* Type */}
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{
                    fontSize: 12,
                    opacity: 0.5,
                  }}>
                    {isDeposit ? "\u2193" : "\u2191"}
                  </span>
                  <span style={{
                    fontSize: 11,
                    fontWeight: 500,
                    fontFamily: fonts.sans,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: isDeposit ? th.yes : th.textSecondary,
                  }}>
                    {isDeposit ? "Deposit" : "Withdraw"}
                  </span>
                </span>

                {/* Amount */}
                <span style={{ textAlign: "right" }}>
                  ${(amount / 1000).toFixed(2)}
                </span>

                {/* Status badge */}
                <span style={{ textAlign: "center" }}>
                  <span style={{
                    display: "inline-block",
                    padding: "1px 6px",
                    borderRadius: 2,
                    fontSize: 10,
                    fontWeight: 600,
                    fontFamily: fonts.sans,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    background: statusBg,
                    color: statusColor,
                  }}>
                    {status}
                  </span>
                </span>

                {/* Arbitrum TX */}
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {truncHash ? (
                    <a
                      href={`${ARBISCAN_BASE}/${arbHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        color: th.textSecondary,
                        textDecoration: "none",
                        transition: "color 150ms",
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLAnchorElement).style.color = th.accentFrom;
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLAnchorElement).style.color = th.textSecondary;
                      }}
                    >
                      {truncHash} <span style={{ fontSize: 10, opacity: 0.5 }}>&rarr;</span>
                    </a>
                  ) : (
                    <span style={{ color: th.textTertiary, fontSize: 12 }}>--</span>
                  )}
                </span>

                {/* Date */}
                <span
                  style={{ textAlign: "right", color: th.textTertiary }}
                  title={timestamp ? formatAbsoluteTime(timestamp) : undefined}
                >
                  {timestamp ? formatRelativeTime(timestamp) : "\u2014"}
                </span>
              </div>
            );
          })
        )}

        {/* Pagination */}
        {totalBridgePages > 1 && (
          <div style={{
            padding: "12px 0",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: space[2],
          }}>
            <button
              onClick={() => setBridgePage(Math.max(0, bridgePage - 1))}
              disabled={bridgePage === 0}
              style={{
                ...typePresets.metaLabel,
                padding: "4px 8px",
                borderRadius: 2,
                background: "transparent",
                border: `0.8px solid ${th.border}`,
                color: th.textSecondary,
                cursor: bridgePage === 0 ? "not-allowed" : "pointer",
                opacity: bridgePage === 0 ? 0.3 : 1,
              }}
            >
              &lt; Prev
            </button>
            <span style={{ ...typePresets.metaLabel, color: th.textTertiary }}>
              Page {bridgePage + 1} of {totalBridgePages}
            </span>
            <button
              onClick={() => setBridgePage(Math.min(totalBridgePages - 1, bridgePage + 1))}
              disabled={bridgePage >= totalBridgePages - 1}
              style={{
                ...typePresets.metaLabel,
                padding: "4px 8px",
                borderRadius: 2,
                background: "transparent",
                border: `0.8px solid ${th.border}`,
                color: th.textSecondary,
                cursor: bridgePage >= totalBridgePages - 1 ? "not-allowed" : "pointer",
                opacity: bridgePage >= totalBridgePages - 1 ? 0.3 : 1,
              }}
            >
              Next &gt;
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

