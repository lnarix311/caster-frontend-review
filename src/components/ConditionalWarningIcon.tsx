"use client";

import { fonts, type OracleTheme } from "@/lib/oracle-theme";

/**
 * Small triangular warning glyph rendered next to position rows for any
 * market that's a child of another market. Tooltip explains the 50/50 void.
 *
 * Visual treatment is more pointed than ConditionalBadge — money is at risk
 * here, so we use a softer amber tone (not alarm-red) drawn from the
 * existing accent palette. Matches the muted aesthetic of MarketImage
 * fallback and ClosePositionModal warning treatment.
 */
export function ConditionalWarningIcon({
  parentQuestion,
  parentOutcome,
  th,
  size = 12,
}: {
  parentQuestion: string | null;
  parentOutcome: string | null;
  th: OracleTheme;
  size?: number;
}) {
  const outcomeLabel = parentOutcome ? parentOutcome.toUpperCase() : "the activating outcome";
  const tooltip = parentQuestion
    ? `Voids at 50/50 if "${parentQuestion}" does not resolve ${outcomeLabel}`
    : `Voids at 50/50 if parent market does not resolve ${outcomeLabel}`;

  // Amber: intentionally softer than `th.no`. Shipping alarm-red here would
  // train users to ignore it — this is informational caution, not danger.
  const amber = th.isDark ? "#EAB308" : "#B45309";

  return (
    <span
      role="img"
      aria-label={tooltip}
      title={tooltip}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size + 4,
        height: size + 4,
        marginLeft: 4,
        verticalAlign: "middle",
        cursor: "help",
        fontFamily: fonts.sans,
        fontSize: size,
        lineHeight: 1,
        color: amber,
        flexShrink: 0,
      }}
    >
      {/* Unicode warning sign (no emoji presentation forced) */}
      &#9888;
    </span>
  );
}
