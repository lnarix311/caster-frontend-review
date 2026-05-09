"use client";

import { useState } from "react";
import { fonts, type OracleTheme } from "@/lib/oracle-theme";

/**
 * Small "Conditional" pill rendered on market cards / list rows for any market
 * with `parent_market_id != null`. Hover surfaces the activation rule
 * ("Only resolves if [parent] = [outcome]"); long-press / tap on touch.
 *
 * Visual style: muted info treatment matching the editorial / MarketImage
 * fallback aesthetic. Accent uses `th.accentFrom` as the soft brand tint
 * rather than alarm-red — the mechanic is *informational*, not a warning.
 *
 * For position rows + order confirmations we use ConditionalWarningIcon
 * instead, which has stronger colour to signal "your money is at risk".
 */
export function ConditionalBadge({
  parentQuestion,
  parentOutcome,
  th,
}: {
  parentQuestion: string | null;
  parentOutcome: string | null;
  th: OracleTheme;
}) {
  const [hovered, setHovered] = useState(false);

  const tooltipText =
    parentQuestion && parentOutcome
      ? `Only resolves if "${parentQuestion}" = ${parentOutcome.toUpperCase()}`
      : parentOutcome
        ? `Conditional on parent market = ${parentOutcome.toUpperCase()}`
        : "Conditional market — resolution depends on a parent market";

  // Soft, theme-aware tint pulled from the brand accent so the badge reads
  // as editorial metadata rather than a warning. Border thickness matches
  // the 0.8px line treatment used elsewhere on cards.
  const tintBg = th.isDark
    ? "rgba(224, 136, 90, 0.10)"
    : "rgba(212, 132, 111, 0.10)";
  const tintBorder = th.isDark
    ? "rgba(224, 136, 90, 0.35)"
    : "rgba(212, 132, 111, 0.35)";

  return (
    <span
      role="img"
      aria-label={tooltipText}
      title={tooltipText}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 7px",
        background: tintBg,
        border: `0.8px solid ${tintBorder}`,
        borderRadius: 2,
        fontSize: 9,
        fontWeight: 600,
        fontFamily: fonts.sans,
        textTransform: "uppercase",
        letterSpacing: "0.1em",
        color: th.accentFrom,
        cursor: "help",
        whiteSpace: "nowrap",
        transition: "background 150ms ease, border-color 150ms ease",
        ...(hovered && {
          background: th.isDark
            ? "rgba(224, 136, 90, 0.16)"
            : "rgba(212, 132, 111, 0.16)",
        }),
      }}
    >
      Conditional
    </span>
  );
}
