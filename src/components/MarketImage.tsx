"use client";

import Image from "next/image";
import { useState } from "react";
import type { OracleTheme } from "@/lib/oracle-theme";
import { fonts } from "@/lib/oracle-theme";

function resolveImageSrc(src: string | null | undefined): string | null {
  if (!src) return null;
  if (/^https?:\/\//.test(src)) return src;
  if (src.startsWith("/api/")) return src;
  return `/api${src.startsWith("/") ? src : `/${src}`}`;
}

/**
 * Market thumbnail image with graceful fallback.
 *
 * Fallback renders when `src` is null/empty OR when the image fails to load
 * (404, CORS, slow backend, etc). The placeholder is a theme-aware muted tile
 * showing the first letter of the market question — no jarring broken-image
 * icons.
 *
 * Uses next/image for automatic lazy-loading, responsive sizing, and caching.
 * The backend sets immutable cache headers on served images, so next/image's
 * ISR-style caching is safe.
 */
export function MarketImage({
  src,
  alt,
  size,
  radius,
  th,
}: {
  src: string | null | undefined;
  alt: string;
  /** Square side length in px (48 for cards, 72 for market page, 28 for rows). */
  size: number;
  /** Border radius in px. */
  radius: number;
  th: OracleTheme;
}) {
  const [errored, setErrored] = useState(false);

  const resolvedSrc = resolveImageSrc(src);
  const showFallback = !resolvedSrc || errored;
  const firstLetter = (alt.trim().charAt(0) || "?").toUpperCase();

  // Theme-aware placeholder colors — subtle muted tile matching the border.
  // Dark: slightly lighter than bg. Light: slightly darker than bg.
  const placeholderBg = th.isDark
    ? "rgba(255, 255, 255, 0.05)"
    : "rgba(26, 26, 26, 0.05)";
  const placeholderBorder = th.border;
  const placeholderColor = th.textTertiary;

  const baseStyle = {
    width: size,
    height: size,
    borderRadius: radius,
    flexShrink: 0,
    overflow: "hidden" as const,
    display: "block" as const,
  };

  if (showFallback) {
    return (
      <div
        role="img"
        aria-label={alt}
        style={{
          ...baseStyle,
          background: placeholderBg,
          border: `0.8px solid ${placeholderBorder}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: fonts.serif,
          fontSize: Math.max(12, Math.round(size * 0.42)),
          fontWeight: 400,
          color: placeholderColor,
          userSelect: "none" as const,
          letterSpacing: "-0.02em",
        }}
      >
        {firstLetter}
      </div>
    );
  }

  return (
    <div style={{ ...baseStyle, position: "relative", background: placeholderBg }}>
      <Image
        src={resolvedSrc as string}
        alt={alt}
        width={size}
        height={size}
        onError={() => setErrored(true)}
        style={{
          width: size,
          height: size,
          objectFit: "cover",
          display: "block",
        }}
        // Thumbnails are small; disable srcSet generation (single-size use).
        unoptimized={false}
      />
    </div>
  );
}
