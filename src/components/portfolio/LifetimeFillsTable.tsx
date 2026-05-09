"use client";

/**
 * "Lifetime Fills" -- paginated, infinite-scroll table over the new
 * `/account/{addr}/fills` endpoint.
 *
 * Behaviour contract:
 *   - First page loads automatically when an address is connected
 *   - IntersectionObserver on a sentinel row triggers `loadMore()` when
 *     the user scrolls within ~600px of the bottom; the hook itself
 *     enforces idempotency (no double-fetch while one is in flight)
 *   - "End of history" marker rendered when `next_cursor` is null
 *   - Skeleton rows fill the table on first load so the column widths
 *     stabilise before real data lands
 *   - Mobile (< 640px viewport): falls back to a stacked card layout
 *     where each fill is a self-contained card with the same data.
 *
 * Performance: every fill row is keyed by the trade's unique
 * `(block_height, taker_order_id, maker_order_id)` triple. We render
 * raw rows -- no virtualization yet because the typical user has < 1000
 * fills and 1000 rows is well within React's comfort zone. Once an
 * account approaches 10k fills we should swap in `react-window` or
 * similar; the hook is already structured to avoid array re-allocs.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  fonts,
  space,
  type as typePresets,
  type OracleTheme,
} from "@/lib/oracle-theme";
import {
  formatCompactUsd,
  formatFillTime,
  formatAbsoluteShort,
} from "@/lib/lifetime-format";
import type { LifetimeFill } from "@/lib/lifetime-api";

interface Props {
  th: OracleTheme;
  isDark: boolean;
  fills: LifetimeFill[];
  loading: boolean;
  hasMore: boolean;
  error: string | null;
  marketQuestions: Map<number, string>;
  loadMore: () => void;
}

// Grid: Time | Market | Side | Price | Qty | Notional | Role | Fee
const FILLS_GRID = "100px minmax(0, 1.6fr) 60px 70px 60px 90px 64px 80px";

/** Map taker_side + your_role to the directional label the user sees.
 *
 *   - Caster orderbook only ever trades YES shares
 *   - "buyer" = the user received YES shares  -> they BOUGHT YES
 *   - "seller" = the user gave up YES shares  -> they SOLD YES
 *   - "self"   = both sides of the trade are this user -> render as SELF
 *               (no directional meaning; net position delta is zero)
 *
 * The visible "side" column shows BUY / SELL of YES (matching how the
 * existing trade-history table phrases it). The taker_side comes from
 * the protocol -- we surface it only via the role column for power
 * users (taker pays fee, maker earns rebate). */
function deriveDirection(fill: LifetimeFill): "BUY" | "SELL" | "SELF" {
  if (fill.your_role === "self") return "SELF";
  return fill.your_role === "seller" ? "SELL" : "BUY";
}

/** "Taker" / "Maker" label for the Role column. The role string the API
 * gives us is buyer/seller (which side of the trade the user is on); we
 * cross-reference with `taker_side` to figure out whether the user was
 * the aggressor (taker) or the resting order (maker). */
function deriveTakerOrMaker(fill: LifetimeFill): "TAKER" | "MAKER" | "SELF" {
  if (fill.your_role === "self") return "SELF";
  // After the SELF guard above, your_role is strictly "buyer" or "seller".
  // The two explicit TAKER conditions cover the only ways the user can be
  // the aggressor; the implicit fallthrough to MAKER is the safe inverse
  // -- it cannot misclassify a self-cross because those exited at the
  // top of the function.
  if (fill.taker_side === "Buy" && fill.your_role === "buyer") return "TAKER";
  if (fill.taker_side === "Sell" && fill.your_role === "seller") return "TAKER";
  return "MAKER";
}

