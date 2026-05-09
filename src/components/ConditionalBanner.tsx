"use client";

import Link from "next/link";
import { fonts, space, type, motion, type OracleTheme } from "@/lib/oracle-theme";
import { useParentMarket } from "@/hooks/useParentMarket";

/**
 * Contextual header rendered on a market detail page when the market is a
 * conditional child. Lives between the title block and the chart.
 *
 * Visual treatment is muted / editorial — accent border + dim background,
 * never alarm-red. We carry three tones:
 *   - Loading / Open parent  → neutral info (accent tint)
 *   - Parent resolved YES (matching) → green-tinted "live" confirmation
 *   - Parent resolved NO / Unknown   → amber "voided" callout
 *
 * Returns `null` if the market is not conditional, so callers can drop this
 * unconditionally above the chart without further branching.
 */
export function ConditionalBanner({
  parentMarketId,
  parentOutcome,
  th,
}: {
  parentMarketId: number | null;
  parentOutcome: string | null;
  th: OracleTheme;
}) {
  const { parent, state, voided } = useParentMarket(parentMarketId, parentOutcome);

  if (parentMarketId == null) return null;

  const outcomeLabel = parentOutcome ? parentOutcome.toUpperCase() : "the activating outcome";
  const oppositeLabel = parentOutcome
    ? parentOutcome.toLowerCase() === "yes"
      ? "NO"
      : "YES"
    : "the opposite outcome";

  // -- Tone selection -------------------------------------------------------
  // amber: warning treatment for void / mismatch
  // success: green tint for confirmed-live
  // neutral: muted accent for "still in flight" (loading / parent open)
  const tone: "neutral" | "success" | "amber" = (() => {
    if (state === "resolved-match") return "success";
    if (voided) return "amber";
    return "neutral";
  })();

  const palette = (() => {
    if (tone === "success") {
      return {
        border: th.isDark ? "rgba(34,197,94,0.32)" : "rgba(22,163,74,0.32)",
        bg: th.isDark ? "rgba(34,197,94,0.06)" : "rgba(22,163,74,0.05)",
        accent: th.yes,
      };
    }
    if (tone === "amber") {
      return {
        border: th.isDark ? "rgba(234,179,8,0.35)" : "rgba(180,83,9,0.30)",
        bg: th.isDark ? "rgba(234,179,8,0.06)" : "rgba(234,179,8,0.06)",
        accent: th.isDark ? "#EAB308" : "#B45309",
      };
    }
    return {
      border: th.isDark ? "rgba(224,136,90,0.30)" : "rgba(212,132,111,0.30)",
      bg: th.isDark ? "rgba(224,136,90,0.05)" : "rgba(212,132,111,0.05)",
      accent: th.accentFrom,
    };
  })();

  // -- Title + body --------------------------------------------------------
  const parentLabel =
    parent?.question ??
    (state === "missing"
      ? `market #${parentMarketId}`
      : `market #${parentMarketId}`);

  const title = (() => {
    if (state === "resolved-match") return "Parent resolved — this market is live";
    if (state === "resolved-mismatch") return "Parent resolved — this market has voided";
    if (state === "resolved-unknown") return "Parent unresolvable — this market has voided";
    return "Conditional market";
  })();

  const body = (() => {
    if (state === "resolved-match") {
      return (
        <>
          Parent resolved <strong style={{ fontWeight: 600 }}>{outcomeLabel}</strong>, the activating
          outcome. Trading and settlement continue normally.
        </>
      );
    }
    if (state === "resolved-mismatch") {
      return (
        <>
          Parent resolved <strong style={{ fontWeight: 600 }}>{oppositeLabel}</strong> instead of {outcomeLabel}.
          Every position has been settled at <strong style={{ fontWeight: 600 }}>50/500 ticks per share</strong>{" "}
          (50&cent;), regardless of cost basis.
        </>
      );
    }
    if (state === "resolved-unknown") {
      return (
        <>
          Parent resolved <strong style={{ fontWeight: 600 }}>Unknown</strong>. Every position has been
          settled at <strong style={{ fontWeight: 600 }}>50/500 ticks per share</strong> (50&cent;),
          regardless of cost basis.
        </>
      );
    }
    if (state === "missing") {
      return (
        <>
          This market only resolves if the parent market resolves to{" "}
          <strong style={{ fontWeight: 600 }}>{outcomeLabel}</strong>. If the parent resolves to
          {" "}{oppositeLabel} or Unknown, every position voids at 50&cent; per share, regardless of cost basis.
        </>
      );
    }
    return (
      <>
        This resolves only if{" "}
        <em style={{ fontStyle: "italic" }}>&ldquo;{parentLabel}&rdquo;</em> resolves{" "}
        <strong style={{ fontWeight: 600 }}>{outcomeLabel}</strong>. If the parent resolves{" "}
        {oppositeLabel} or Unknown, every position voids at <strong style={{ fontWeight: 600 }}>50&cent;
        per share</strong>, regardless of cost basis.
      </>
    );
  })();

  return (
    <div
      role="note"
      aria-label={title}
      style={{
        display: "flex",
        gap: space[3],
        padding: `${space[3]}px ${space[4]}px`,
        marginBottom: space[6],
        background: palette.bg,
        border: `0.8px solid ${palette.border}`,
        borderRadius: 4,
        alignItems: "flex-start",
        transition: motion.themeTransition,
      }}
    >
      {/* Glyph rail */}
      <span
        aria-hidden="true"
        style={{
          flexShrink: 0,
          marginTop: 1,
          width: 18,
          height: 18,
          borderRadius: "50%",
          border: `1px solid ${palette.accent}`,
          color: palette.accent,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: fonts.serif,
          fontSize: 12,
          fontWeight: 600,
          lineHeight: 1,
        }}
      >
        {tone === "success" ? "\u2713" : tone === "amber" ? "!" : "i"}
      </span>

      {/* Body */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            ...type.metaLabel,
            color: palette.accent,
            marginBottom: 4,
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontFamily: fonts.sans,
            fontSize: 13,
            lineHeight: 1.5,
            color: th.textSecondary,
          }}
        >
          {body}
        </div>
        {/* Link to parent market (always present, even on missing fallback) */}
        <div style={{ marginTop: 6 }}>
          <Link
            href={`/market/${parentMarketId}`}
            style={{
              ...type.tabLabel,
              color: palette.accent,
              textDecoration: "none",
              cursor: "pointer",
              transition: motion.hoverTransition,
            }}
          >
            View parent market &rarr;
          </Link>
        </div>
      </div>
    </div>
  );
}
