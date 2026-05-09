"use client";

import type { CSSProperties } from "react";
import { fonts, type OracleTheme, type } from "@/lib/oracle-theme";
import { useResolvesIn, type Urgency } from "@/hooks/useResolvesIn";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

/* ------------------------------------------------------------------ *
 * ResolvesInChip
 *
 * Small "Resolves in 6d 14h" label shared between:
 *   - home page MarketCard meta row   (`variant="card"`)
 *   - market page header meta row     (`variant="header"`)
 *
 * When the backend hasn't provided a `resolves_at` timestamp the component
 * renders nothing, so callers can drop it into a meta row unconditionally.
 * ------------------------------------------------------------------ */

interface Props {
  resolvesAt: number | null | undefined;
  isResolved?: boolean;
  th: OracleTheme;
  /** Visual variant. "card" is the compact chip on the home list; "header"
   * matches the volume/meta-label styling on the market page header. */
  variant?: "card" | "header";
  /** Extra styles applied to the root span (e.g. margin tweaks). */
  style?: CSSProperties;
}

function urgencyColor(u: Urgency, th: OracleTheme): string {
  switch (u) {
    case "critical":
      return th.no;
    // Warm amber reads as "warning" on both themes without pulling in a new
    // token. The theme's accent (coral) is too close to yes/no coral-red
    // and reads as "live", not "hurry"; amber is unambiguous.
    case "warning":
      return th.isDark ? "#EAB308" : "#B45309";
    case "resolved":
      return th.textTertiary;
    default:
      return th.textSecondary;
  }
}

export function ResolvesInChip({
  resolvesAt,
  isResolved = false,
  th,
  variant = "card",
  style,
}: Props) {
  const reducedMotion = usePrefersReducedMotion();
  const { label, urgency } = useResolvesIn(resolvesAt, isResolved);

  // Resolved markets: swap the countdown for a tiny status badge. Keeps
  // visual weight minimal -- the duel-percentage already owns the page.
  if (urgency === "resolved") {
    return (
      <span
        style={{
          ...type.metaLabel,
          color: th.textTertiary,
          letterSpacing: variant === "card" ? "0.15em" : "0.05em",
          fontFamily: fonts.sans,
          fontSize: variant === "card" ? 10 : 11,
          ...style,
        }}
      >
        {variant === "card" ? "Resolved" : "\u2713 Resolved"}
      </span>
    );
  }

  if (!label) return null;

  const color = urgencyColor(urgency, th);
  const shouldPulse = urgency === "critical" && !reducedMotion;

  const base: CSSProperties =
    variant === "card"
      ? {
          ...type.metaLabel,
          color,
          fontFamily: fonts.sans,
        }
      : {
          ...type.volumeLabel,
          color,
          fontFamily: fonts.sans,
        };

  // Small "clock" glyph for the header variant. The card variant is intentionally
  // text-only to stay out of the way of the existing compact meta labels.
  const glyph = variant === "header" ? "\u23F1 " : "";

  return (
    <span
      aria-label={`Resolves in ${label}`}
      style={{
        ...base,
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        // Critical urgency: 2s opacity pulse, mirrors the "live now" dot pulse
        // specified in the liveliness proposal. Disabled under reduced-motion.
        animation: shouldPulse ? "resolvesInPulse 2s ease-in-out infinite" : undefined,
        ...style,
      }}
    >
      {glyph && <span aria-hidden="true">{glyph}</span>}
      <span>
        {variant === "card" ? "Resolves " : "in "}
        <span style={{ fontFamily: fonts.mono, fontVariantNumeric: "tabular-nums" }}>
          {label}
        </span>
      </span>
    </span>
  );
}