export default function LifetimeFillsTable({
  th,
  isDark,
  fills,
  loading,
  hasMore,
  error,
  marketQuestions,
  loadMore,
}: Props) {
  // -------------------------------------------------------------------
  // Infinite scroll: observe a sentinel right above the "loading more"
  // line. When it scrolls into view, ask the hook for another page.
  //
  // We use a callback ref + tracked node state instead of a plain
  // useRef + mount-only useEffect so this stays correct even if the
  // sentinel ever lives behind a conditional render. The callback ref
  // also gives us a clean attach/detach lifecycle without leaking
  // observers on remount.
  // -------------------------------------------------------------------
  const [sentinelNode, setSentinelNode] = useState<HTMLDivElement | null>(
    null,
  );
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;
  const hasMoreRef = useRef(hasMore);
  hasMoreRef.current = hasMore;
  const loadingRef = useRef(loading);
  loadingRef.current = loading;

  const sentinelCallback = useCallback((node: HTMLDivElement | null) => {
    setSentinelNode(node);
  }, []);

  useEffect(() => {
    if (!sentinelNode) return;
    if (typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (
            entry.isIntersecting &&
            hasMoreRef.current &&
            !loadingRef.current
          ) {
            loadMoreRef.current();
          }
        }
      },
      { rootMargin: "0px 0px 600px 0px", threshold: 0 },
    );
    observer.observe(sentinelNode);
    return () => observer.disconnect();
  }, [sentinelNode]);

  // Trigger an initial-load top-up if the entire result fits within the
  // viewport and the sentinel never enters/leaves -- otherwise the user
  // sees "5 fills" with no way to load more. (Current pageSize=50 means
  // this rarely fires, but it future-proofs against tiny page sizes.)
  useEffect(() => {
    if (!hasMore) return;
    if (loading) return;
    if (fills.length === 0) return;
    if (!sentinelNode) return;
    const rect = sentinelNode.getBoundingClientRect();
    if (rect.top < window.innerHeight + 600) {
      loadMore();
    }
    // We *do* depend on `loadMore` here, but the hook returns a stable
    // identity (useCallback) so this won't loop.
  }, [fills.length, hasMore, loading, loadMore, sentinelNode]);

  // -------------------------------------------------------------------
  // Header (desktop column row) -- styling lives in <style jsx> below
  // because the same grid template is shared with each <tr>. The
  // typePresets.columnHeader contributes typography only.
  // -------------------------------------------------------------------
  const headerCellStyle: React.CSSProperties = {
    ...typePresets.columnHeader,
    color: th.textTertiary,
    textAlign: "left",
    padding: 0,
  };

  // Memoise rendered rows so re-renders triggered by hover effects on a
  // sibling row don't re-walk the whole list. Each row is independent.
  const rows = useMemo(
    () =>
      fills.map((f) => {
        const direction = deriveDirection(f);
        const role = deriveTakerOrMaker(f);
        const isMaker = role === "MAKER";
        const feeUsd = isMaker
          ? -f.maker_rebate_usd // rebate -> show as negative cost (i.e. income)
          : f.taker_fee_usd;
        const marketQ =
          marketQuestions.get(f.market_id) ?? `Market #${f.market_id}`;
        const key = `${f.block_height}-${f.taker_order_id}-${f.maker_order_id}`;
        return { f, direction, role, isMaker, feeUsd, marketQ, key };
      }),
    [fills, marketQuestions],
  );

  // Empty + loading states for the very first page
  const isFirstLoad = loading && fills.length === 0;
  const isEmpty = !loading && fills.length === 0 && !error;

  return (
    <div style={{ marginBottom: space[10] }}>
      {/* Section title */}
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
          alignItems: "baseline",
          justifyContent: "space-between",
        }}
      >
        <span>Lifetime Fills</span>
        <span
          style={{
            ...typePresets.metaLabel,
            color: th.textTertiary,
          }}
        >
          {fills.length === 0
            ? ""
            : hasMore
            ? `${fills.length} loaded`
            : `${fills.length} total`}
        </span>
      </div>

      {/* Table styling -- semantic <table>/<thead>/<tbody>/<tr>/<th>/<td>
          on desktop with grid-style columns, collapsing to a stacked
          card layout on mobile via display:block overrides. The shared
          grid template lives in CSS so the header and rows align even
          when content widths fluctuate (long market questions etc). */}
      <style jsx>{`
        .fills-table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
          font-family: ${fonts.mono};
          font-size: 13px;
          line-height: 1.6;
        }
        .fills-table thead {
          border-bottom: 0.8px solid ${th.border};
        }
        .fills-table thead tr {
          display: grid;
          grid-template-columns: ${FILLS_GRID};
          padding: ${space[2]}px ${space[3]}px;
        }
        .fills-table thead th {
          font-weight: inherit;
        }
        .fills-table tbody tr {
          display: grid;
          grid-template-columns: ${FILLS_GRID};
          align-items: center;
          padding: ${space[2]}px ${space[3]}px;
          border-bottom: 0.8px solid
            ${isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.06)"};
          transition: background-color 100ms ease;
        }
        .fills-table tbody tr.fills-data-row:hover {
          background: ${isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)"};
        }
        .fills-table td {
          padding: 0;
          min-width: 0;
        }
        @media (max-width: 640px) {
          .fills-table thead {
            display: none;
          }
          .fills-table,
          .fills-table tbody,
          .fills-table tbody tr,
          .fills-table td {
            display: block;
            width: 100%;
          }
          .fills-table tbody tr {
            padding: ${space[3]}px;
          }
          .fills-cell-inner {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 8px;
            text-align: left !important;
            padding: 3px 0;
          }
          .fills-cell-label {
            font-family: ${fonts.sans};
            font-size: 10px;
            font-weight: 500;
            text-transform: uppercase;
            letter-spacing: 0.1em;
            color: ${th.textTertiary};
          }
        }
        @media (min-width: 641px) {
          /* Desktop hides the per-cell mobile labels. */
          .fills-cell-label {
            display: none;
          }
          .fills-cell-inner {
            display: block;
          }
        }
      `}</style>

      <table className="fills-table" role="table" aria-label="Lifetime fills">
        <thead>
          <tr role="row">
            <th scope="col" style={headerCellStyle}>Time</th>
            <th scope="col" style={headerCellStyle}>Market</th>
            <th scope="col" style={headerCellStyle}>Side</th>
            <th scope="col" style={{ ...headerCellStyle, textAlign: "right" }}>Price</th>
            <th scope="col" style={{ ...headerCellStyle, textAlign: "right" }}>Qty</th>
            <th scope="col" style={{ ...headerCellStyle, textAlign: "right" }}>Notional</th>
            <th scope="col" style={{ ...headerCellStyle, textAlign: "center" }}>Role</th>
            <th scope="col" style={{ ...headerCellStyle, textAlign: "right" }}>Fee</th>
          </tr>
        </thead>
        <tbody>
          {/* Error banner -- non-blocking; existing fills stay rendered. We
              span the row using a single <td colSpan={8}> so the table
              structure stays valid for screen readers. */}
          {error && (
            <tr role="row" className="fills-error-row">
              <td
                colSpan={8}
                style={{
                  padding: `${space[2]}px ${space[3]}px`,
                  fontSize: 12,
                  color: th.no,
                  background: isDark
                    ? "rgba(239,68,68,0.08)"
                    : "rgba(239,68,68,0.06)",
                  borderBottom: `0.8px solid ${
                    isDark ? "rgba(239,68,68,0.15)" : "rgba(239,68,68,0.12)"
                  }`,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontFamily: fonts.sans,
                }}
              >
                <span>Couldn&apos;t load more fills: {error}</span>
                <button
                  onClick={loadMore}
                  style={{
                    ...typePresets.metaLabel,
                    padding: "4px 10px",
                    borderRadius: 2,
                    background: "transparent",
                    border: `0.8px solid ${th.border}`,
                    color: th.textSecondary,
                    cursor: "pointer",
                  }}
                >
                  Retry
                </button>
              </td>
            </tr>
          )}

          {/* Skeleton placeholder rows for first load */}
          {isFirstLoad &&
            Array.from({ length: 6 }).map((_, i) => (
              <tr
                key={`sk-${i}`}
                role="row"
                aria-hidden="true"
                className="fills-skeleton-row"
                style={{ pointerEvents: "none" }}
              >
                {Array.from({ length: 8 }).map((__, j) => (
                  <td key={j}>
                    <div
                      style={{
                        height: 14,
                        background: th.skeletonBase,
                        borderRadius: 2,
                        width: "70%",
                        margin: j === 0 ? 0 : "0 auto",
                      }}
                    />
                  </td>
                ))}
              </tr>
            ))}

          {/* Empty state -- never traded. Single full-width cell. */}
          {isEmpty && (
            <tr role="row" className="fills-empty-row">
              <td
                colSpan={8}
                style={{
                  textAlign: "center",
                  padding: `${space[10]}px 0`,
                  fontFamily: fonts.serif,
                  fontSize: 16,
                  fontStyle: "italic",
                  color: th.textTertiary,
                }}
              >
                No fills yet — your trade history will appear here.
              </td>
            </tr>
          )}

          {/* Real data rows */}
          {rows.map(({ f, direction, role, isMaker, feeUsd, marketQ, key }) => (
            <tr key={key} role="row" className="fills-data-row">
              {/* Time */}
              <td title={formatAbsoluteShort(f.timestamp_ms)}>
                <div
                  className="fills-cell-inner"
                  style={{ color: th.textSecondary, fontFamily: fonts.sans, fontSize: 12 }}
                >
                  <span className="fills-cell-label">Time</span>
                  <span>{formatFillTime(f.timestamp_ms)}</span>
                </div>
              </td>

              {/* Market */}
              <td>
                <div
                  className="fills-cell-inner"
                  style={{
                    fontFamily: fonts.sans,
                    fontSize: 13,
                    minWidth: 0,
                    overflow: "hidden",
                  }}
                >
                  <span className="fills-cell-label">Market</span>
                  <Link
                    href={`/market/${f.market_id}`}
                    style={{
                      color: "inherit",
                      textDecoration: "none",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      minWidth: 0,
                      display: "block",
                    }}
                  >
                    {marketQ}
                  </Link>
                </div>
              </td>

              {/* Side -- SELF (self-cross) renders as a neutral chip with no
                  directional color or "YES" suffix because the net position
                  delta is zero. */}
              <td>
                <div className="fills-cell-inner">
                  <span className="fills-cell-label">Side</span>
                  <span
                    style={{
                      display: "inline-block",
                      padding: "1px 6px",
                      borderRadius: 2,
                      fontSize: 10,
                      fontWeight: 600,
                      fontFamily: fonts.sans,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      background:
                        direction === "SELF"
                          ? isDark
                            ? "rgba(255,255,255,0.05)"
                            : "rgba(0,0,0,0.04)"
                          : direction === "BUY"
                          ? isDark
                            ? "rgba(34,197,94,0.12)"
                            : "rgba(34,197,94,0.1)"
                          : isDark
                          ? "rgba(239,68,68,0.12)"
                          : "rgba(239,68,68,0.1)",
                      color:
                        direction === "SELF"
                          ? th.textSecondary
                          : direction === "BUY"
                          ? th.yes
                          : th.no,
                    }}
                    title={
                      direction === "SELF"
                        ? "Self-cross (you on both sides) -- no net position change"
                        : undefined
                    }
                  >
                    {direction === "SELF" ? "SELF" : `${direction} YES`}
                  </span>
                </div>
              </td>

              {/* Price */}
              <td>
                <div className="fills-cell-inner" style={{ textAlign: "right" }}>
                  <span className="fills-cell-label">Price</span>
                  <span>${(f.price / 1000).toFixed(3)}</span>
                </div>
              </td>

              {/* Qty */}
              <td>
                <div className="fills-cell-inner" style={{ textAlign: "right" }}>
                  <span className="fills-cell-label">Qty</span>
                  <span>{f.quantity.toLocaleString("en-US")}</span>
                </div>
              </td>

              {/* Notional */}
              <td>
                <div className="fills-cell-inner" style={{ textAlign: "right" }}>
                  <span className="fills-cell-label">Notional</span>
                  <span>{formatCompactUsd(f.notional_usd)}</span>
                </div>
              </td>

              {/* Role */}
              <td>
                <div className="fills-cell-inner" style={{ textAlign: "center" }}>
                  <span className="fills-cell-label">Role</span>
                  <span
                    style={{
                      display: "inline-block",
                      padding: "1px 6px",
                      borderRadius: 2,
                      fontSize: 9,
                      fontWeight: 600,
                      fontFamily: fonts.sans,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      background: isMaker
                        ? isDark
                          ? "rgba(56,189,248,0.12)"
                          : "rgba(14,165,233,0.1)"
                        : isDark
                        ? "rgba(255,255,255,0.05)"
                        : "rgba(0,0,0,0.04)",
                      color: isMaker
                        ? isDark
                          ? "#7DD3FC"
                          : "#0369A1"
                        : th.textSecondary,
                    }}
                    title={
                      role === "SELF"
                        ? "Both sides of this trade are you (self-cross)"
                        : role === "MAKER"
                        ? "You provided liquidity (resting order, earned rebate)"
                        : "You crossed the spread (paid taker fee)"
                    }
                  >
                    {role}
                  </span>
                </div>
              </td>

              {/* Fee / rebate */}
              <td>
                <div
                  className="fills-cell-inner"
                  style={{
                    textAlign: "right",
                    color: feeUsd < 0 ? th.yes : th.textSecondary,
                    opacity: feeUsd === 0 ? 0.5 : 0.85,
                  }}
                >
                  <span className="fills-cell-label">Fee</span>
                  <span>
                    {feeUsd === 0
                      ? "$0.00"
                      : feeUsd < 0
                      ? `+${formatCompactUsd(-feeUsd)}`
                      : `-${formatCompactUsd(feeUsd)}`}
                  </span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Sentinel + loading-more / end-of-history footer. The sentinel
          intentionally lives outside the <table> -- IntersectionObserver
          targets a non-tabular element so we can keep the table semantics
          clean. */}
      <div ref={sentinelCallback} aria-hidden="true" style={{ height: 1 }} />
      {loading && fills.length > 0 && (
        <div
          style={{
            padding: `${space[3]}px 0`,
            textAlign: "center",
            fontFamily: fonts.sans,
            fontSize: 12,
            color: th.textTertiary,
          }}
          role="status"
          aria-live="polite"
        >
          Loading more fills...
        </div>
      )}
      {!loading && !hasMore && fills.length > 0 && (
        <div
          style={{
            padding: `${space[4]}px 0`,
            textAlign: "center",
            fontFamily: fonts.serif,
            fontSize: 13,
            fontStyle: "italic",
            color: th.textTertiary,
            borderTop: `0.8px solid ${
              isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.06)"
            }`,
          }}
        >
          End of history
        </div>
      )}
    </div>
  );
}

