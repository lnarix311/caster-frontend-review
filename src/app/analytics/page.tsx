"use client";

import { useEffect, useState, useCallback } from "react";
import * as api from "@/lib/api";

const CLP_ADDRESS = "bcc053586447d7253afa44c542e54bc9b574acc7af03ac0da0ff516f4a075d91";
const STARTING_BALANCE = 15_000_000;
const POLL_INTERVAL = 5000;
// CLP restarted: 2026-03-23T15:25:49Z (chain restart for condition_id DB update)
const START_TIME = new Date("2026-03-23T15:25:49Z");

function toUsd(ticks: number) {
  return (ticks / 1000).toFixed(2);
}

function toCents(ticks: number) {
  return (ticks / 10).toFixed(1);
}

function pctStr(value: number) {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function pnlColor(value: number) {
  if (value > 0) return "var(--green)";
  if (value < 0) return "var(--red)";
  return "var(--text-primary)";
}

/**
 * 4-factor P&L scaling model:
 *   Real_PnL = Testnet_PnL × (1/V) × S × A × U
 *
 * V = volume scaling (testnet fills / real fills)
 * S = spread compression from competition
 * A = adverse selection retention (how much edge survives informed flow)
 * U = uptime/reliability
 */
function scaledPnl(rawPnl: number, V: number, S: number, A: number, U: number) {
  const factor = S * A * U;
  const divisor = factor > 0 ? V / factor : Infinity;
  return {
    pnl: rawPnl / divisor,
    divisor: Math.round(divisor),
  };
}

function annualizedApr(pnl: number, uptimeMs: number, capital: number) {
  if (uptimeMs <= 0 || capital <= 0) return 0;
  const hoursUp = uptimeMs / 3600000;
  const hourlyReturn = pnl / capital / hoursUp;
  return hourlyReturn * 8760 * 100; // annualized %
}

function formatUptime(start: Date): string {
  const ms = Date.now() - start.getTime();
  const totalSec = Math.floor(ms / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatStartTime(start: Date): string {
  return start.toLocaleString("en-SG", {
    timeZone: "Asia/Singapore",
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
    hour12: true,
  }) + " SGT";
}

interface ClpMarketData {
  mm_fills: number;
  taker_fills: number;
  mm_notional: number;
  mm_maker_rebates: number;
  taker_fees: number;
  realized_spread_pnl: number;
  pairs_redeemed: number;
  yes_cost_basis: number;
  no_cost_basis: number;
  cost_basis_yes_shares: number;
  cost_basis_no_shares: number;
  mid: number;
  yes_shares: number;
  no_shares: number;
  locked_collateral: number;
}

interface ClpAnalytics {
  balance: number;
  locked_collateral: number;
  markets: Record<string, ClpMarketData>;
}

const MAX_POSITION_PCT = 0.25; // must match CLP --max-position-pct

interface MarketRow {
  id: number;
  question: string;
  mid: number | null;
  yesShares: number;
  noShares: number;
  net: number;
  exposure: number;
  cashUtil: number;
  equityUtil: number;
  realizedSpread: number;
  pairsRedeemed: number;
  makerFills: number;
  takerFills: number;
  makerRebates: number;
  takerFees: number;
  positionMtm: number;
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-lg p-4" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
      <div className="text-xs mb-1" style={{ color: "var(--text-secondary)" }}>{label}</div>
      <div className="text-xl font-light font-mono" style={{ color: color || "var(--text-primary)" }}>{value}</div>
      {sub && <div className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>{sub}</div>}
    </div>
  );
}

export default function AnalyticsPage() {
  const [balance, setBalance] = useState(0);
  const [rows, setRows] = useState<MarketRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [clpData, setClpData] = useState<ClpAnalytics | null>(null);
  const [uptime, setUptime] = useState("");

  const fetchData = useCallback(async () => {
    try {
      const [acct, positions, markets, clpResp] = await Promise.all([
        api.getAccount(CLP_ADDRESS),
        api.getPositions(CLP_ADDRESS),
        api.listMarkets(),
        fetch("/api/clp-analytics").then(r => r.ok ? r.json() : null).catch(() => null),
      ]);

      setBalance(acct.balance);
      if (clpResp) setClpData(clpResp);
      setUptime(formatUptime(START_TIME));

      const allIds = new Set([1, 2, 3, 4, 5, 6]);
      const marketRows: MarketRow[] = [];

      for (const mid of allIds) {
        const market = markets.find((m: any) => String(m.id) === String(mid));
        const pos = positions.find((p: any) => p.market_id === mid);
        const clpMarket = clpResp?.markets?.[String(mid)] as ClpMarketData | undefined;

        let midPrice: number | null = clpMarket?.mid ?? null;
        if (!midPrice) {
          try {
            const book = await api.getOrderbook(String(mid));
            if (book.bids.length > 0 && book.asks.length > 0) {
              midPrice = Math.round((book.bids[0].price + book.asks[0].price) / 2);
            } else if (book.bids.length > 0) {
              midPrice = book.bids[0].price;
            } else if (book.asks.length > 0) {
              midPrice = book.asks[0].price;
            }
          } catch {}
        }

        const yesShares = pos?.yes_shares ?? 0;
        const noShares = pos?.no_shares ?? 0;
        const net = yesShares - noShares;
        const mp = midPrice ?? 500;
        const positionMtm = yesShares * mp + noShares * (1000 - mp);

        const realizedSpread = clpMarket?.realized_spread_pnl ?? 0;
        const pairsRedeemed = clpMarket?.pairs_redeemed ?? 0;
        const makerFills = clpMarket?.mm_fills ?? 0;
        const takerFills = clpMarket?.taker_fills ?? 0;
        const makerRebates = clpMarket?.mm_maker_rebates ?? 0;
        const takerFees = clpMarket?.taker_fees ?? 0;

        marketRows.push({
          id: mid,
          question: market?.question ?? `Market #${mid}`,
          mid: midPrice,
          yesShares, noShares, net,
          exposure: 0, cashUtil: 0, equityUtil: 0, // set below
          realizedSpread, pairsRedeemed,
          makerFills, takerFills, makerRebates, takerFees,
          positionMtm,
        });
      }

      // Compute equity-based exposure & position limit utilization
      const totalPosMtm = marketRows.reduce((s, r) => s + r.positionMtm, 0);
      const lockedColl = clpResp?.locked_collateral ?? 0;
      const equity = acct.balance + lockedColl + totalPosMtm;
      const numMarkets = marketRows.length || 1;
      const perMarketEquity = equity / numMarkets;
      const cashLimit = (acct.balance / numMarkets) * MAX_POSITION_PCT;
      const equityLimit = perMarketEquity * MAX_POSITION_PCT;

      for (const r of marketRows) {
        const posTicks = r.positionMtm;
        r.exposure = perMarketEquity > 0 ? (posTicks / perMarketEquity) * 100 : 0;
        r.cashUtil = cashLimit > 0 ? (posTicks / cashLimit) * 100 : 0;
        r.equityUtil = equityLimit > 0 ? (posTicks / equityLimit) * 100 : 0;
      }

      marketRows.sort((a, b) => a.id - b.id);
      setRows(marketRows);
      setLastUpdate(new Date());
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Uptime ticker
  useEffect(() => {
    const t = setInterval(() => setUptime(formatUptime(START_TIME)), 60000);
    return () => clearInterval(t);
  }, []);

  const totalPositionMtm = rows.reduce((s, r) => s + r.positionMtm, 0);
  const totalLockedCollateral = clpData?.locked_collateral ?? 0;
  const totalEquity = balance + totalLockedCollateral + totalPositionMtm;
  const totalRealizedSpread = rows.reduce((s, r) => s + r.realizedSpread, 0);
  const totalRebates = rows.reduce((s, r) => s + r.makerRebates, 0);
  const totalTakerFees = rows.reduce((s, r) => s + r.takerFees, 0);
  const netFeeIncome = totalRebates - totalTakerFees;
  const realizedPnl = totalRealizedSpread + netFeeIncome;
  const totalPnl = realizedPnl;
  const totalPnlPct = STARTING_BALANCE > 0 ? (totalPnl / STARTING_BALANCE) * 100 : 0;
  // 4-factor P&L estimates
  const uptimeMs = Date.now() - START_TIME.getTime();
  // Moderate: V=200, S=0.50, A=0.25, U=0.80 → ÷2,000 (~6% APR)
  const moderate = scaledPnl(totalPnl, 200, 0.50, 0.25, 0.80);
  const moderateApr = annualizedApr(moderate.pnl, uptimeMs, STARTING_BALANCE);
  // Honest: V=350, S=0.50, A=0.25, U=0.80 × I=0.90 → ÷3,889 (~3% APR)
  const honest = scaledPnl(totalPnl, 350, 0.50, 0.25, 0.80 * 0.90);
  const honestApr = annualizedApr(honest.pnl, uptimeMs, STARTING_BALANCE);
  const totalMakerFills = rows.reduce((s, r) => s + r.makerFills, 0);
  const totalPairs = rows.reduce((s, r) => s + r.pairsRedeemed, 0);

  // Position limit health
  const numMarketsDisplay = rows.length || 1;
  const cashLimitPerMarket = (balance / numMarketsDisplay) * MAX_POSITION_PCT;
  const equityLimitPerMarket = (totalEquity / numMarketsDisplay) * MAX_POSITION_PCT;
  const marketsOverCash = rows.filter(r => r.cashUtil > 100).length;
  const marketsOverEquity = rows.filter(r => r.equityUtil > 100).length;

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-6 py-8 text-center" style={{ color: "var(--text-secondary)" }}>
        Loading CLP data...
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">CLP Market Maker</h1>
          <div className="text-xs font-mono mt-1" style={{ color: "var(--text-secondary)" }}>
            {CLP_ADDRESS.slice(0, 12)}...{CLP_ADDRESS.slice(-8)}
          </div>
        </div>
        <div className="flex items-center gap-3 text-right">
          <div>
            <div className="text-xs font-mono" style={{ color: "var(--text-secondary)" }}>
              Started {formatStartTime(START_TIME)}
            </div>
            <div className="text-xs font-mono" style={{ color: "var(--text-secondary)" }}>
              Uptime: {uptime}
            </div>
          </div>
          {clpData && (
            <span className="text-xs px-2 py-1 rounded" style={{ background: "var(--green-dim)", color: "var(--green)" }}>
              Live
            </span>
          )}
          {!clpData && (
            <span className="text-xs px-2 py-1 rounded" style={{ background: "rgba(239,68,68,0.1)", color: "var(--red)" }}>
              Offline
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded text-xs" style={{ background: "rgba(239,68,68,0.1)", color: "var(--red)" }}>
          {error}
        </div>
      )}

      {/* Equity */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard
          label="Testnet P&L (Raw)"
          value={`$${toUsd(totalPnl)}`}
          sub={pctStr(totalPnlPct)}
        />
        <StatCard
          label="Total Equity"
          value={`$${toUsd(totalEquity)}`}
          sub="Cash + orders + positions"
        />
        <StatCard
          label={`Est. Real P&L — Moderate (÷${moderate.divisor})`}
          value={`$${toUsd(moderate.pnl)}`}
          sub={`~${moderateApr.toFixed(1)}% APR`}
          color={pnlColor(moderate.pnl)}
        />
        <StatCard
          label={`Est. Real P&L — Honest (÷${honest.divisor})`}
          value={`$${toUsd(honest.pnl)}`}
          sub={`~${honestApr.toFixed(1)}% APR`}
          color={pnlColor(honest.pnl)}
        />
      </div>

      {/* P&L Breakdown (testnet raw — not scaled) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard
          label="Spread Capture (testnet)"
          value={`$${toUsd(totalRealizedSpread)}`}
          sub={`${totalPairs.toLocaleString()} round trips`}
        />
        <StatCard
          label="Net Fees (testnet)"
          value={`$${toUsd(netFeeIncome)}`}
          sub={`+$${toUsd(totalRebates)} reb / -$${toUsd(totalTakerFees)} fee`}
        />
        <StatCard
          label="Free Balance"
          value={`$${toUsd(balance)}`}
          sub={`+ $${toUsd(totalLockedCollateral)} locked`}
        />
        <StatCard
          label="Maker Fills"
          value={totalMakerFills.toLocaleString()}
          sub={`${rows.reduce((s, r) => s + r.takerFills, 0)} taker`}
        />
      </div>

      {/* Position Limit Health */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard
          label="Max Pos — Cash-Based (Current)"
          value={`$${toUsd(cashLimitPerMarket)}`}
          sub={`${marketsOverCash}/${numMarketsDisplay} markets over limit`}
          color={marketsOverCash > 0 ? "var(--red)" : "var(--green)"}
        />
        <StatCard
          label="Max Pos — Equity-Based (Correct)"
          value={`$${toUsd(equityLimitPerMarket)}`}
          sub={`${marketsOverEquity}/${numMarketsDisplay} markets over limit`}
          color={marketsOverEquity > 0 ? "#f59e0b" : "var(--green)"}
        />
        <StatCard
          label="Headroom Lost"
          value={`$${toUsd((equityLimitPerMarket - cashLimitPerMarket) * 6)}`}
          sub={`$${toUsd(equityLimitPerMarket - cashLimitPerMarket)}/mkt`}
        />
        <StatCard
          label="Worst Exposure"
          value={`${Math.max(...rows.map(r => r.exposure), 0).toFixed(1)}%`}
          sub={`${MAX_POSITION_PCT * 100}% limit = 100% util`}
          color={Math.max(...rows.map(r => r.exposure), 0) > MAX_POSITION_PCT * 100 ? "var(--red)" : "var(--text-primary)"}
        />
      </div>

      {/* Per-Market Table */}
      <div className="rounded-lg overflow-hidden" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
        <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
          <div className="text-sm font-medium">Performance by Market</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr style={{ color: "var(--text-secondary)", borderBottom: "1px solid var(--border)" }}>
                <th className="text-left px-4 py-2 font-medium">Market</th>
                <th className="text-right px-3 py-2 font-medium">Mid</th>
                <th className="text-right px-3 py-2 font-medium">Position</th>
                <th className="text-right px-3 py-2 font-medium">Exposure</th>
                <th className="text-right px-3 py-2 font-medium">Limit Util</th>
                <th className="text-right px-3 py-2 font-medium">Pos Value</th>
                <th className="text-right px-3 py-2 font-medium">Spread P&L</th>
                <th className="text-right px-3 py-2 font-medium">Pairs</th>
                <th className="text-right px-3 py-2 font-medium">Net Fees</th>
                <th className="text-right px-3 py-2 font-medium">Fills</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const netFee = r.makerRebates - r.takerFees;
                return (
                  <tr key={r.id} style={{ borderBottom: "1px solid var(--border)" }} className="hover:opacity-80">
                    <td className="px-4 py-3">
                      <div className="font-medium text-xs" style={{ color: "var(--text-primary)" }}>
                        #{r.id}
                      </div>
                      <div className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
                        {r.question.length > 35 ? r.question.slice(0, 35) + "..." : r.question}
                      </div>
                    </td>
                    <td className="text-right px-3 py-3">
                      {r.mid ? `${toCents(r.mid)}\u00A2` : "\u2014"}
                    </td>
                    <td className="text-right px-3 py-3">
                      <span style={{ color: r.net > 0 ? "var(--green)" : r.net < 0 ? "var(--red)" : "var(--text-primary)" }}>
                        {r.net > 0 ? `+${r.net} YES` : r.net < 0 ? `${Math.abs(r.net)} NO` : "Flat"}
                      </span>
                    </td>
                    <td className="text-right px-3 py-3">
                      <span style={{ color: r.exposure > MAX_POSITION_PCT * 100 ? "var(--red)" : r.exposure > 15 ? "#f59e0b" : "var(--text-primary)" }}>
                        {r.exposure.toFixed(1)}%
                      </span>
                    </td>
                    <td className="text-right px-3 py-3">
                      <div style={{ color: r.equityUtil > 100 ? "var(--red)" : r.equityUtil > 80 ? "#f59e0b" : "var(--text-primary)" }}>
                        {r.equityUtil.toFixed(0)}%
                      </div>
                      {r.cashUtil > 100 && r.equityUtil <= 100 && (
                        <div className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
                          cash: {r.cashUtil.toFixed(0)}%
                        </div>
                      )}
                    </td>
                    <td className="text-right px-3 py-3">
                      ${toUsd(r.positionMtm)}
                    </td>
                    <td className="text-right px-3 py-3" style={{ color: pnlColor(r.realizedSpread) }}>
                      ${toUsd(r.realizedSpread)}
                    </td>
                    <td className="text-right px-3 py-3">
                      {r.pairsRedeemed.toLocaleString()}
                    </td>
                    <td className="text-right px-3 py-3" style={{ color: pnlColor(netFee) }}>
                      ${toUsd(netFee)}
                    </td>
                    <td className="text-right px-3 py-3">
                      {r.makerFills.toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "2px solid var(--border)" }}>
                <td className="px-4 py-3 font-bold">Total</td>
                <td className="text-right px-3 py-3">{"\u2014"}</td>
                <td className="text-right px-3 py-3">{"\u2014"}</td>
                <td className="text-right px-3 py-3">{"\u2014"}</td>
                <td className="text-right px-3 py-3">{"\u2014"}</td>
                <td className="text-right px-3 py-3 font-bold">${toUsd(totalPositionMtm)}</td>
                <td className="text-right px-3 py-3 font-bold" style={{ color: pnlColor(totalRealizedSpread) }}>
                  ${toUsd(totalRealizedSpread)}
                </td>
                <td className="text-right px-3 py-3 font-bold">
                  {totalPairs.toLocaleString()}
                </td>
                <td className="text-right px-3 py-3 font-bold" style={{ color: pnlColor(netFeeIncome) }}>
                  ${toUsd(netFeeIncome)}
                </td>
                <td className="text-right px-3 py-3 font-bold">
                  {totalMakerFills.toLocaleString()}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
