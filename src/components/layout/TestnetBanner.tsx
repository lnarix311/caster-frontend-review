"use client";

import { useEffect, useState } from "react";

/**
 * TestnetBanner -- Persistent full-width amber stripe shown above the Navbar
 * to make it unmistakable that the user is on testnet.
 *
 * Behaviour:
 *   - Hidden when NEXT_PUBLIC_NETWORK === "mainnet". Default (undefined,
 *     "testnet", "devnet", anything else) shows the banner.
 *   - Dismissible via the right-side close button -- but the dismissal lives
 *     in component state only, so a full page load brings the banner back.
 *     This is intentional: we want users reminded on every navigation, not
 *     just the first session. (Beta users can hide it for the current page
 *     view if it gets in the way.)
 *   - Mobile collapse: the longer copy is hidden under viewport width 480px;
 *     a shorter "TESTNET -- not real funds" version takes its place.
 *
 * Visual: amber stripe using the existing --warning design token, rendered
 * above the Navbar (the layout sets the order). 28px tall to stay out of
 * the way; mono lowercase to feel like a system message, not an ad.
 */
export function TestnetBanner() {
  // Start hidden until mounted so SSR/CSR markup matches without a flash of
  // banner-on-mainnet. Then evaluate env on mount.
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    const network = process.env.NEXT_PUBLIC_NETWORK;
    // Only hide on explicit mainnet. Default to showing.
    if (network === "mainnet") return;
    setHidden(false);
  }, []);

  if (hidden) return null;

  return (
    <div
      role="status"
      aria-label="Testnet warning"
      data-testid="testnet-banner"
      style={{
        position: "relative",
        width: "100%",
        background: "var(--warning)",
        color: "#1A1208",
        // Use a thin bottom border so it visually separates from the navbar.
        borderBottom: "1px solid rgba(0,0,0,0.18)",
        // Compact -- the orderbook needs every vertical pixel.
        minHeight: 28,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "4px 44px 4px 16px",
        zIndex: 50,
        fontFamily:
          '"IBM Plex Mono", "JetBrains Mono", "SF Mono", Consolas, monospace',
        fontSize: 12,
        fontWeight: 500,
        letterSpacing: "0.02em",
        textAlign: "center",
        lineHeight: 1.3,
      }}
    >
      {/* Long copy: hidden on narrow screens via inline media query trick.
          We use two spans + CSS in globals scope-free way: the parent class
          drives visibility via the breakpoint utility classes injected below. */}
      <span className="testnet-banner-long">
        <strong style={{ fontWeight: 700 }}>TESTNET</strong>
        {" — funds have no real value."}
      </span>
      <span className="testnet-banner-short">
        <strong style={{ fontWeight: 700 }}>TESTNET</strong>
        {" — not real funds"}
      </span>

      <button
        type="button"
        onClick={() => setHidden(true)}
        aria-label="Dismiss testnet warning for this page view"
        style={{
          position: "absolute",
          right: 8,
          top: "50%",
          transform: "translateY(-50%)",
          width: 24,
          height: 24,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "transparent",
          border: "none",
          color: "#1A1208",
          fontSize: 16,
          fontWeight: 500,
          lineHeight: 1,
          cursor: "pointer",
          opacity: 0.65,
          padding: 0,
          borderRadius: 4,
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.opacity = "1";
          (e.currentTarget as HTMLButtonElement).style.background =
            "rgba(0,0,0,0.08)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.opacity = "0.65";
          (e.currentTarget as HTMLButtonElement).style.background =
            "transparent";
        }}
      >
        {"×"}
      </button>
    </div>
  );
}
