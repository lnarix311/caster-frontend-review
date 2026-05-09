"use client";

/**
 * SessionKeyManager -- enable/disable signless trading.
 *
 * This component renders:
 * - When no session key: an "Enable Trading" button that opens a modal.
 * - When session key is active: a status indicator with expiry + revoke.
 *
 * The "Enable Trading" flow:
 * 1. Generate a random secp256k1 keypair in the browser.
 * 2. Sign an ApproveSessionKey EIP-712 message via the wallet (one-time popup).
 * 3. Store the session key in localStorage/sessionStorage.
 * 4. All subsequent PlaceOrder/CancelOrder/MergeRedeem are signed locally.
 */

import { useState, useEffect, useCallback } from "react";
import { useAccount } from "@/providers/AccountProvider";
import { useTheme } from "@/providers/ThemeProvider";
import {
  generateSessionKey,
  storeSessionKey,
  loadSessionKey,
  clearSessionKey,
  getSessionKeyForOwner,
  SESSION_KEY_DURATION_MS,
  type StoredSessionKey,
} from "@/lib/session-key";
import * as api from "@/lib/api";
import { fonts, type as typePresets, radii, space, motion, lightTheme, darkTheme } from "@/lib/oracle-theme";

// ---------------------------------------------------------------------------
// Exported hook for other components to check session key status
// ---------------------------------------------------------------------------

/**
 * Hook to check whether the current wallet has an active session key.
 * Re-checks on mount and when the address changes.
 */
export function useSessionKey(): {
  sessionKey: StoredSessionKey | null;
  isActive: boolean;
  refresh: () => void;
} {
  const { account } = useAccount();
  const [sessionKey, setSessionKey] = useState<StoredSessionKey | null>(null);

  const refresh = useCallback(() => {
    if (account) {
      setSessionKey(getSessionKeyForOwner(account.address));
    } else {
      setSessionKey(null);
    }
  }, [account]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    sessionKey,
    isActive: sessionKey !== null,
    refresh,
  };
}

// ---------------------------------------------------------------------------
// Session Key Status (inline in navbar)
// ---------------------------------------------------------------------------

export function SessionKeyStatus({
  onManage,
}: {
  onManage: () => void;
}) {
  const { account } = useAccount();
  const { theme } = useTheme();
  const th = theme === "dark" ? darkTheme : lightTheme;
  const { sessionKey, isActive } = useSessionKey();

  if (!account) return null;

  if (!isActive) {
    return (
      <button
        onClick={onManage}
        aria-label="Enable instant trading"
        style={{
          fontFamily: fonts.sans,
          fontSize: 11,
          fontWeight: 600,
          padding: "6px 10px",
          borderRadius: radii.sm,
          background: "rgba(34, 197, 94, 0.12)",
          color: "#22C55E",
          border: "none",
          cursor: "pointer",
          transition: motion.buttonTransition,
        }}
      >
        Enable Trading
      </button>
    );
  }

  // Active session key -- show status
  const expiresIn = sessionKey!.expiresAt - Date.now();
  const hoursLeft = Math.max(0, Math.floor(expiresIn / (1000 * 60 * 60)));
  const expiresDate = new Date(sessionKey!.expiresAt);
  const expiresStr = expiresDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <button
      onClick={onManage}
      aria-label="Session key active"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontFamily: fonts.sans,
        fontSize: 11,
        fontWeight: 500,
        padding: "5px 10px",
        borderRadius: radii.sm,
        background: "transparent",
        color: th.textSecondary,
        border: `0.8px solid ${th.border}`,
        cursor: "pointer",
        transition: motion.hoverTransition,
      }}
      title={`Session expires ${expiresStr}`}
    >
      {/* Green pulse dot */}
      <span
        style={{
          display: "inline-block",
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: "#22C55E",
          boxShadow: "0 0 4px rgba(34, 197, 94, 0.5)",
        }}
      />
      <span>Instant</span>
      <span style={{ color: th.textTertiary, fontFamily: fonts.mono, fontSize: 10 }}>
        {hoursLeft}h
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Session Key Modal
// ---------------------------------------------------------------------------

