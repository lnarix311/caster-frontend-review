"use client";

import { useEffect, useState } from "react";
import { useAccount as useWagmiAccount, useSwitchChain } from "wagmi";
import { bridgeChain } from "@/lib/wallet-config";

/**
 * NetworkSwitchToast -- one-line orange toast that appears when the user
 * is connected to a wallet on the wrong chain (anything other than
 * Arbitrum Sepolia / 421614). Includes a single button that calls
 * switchChainAsync; wagmi will trigger the wallet's "add/switch network"
 * prompt automatically if the network is unknown.
 *
 * Behaviour:
 *   - Hidden when not connected, or when on the correct chain.
 *   - User-dismissible: a close button hides the toast for the current
 *     page view (resets on full reload). We don't persist this in
 *     localStorage because being on the wrong chain is actively broken
 *     for trading -- they should keep being reminded.
 *   - Auto-hides as soon as `chainId` flips to `bridgeChain.id`.
 *
 * Visually it sits below TestnetBanner + Navbar, fixed to the top of the
 * viewport so it doesn't shift content. Coral accent + warning amber so
 * it reads as "attention needed" but matches the brand.
 */
export function NetworkSwitchToast() {
  const { isConnected, chainId } = useWagmiAccount();
  const { switchChainAsync, isPending } = useSwitchChain();

  const [dismissed, setDismissed] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

  // Reset the dismiss flag whenever the user disconnects, so the next
  // session shows the toast again if they're still on the wrong chain.
  useEffect(() => {
    if (!isConnected) {
      setDismissed(false);
      setSwitchError(null);
    }
  }, [isConnected]);

  // Reset error state once they're on the right chain.
  useEffect(() => {
    if (chainId === bridgeChain.id) {
      setSwitchError(null);
    }
  }, [chainId]);

  if (!isConnected) return null;
  if (chainId === bridgeChain.id) return null;
  if (dismissed) return null;

  const handleSwitch = async () => {
    setSwitchError(null);
    try {
      await switchChainAsync({ chainId: bridgeChain.id });
    } catch (err) {
      // Most common: user rejected the switch in the wallet popup.
      // Don't dismiss the toast — they may want to retry.
      const msg = err instanceof Error ? err.message : "Switch failed";
      if (msg.includes("User rejected") || msg.includes("User denied")) {
        return;
      }
      setSwitchError("Couldn’t switch network. Try from your wallet menu.");
    }
  };

  return (
    <div
      role="alert"
      aria-live="polite"
      data-testid="network-switch-toast"
      style={{
        position: "fixed",
        top: 12,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 80,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 12px 8px 16px",
        background: "var(--warning)",
        color: "#1A1208",
        borderRadius: "var(--radius-md)",
        boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
        fontFamily:
          '"IBM Plex Mono", "JetBrains Mono", "SF Mono", Consolas, monospace',
        fontSize: 12,
        fontWeight: 500,
        maxWidth: "calc(100vw - 24px)",
      }}
    >
      <span>
        {switchError ?? "Switch to Arbitrum Sepolia"}
      </span>
      <button
        type="button"
        onClick={handleSwitch}
        disabled={isPending}
        style={{
          background: "#1A1208",
          color: "var(--warning)",
          border: "none",
          borderRadius: "var(--radius-sm)",
          padding: "4px 10px",
          fontSize: 11,
          fontWeight: 600,
          cursor: isPending ? "wait" : "pointer",
          opacity: isPending ? 0.7 : 1,
          fontFamily: "inherit",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        {isPending ? "Switching…" : "Switch"}
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss network switch toast"
        style={{
          width: 20,
          height: 20,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "transparent",
          border: "none",
          color: "#1A1208",
          fontSize: 16,
          lineHeight: 1,
          cursor: "pointer",
          opacity: 0.65,
          padding: 0,
          borderRadius: 4,
        }}
      >
        {"×"}
      </button>
    </div>
  );
}
