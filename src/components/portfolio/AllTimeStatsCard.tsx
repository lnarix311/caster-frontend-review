"use client";

/**
 * "All-Time Stats" card for the portfolio page.
 *
 * Renders the response from `GET /account/{addr}/lifetime`. Layout is a
 * 4-column grid on desktop (Volume / P&L / Activity / Bridge) collapsing
 * to 2 columns on tablet and 1 column on mobile.
 *
 * Color contract:
 *   - P&L green when positive, red when negative, tertiary grey for zero
 *   - Total volume rendered larger than the secondary stats so the number
 *     reads as the "headline" of the card
 *   - Subdued first-trade / last-trade meta in tertiary text
 *
 * Loading state: shimmer skeleton bars matching final layout (no flash of
 * empty content). Error state: tertiary "couldn't load" line with a retry
 * affordance so the rest of the portfolio page keeps working.
 */

import type { LifetimeStats } from "@/lib/lifetime-api";
import {
  fonts,
  space,
  type as typePresets,
  type OracleTheme,
} from "@/lib/oracle-theme";
import {
  formatCompactUsd,
  formatPnlUsd,
  formatWinRate,
  formatCount,
  formatRelativeAge,
} from "@/lib/lifetime-format";

interface Props {
  th: OracleTheme;
  stats: LifetimeStats | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

/** Single key/value cell within the stat grid. */
function StatCell({
  th,
  label,
  value,
  valueColor,
  isHeadline = false,
  hint,
}: {
  th: OracleTheme;
  label: string;
  value: string;
  valueColor?: string;
  isHeadline?: boolean;
  hint?: string;
}) {
  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          ...typePresets.metaLabel,
          color: th.textTertiary,
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: fonts.mono,
          fontSize: isHeadline ? 24 : 17,
          fontWeight: 400,
          letterSpacing: "-0.01em",
          lineHeight: 1.1,
          color: valueColor ?? th.textPrimary,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
      {hint && (
        <div
          style={{
            fontFamily: fonts.sans,
            fontSize: 11,
            color: th.textTertiary,
            marginTop: 4,
            lineHeight: 1.3,
          }}
        >
          {hint}
        </div>
      )}
    </div>
  );
}

/** Skeleton bar -- pulses only when reduced-motion is off (handled via
 * a CSS animation; the static fallback already exists at fixed opacity). */
function SkeletonBar({ th, width, height = 18 }: { th: OracleTheme; width: number | string; height?: number }) {
  return (
    <div
      style={{
        width: typeof width === "number" ? `${width}px` : width,
        height,
        background: th.skeletonBase,
        borderRadius: 2,
      }}
      aria-hidden="true"
    />
  );
}

