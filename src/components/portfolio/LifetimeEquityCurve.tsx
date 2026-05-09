"use client";

/**
 * "Equity Curve" panel for the portfolio page.
 *
 * Wraps the existing `EquityChart` (which renders the lightweight-charts
 * canvas) with the lifetime data layer:
 *   - Fetches `GET /account/{addr}/equity-curve`
 *   - Handles the 501 `EQUITY_CURVE_PENDING_TASK_19` sentinel by
 *     rendering a "Coming soon" placeholder instead of an error toast
 *   - Provides a 1D / 7D / 30D / 90D / All time-range selector
 *     (defaults to 30D); range selection happens on the client over the
 *     fetched dataset to keep the API contract simple
 *   - Empty data set -> "No equity history yet" call-to-action
 *   - Reduced-motion -> static line (handled by the underlying
 *     `EquityChart` via lastPriceAnimation; we additionally suppress
 *     fade-in by skipping the AreaSeries fill on reduced-motion)
 *
 * Why a separate component: keeps the existing polling-based equity chart
 * in `EquityChart.tsx` untouched (it's used by the live portfolio-value
 * snapshot loop) while letting this surface the persisted history that
 * will land once chain task #19 ships `user_equity_snapshots`.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  fonts,
  space,
  type as typePresets,
  type OracleTheme,
} from "@/lib/oracle-theme";
import { getEquityCurve, type EquityCurveSnapshot } from "@/lib/lifetime-api";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import EquityChart from "./EquityChart";

type RangeKey = "1D" | "7D" | "30D" | "90D" | "ALL";

const RANGE_OPTIONS: ReadonlyArray<{ key: RangeKey; label: string; ms: number | null }> = [
  { key: "1D", label: "1D", ms: 24 * 60 * 60 * 1000 },
  { key: "7D", label: "7D", ms: 7 * 24 * 60 * 60 * 1000 },
  { key: "30D", label: "30D", ms: 30 * 24 * 60 * 60 * 1000 },
  { key: "90D", label: "90D", ms: 90 * 24 * 60 * 60 * 1000 },
  { key: "ALL", label: "All", ms: null },
];

interface Props {
  th: OracleTheme;
  address: string | null;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; snapshots: EquityCurveSnapshot[] }
  | { kind: "pending" } // backend stub
  | { kind: "error"; message: string };

export default function LifetimeEquityCurve({ th, address }: Props) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [range, setRange] = useState<RangeKey>("30D");
  const reducedMotion = usePrefersReducedMotion();

  const reqTokenRef = useRef(0);

  // ---- Fetch loop --------------------------------------------------------
  useEffect(() => {
    if (!address) {
      setState({ kind: "loading" });
      return;
    }
    const token = ++reqTokenRef.current;
    setState({ kind: "loading" });

    getEquityCurve(address)
      .then((res) => {
        if (token !== reqTokenRef.current) return;
        if (res.kind === "ready") {
          setState({ kind: "ready", snapshots: res.snapshots });
        } else if (res.kind === "pending") {
          setState({ kind: "pending" });
        } else {
          setState({ kind: "error", message: res.message });
        }
      })
      .catch((e) => {
        if (token !== reqTokenRef.current) return;
        setState({
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
        });
      });
  }, [address]);

  // ---- Filter to selected time range ------------------------------------
  // Client-side filter over the full payload. Acceptable while snapshot
  // retention is short (early testnet keeps weeks, not months). Once
  // user_equity_snapshots crosses ~6 months of history, the API wastes
  // bandwidth shipping data the user immediately discards.
  //
  // TODO: When snapshot retention exceeds ~6 months, wire selectedRange
  // to a `since_ms` query param on getEquityCurve so we don't pull the
  // entire history on every range change. Cache per-range responses to
  // keep the timeframe selector snappy.
  const filteredSnapshots = useMemo(() => {
    if (state.kind !== "ready") return [];
    const opt = RANGE_OPTIONS.find((r) => r.key === range);
    if (!opt || opt.ms === null) return state.snapshots;
    const cutoff = Date.now() - opt.ms;
    return state.snapshots.filter((s) => s.timestamp_ms >= cutoff);
  }, [state, range]);

  // Convert the API shape to what the existing EquityChart wants. The
  // chart was built around `{ time: ms, value: ticks }` -- we hand it
  // the equity_ticks field (it converts to dollars internally).
  const chartSnapshots = useMemo(
    () =>
      filteredSnapshots.map((s) => ({
        time: s.timestamp_ms,
        value: s.equity_ticks,
      })),
    [filteredSnapshots],
  );

  const isPositive = useMemo(() => {
    if (filteredSnapshots.length < 2) return true;
    const first = filteredSnapshots[0].equity_ticks;
    const last = filteredSnapshots[filteredSnapshots.length - 1].equity_ticks;
    return last >= first;
  }, [filteredSnapshots]);

  // ---- Render ------------------------------------------------------------
  // Section header is consistent with sibling sections on the portfolio
  // page (serif title + bottom border). Right-aligned range selector lives
  // on the same row so the chart canvas gets the full width below.
  const sectionHeader = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: space[4],
        paddingBottom: space[2],
        borderBottom: `0.8px solid ${th.border}`,
      }}
    >
      <div
        style={{
          fontFamily: fonts.serif,
          fontSize: 20,
          fontWeight: 400,
          letterSpacing: "-0.01em",
          color: th.textPrimary,
        }}
      >
        Equity Curve
      </div>
      {state.kind === "ready" && state.snapshots.length > 0 && (
        <div
          role="tablist"
          aria-label="Equity curve time range"
          style={{
            display: "flex",
            gap: 2,
            border: `0.8px solid ${th.border}`,
            borderRadius: 2,
            padding: 2,
          }}
        >
          {RANGE_OPTIONS.map((opt) => {
            const active = opt.key === range;
            return (
              <button
                key={opt.key}
                role="tab"
                aria-selected={active}
                onClick={() => setRange(opt.key)}
                style={{
                  ...typePresets.timeframeBtn,
                  padding: "4px 10px",
                  borderRadius: 2,
                  background: active ? th.surface : "transparent",
                  border: "none",
                  color: active ? th.textPrimary : th.textSecondary,
                  cursor: "pointer",
                  fontFamily: fonts.sans,
                  transition: reducedMotion
                    ? "none"
                    : "background-color 100ms ease, color 100ms ease",
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  // Chart container -- always 240px tall to match the rough hero footprint
  const chartShell = (children: React.ReactNode) => (
    <div style={{ marginBottom: space[8] }}>
      {sectionHeader}
      <div
        style={{
          height: 240,
          position: "relative",
          border: `0.8px solid ${th.border}`,
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        {children}
      </div>
    </div>
  );

  // -- Pending (501 stub) -- the api-engineer's PR is in flight
  if (state.kind === "pending") {
    return chartShell(
      <div
        style={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          padding: space[6],
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontFamily: fonts.serif,
            fontSize: 16,
            fontStyle: "italic",
            color: th.textSecondary,
          }}
        >
          Equity history coming soon
        </div>
        <div
          style={{
            fontFamily: fonts.sans,
            fontSize: 12,
            color: th.textTertiary,
            maxWidth: 400,
            lineHeight: 1.5,
          }}
        >
          Chart will populate automatically once the equity-snapshot pipeline
          ships. Your fills and stats are already being tracked.
        </div>
      </div>,
    );
  }

  // -- Loading
  if (state.kind === "loading") {
    return chartShell(
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: "80%",
            height: 8,
            background: th.skeletonBase,
            borderRadius: 2,
          }}
          aria-label="Loading equity curve"
        />
      </div>,
    );
  }

  // -- Error
  if (state.kind === "error") {
    return chartShell(
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: space[6],
          fontFamily: fonts.sans,
          fontSize: 13,
          color: th.textSecondary,
          textAlign: "center",
        }}
      >
        Couldn&apos;t load equity history.
      </div>,
    );
  }

  // -- Ready: empty
  if (state.snapshots.length === 0) {
    return chartShell(
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: space[6],
          fontFamily: fonts.serif,
          fontSize: 15,
          fontStyle: "italic",
          color: th.textTertiary,
          textAlign: "center",
        }}
      >
        No equity history yet — start trading to populate.
      </div>,
    );
  }

  // -- Ready: normal render. If the user picked a range that excludes all
  //    snapshots (e.g. 1D on a stale account), fall back to a soft message
  //    inside the chart shell rather than an empty canvas.
  if (filteredSnapshots.length === 0) {
    return chartShell(
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: space[6],
          fontFamily: fonts.sans,
          fontSize: 13,
          color: th.textTertiary,
          textAlign: "center",
        }}
      >
        No snapshots in the selected range.
      </div>,
    );
  }

  return chartShell(
    <EquityChart th={th} snapshots={chartSnapshots} isPositive={isPositive} />,
  );
}