export function SessionKeyModal({
  onClose,
}: {
  onClose: () => void;
}) {
  const { account, walletClient, refresh: refreshAccount } = useAccount();
  const { theme } = useTheme();
  const th = theme === "dark" ? darkTheme : lightTheme;
  const { sessionKey, isActive, refresh: refreshKey } = useSessionKey();

  const [step, setStep] = useState<"idle" | "signing" | "confirming" | "success" | "error">("idle");
  const [persist, setPersist] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);

  const handleEnable = async () => {
    if (!account || !walletClient) return;
    setError(null);
    setStep("signing");

    try {
      // 1. Generate random keypair
      const { privateKey, address: skAddress } = generateSessionKey();

      // 2. Calculate expiry (3 days from now)
      const expiresAt = Date.now() + SESSION_KEY_DURATION_MS;

      // 3. Sign ApproveSessionKey with wallet (triggers popup) and submit
      const label = "caster.trade";
      const { tx_hash } = await api.signAndSubmitApproveSessionKey(
        walletClient,
        account.address,
        skAddress,
        label,
        expiresAt,
      );

      // 4. Wait for on-chain confirmation
      setStep("confirming");
      await api.waitForTx(tx_hash);

      // 5. Store in browser (only after on-chain confirmation)
      storeSessionKey({
        privateKey,
        address: skAddress,
        owner: account.address,
        expiresAt,
        label,
        persist,
      });

      setStep("success");
      refreshKey();
      refreshAccount();

      // Auto-close after brief confirmation
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to enable session key");
      setStep("error");
    }
  };

  const handleRevoke = async () => {
    if (!account || !walletClient || !sessionKey) return;
    setRevoking(true);
    setError(null);

    try {
      // Sign and submit revocation
      const { tx_hash } = await api.signAndSubmitRevokeSessionKey(
        walletClient,
        account.address,
        sessionKey.address,
      );

      // Wait for on-chain confirmation
      await api.waitForTx(tx_hash);

      // Clear local storage only after on-chain confirmation
      clearSessionKey();
      refreshKey();
      refreshAccount();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to revoke session key");
    } finally {
      setRevoking(false);
    }
  };

  const handleClearLocal = () => {
    clearSessionKey();
    refreshKey();
    onClose();
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0, 0, 0, 0.6)",
        backdropFilter: "blur(4px)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: 420,
          maxWidth: "90vw",
          background: th.elevated,
          border: `0.8px solid ${th.border}`,
          borderRadius: radii.lg,
          padding: space[8],
          position: "relative",
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            position: "absolute",
            top: space[4],
            right: space[4],
            background: "transparent",
            border: "none",
            color: th.textSecondary,
            cursor: "pointer",
            fontSize: 18,
            lineHeight: 1,
            padding: 4,
          }}
        >
          x
        </button>

        {isActive ? (
          // ---- Active session key view ----
          <>
            <h2 style={{
              fontFamily: fonts.serif,
              fontSize: 20,
              fontWeight: 400,
              color: th.textPrimary,
              margin: 0,
              marginBottom: space[6],
              letterSpacing: "-0.02em",
            }}>
              Session Key Active
            </h2>

            <div style={{
              background: th.surface,
              border: `0.8px solid ${th.border}`,
              borderRadius: radii.sm,
              padding: space[4],
              marginBottom: space[6],
            }}>
              {/* Status row */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: space[3] }}>
                <span style={{
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "#22C55E",
                  boxShadow: "0 0 6px rgba(34, 197, 94, 0.4)",
                }} />
                <span style={{ ...typePresets.tabLabel, color: "#22C55E" }}>Active</span>
              </div>

              {/* Key address */}
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: space[2] }}>
                <span style={{ ...typePresets.metaLabel, color: th.textTertiary }}>Key</span>
                <span style={{ ...typePresets.monoAddress, color: th.textSecondary }}>
                  {sessionKey!.address.slice(0, 8)}...{sessionKey!.address.slice(-6)}
                </span>
              </div>

              {/* Expiry */}
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: space[2] }}>
                <span style={{ ...typePresets.metaLabel, color: th.textTertiary }}>Expires</span>
                <span style={{ ...typePresets.monoSmall, color: th.textSecondary }}>
                  {new Date(sessionKey!.expiresAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              </div>

              {/* Storage */}
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ ...typePresets.metaLabel, color: th.textTertiary }}>Storage</span>
                <span style={{ ...typePresets.monoSmall, color: th.textSecondary }}>
                  {sessionKey!.persist ? "Persistent" : "This tab only"}
                </span>
              </div>
            </div>

            {error && (
              <div style={{
                fontSize: 12,
                color: th.no,
                marginBottom: space[4],
                fontFamily: fonts.sans,
              }}>
                {error}
              </div>
            )}

            {/* Actions */}
            <div style={{ display: "flex", gap: space[3] }}>
              <button
                onClick={handleRevoke}
                disabled={revoking}
                style={{
                  flex: 1,
                  ...typePresets.buttonTextSmall,
                  padding: "10px 0",
                  borderRadius: radii.sm,
                  background: "transparent",
                  color: th.no,
                  border: `0.8px solid ${th.no}`,
                  cursor: revoking ? "not-allowed" : "pointer",
                  opacity: revoking ? 0.5 : 1,
                  transition: motion.buttonTransition,
                }}
              >
                {revoking ? "Revoking..." : "Revoke on Chain"}
              </button>
              <button
                onClick={handleClearLocal}
                style={{
                  flex: 1,
                  ...typePresets.buttonTextSmall,
                  padding: "10px 0",
                  borderRadius: radii.sm,
                  background: "transparent",
                  color: th.textSecondary,
                  border: `0.8px solid ${th.border}`,
                  cursor: "pointer",
                  transition: motion.buttonTransition,
                }}
              >
                Clear Local Key
              </button>
            </div>

            <p style={{
              ...typePresets.bodySmall,
              color: th.textTertiary,
              marginTop: space[4],
              marginBottom: 0,
              lineHeight: 1.5,
            }}>
              &ldquo;Revoke on Chain&rdquo; invalidates the key permanently (requires wallet signature).
              &ldquo;Clear Local Key&rdquo; removes it from this browser only.
            </p>
          </>
        ) : (
          // ---- Enable session key view ----
          <>
            <h2 style={{
              fontFamily: fonts.serif,
              fontSize: 20,
              fontWeight: 400,
              color: th.textPrimary,
              margin: 0,
              marginBottom: space[3],
              letterSpacing: "-0.02em",
            }}>
              Enable Instant Trading
            </h2>

            <p style={{
              ...typePresets.bodySmall,
              color: th.textSecondary,
              marginBottom: space[6],
              lineHeight: 1.6,
            }}>
              Sign once to enable gas-free, instant trading for 3 days. Your
              session key can only place and cancel orders -- it cannot withdraw
              funds or perform admin operations.
            </p>

            {/* How it works */}
            <div style={{
              background: th.surface,
              border: `0.8px solid ${th.border}`,
              borderRadius: radii.sm,
              padding: space[4],
              marginBottom: space[6],
            }}>
              <div style={{ ...typePresets.metaLabel, color: th.textTertiary, marginBottom: space[3] }}>
                How it works
              </div>
              {[
                "A random trading key is generated in your browser",
                "You approve it with one wallet signature",
                "All trades are signed instantly -- no more popups",
                "Key expires automatically after 3 days",
              ].map((text, i) => (
                <div key={i} style={{
                  display: "flex",
                  gap: space[3],
                  alignItems: "flex-start",
                  marginBottom: i < 3 ? space[2] : 0,
                }}>
                  <span style={{
                    fontFamily: fonts.mono,
                    fontSize: 10,
                    color: th.textTertiary,
                    flexShrink: 0,
                    marginTop: 2,
                  }}>
                    {i + 1}.
                  </span>
                  <span style={{ ...typePresets.bodySmall, color: th.textSecondary }}>
                    {text}
                  </span>
                </div>
              ))}
            </div>

            {/* Persist checkbox */}
            <label style={{
              display: "flex",
              alignItems: "center",
              gap: space[3],
              marginBottom: space[6],
              cursor: "pointer",
            }}>
              <input
                type="checkbox"
                checked={persist}
                onChange={(e) => setPersist(e.target.checked)}
                style={{ accentColor: "#22C55E", width: 14, height: 14 }}
              />
              <span style={{ ...typePresets.bodySmall, color: th.textSecondary }}>
                Stay Connected
              </span>
              <span style={{ ...typePresets.monoSmall, color: th.textTertiary }}>
                (persists across tabs)
              </span>
            </label>

            {error && (
              <div style={{
                fontSize: 12,
                color: th.no,
                marginBottom: space[4],
                fontFamily: fonts.sans,
                padding: "6px 10px",
                background: th.noDim,
                borderRadius: radii.sm,
              }}>
                {error}
              </div>
            )}

            {/* Enable button */}
            <button
              onClick={handleEnable}
              disabled={step === "signing" || step === "confirming" || !account || !walletClient}
              style={{
                ...typePresets.buttonText,
                width: "100%",
                padding: 14,
                borderRadius: radii.sm,
                background: step === "success" ? "#22C55E" : "rgba(34, 197, 94, 0.15)",
                color: step === "success" ? "#000" : "#22C55E",
                border: step === "success" ? "none" : "1px solid rgba(34, 197, 94, 0.3)",
                cursor: step === "signing" || step === "confirming" ? "not-allowed" : "pointer",
                opacity: step === "signing" || step === "confirming" ? 0.6 : 1,
                transition: "all 200ms ease",
              }}
            >
              {step === "idle" || step === "error"
                ? "Enable Trading"
                : step === "signing"
                ? "Waiting for wallet..."
                : step === "confirming"
                ? "Confirming on chain..."
                : "Session key active"}
            </button>

            {step === "signing" && (
              <p style={{
                ...typePresets.bodySmall,
                color: th.textTertiary,
                textAlign: "center",
                marginTop: space[3],
                marginBottom: 0,
              }}>
                Confirm the signature in your wallet
              </p>
            )}

            {step === "confirming" && (
              <p style={{
                ...typePresets.bodySmall,
                color: th.textTertiary,
                textAlign: "center",
                marginTop: space[3],
                marginBottom: 0,
              }}>
                Waiting for on-chain confirmation...
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