export default function AllTimeStatsCard({ th, stats, loading, error, onRetry }: Props) {
  // --- Header -------------------------------------------------------------
  const headerRow = (
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
      }}
    >
      All-Time Stats
    </div>
  );

  // --- Error state -------------------------------------------------------
  if (error && !stats) {
    return (
      <div style={{ marginBottom: space[8] }}>
        {headerRow}
        <div
          style={{
            padding: `${space[6]}px ${space[3]}px`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: space[3],
            color: th.textSecondary,
            fontFamily: fonts.sans,
            fontSize: 13,
          }}
        >
          <span>Couldn&apos;t load lifetime stats.</span>
          <button
            onClick={onRetry}
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
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // --- Loading skeleton --------------------------------------------------
  if (loading && !stats) {
    return (
      <div style={{ marginBottom: space[8] }}>
        {headerRow}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
            gap: space[6],
            padding: `${space[3]}px 0`,
          }}
        >
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i}>
              <SkeletonBar th={th} width={80} height={10} />
              <div style={{ marginTop: 8 }}>
                <SkeletonBar th={th} width={120} height={20} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // --- Empty state for never-traded address ------------------------------
  if (!stats || stats.fills_count === 0) {
    return (
      <div style={{ marginBottom: space[8] }}>
        {headerRow}
        <div
          style={{
            padding: `${space[8]}px 0`,
            textAlign: "center",
            fontFamily: fonts.serif,
            fontSize: 16,
            fontStyle: "italic",
            color: th.textTertiary,
          }}
        >
          No lifetime activity yet — your stats will appear after your first fill.
        </div>
      </div>
    );
  }

  // --- Populated render --------------------------------------------------
  const realizedPnl = stats.realized_pnl_usd;
  const pnlColor =
    realizedPnl > 0 ? th.yes : realizedPnl < 0 ? th.no : th.textTertiary;

  // Net deposits = deposits - withdrawals. A positive number means the user
  // has put in more than they've taken out -- useful for sanity-checking
  // P&L against on-chain balance flows.
  const netDeposits =
    stats.cumulative_deposits_usd - stats.cumulative_withdrawals_usd;

  // Net fees = fees paid - rebates earned. CLP makers can flip negative.
  const netFees = stats.total_fees_paid_usd - stats.total_rebates_received_usd;

  const winsLossesLabel =
    stats.resolution_wins + stats.resolution_losses === 0
      ? "—"
      : `${formatCount(stats.resolution_wins)}/${formatCount(stats.resolution_losses)}`;

  const winRateLabel =
    stats.resolution_wins + stats.resolution_losses === 0
      ? "—"
      : formatWinRate(stats.derived_win_rate);

  const firstTradeLabel = stats.first_trade_at_ms
    ? formatRelativeAge(stats.first_trade_at_ms)
    : "—";
  const lastTradeLabel = stats.last_trade_at_ms
    ? formatRelativeAge(stats.last_trade_at_ms)
    : "—";

  return (
    <div style={{ marginBottom: space[8] }}>
      {headerRow}
      {/* Responsive grid: 4 cols desktop, 2 cols tablet, 1 col mobile.
          We use CSS grid via inline style + a media query in a <style> tag
          so the layout responds without pulling in a styled-components
          dependency. */}
      <style jsx>{`
        .lifetime-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: ${space[6]}px ${space[6]}px;
          padding: ${space[3]}px 0;
        }
        @media (max-width: 900px) {
          .lifetime-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
        @media (max-width: 480px) {
          .lifetime-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
      <div className="lifetime-grid">
        {/* Column 1: Volume + Fills */}
        <StatCell
          th={th}
          label="Volume Traded"
          value={formatCompactUsd(stats.total_volume_traded_usd)}
          isHeadline
        />
        <StatCell
          th={th}
          label="Fills"
          value={formatCount(stats.fills_count)}
          isHeadline
          hint={`${formatCount(stats.markets_traded_count)} market${stats.markets_traded_count === 1 ? "" : "s"}`}
        />

        {/* Column 2: P&L + Fees */}
        <StatCell
          th={th}
          label="Realized P&L"
          value={formatPnlUsd(realizedPnl)}
          valueColor={pnlColor}
          isHeadline
        />
        <StatCell
          th={th}
          label="Net Fees"
          value={
            netFees === 0
              ? formatCompactUsd(0) // unsigned $0.00 -- avoids the misleading "-$0.00"
              : netFees > 0
              ? `-${formatCompactUsd(netFees)}` // user paid net fees
              : `+${formatCompactUsd(-netFees)}` // user earned net rebates
          }
          valueColor={netFees > 0 ? th.no : netFees < 0 ? th.yes : th.textTertiary}
          hint={
            stats.total_rebates_received_usd > 0
              ? `Paid ${formatCompactUsd(stats.total_fees_paid_usd)} · Earned ${formatCompactUsd(stats.total_rebates_received_usd)}`
              : undefined
          }
        />

        {/* Column 3: Wins / Win rate */}
        <StatCell
          th={th}
          label="Wins / Losses"
          value={winsLossesLabel}
        />
        <StatCell
          th={th}
          label="Win Rate"
          value={winRateLabel}
          valueColor={
            stats.derived_win_rate > 0.5
              ? th.yes
              : stats.derived_win_rate < 0.5 && stats.resolution_wins + stats.resolution_losses > 0
              ? th.no
              : undefined
          }
        />

        {/* Column 4: Net deposits + first/last trade */}
        <StatCell
          th={th}
          label="Net Deposits"
          value={
            netDeposits >= 0
              ? formatCompactUsd(netDeposits)
              : `-${formatCompactUsd(-netDeposits)}`
          }
          hint={`Deposits ${formatCompactUsd(stats.cumulative_deposits_usd)} · Withdrawn ${formatCompactUsd(stats.cumulative_withdrawals_usd)}`}
        />
        <StatCell
          th={th}
          label="Activity"
          value={lastTradeLabel}
          hint={
            stats.first_trade_at_ms && stats.first_trade_at_ms !== stats.last_trade_at_ms
              ? `First trade ${firstTradeLabel}`
              : undefined
          }
        />
      </div>
    </div>
  );
}
