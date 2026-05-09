"use client";

import { useState, useEffect } from "react";
import { useAccount } from "@/providers/AccountProvider";
import * as api from "@/lib/api";
import { WITHDRAW_FEE_TICKS } from "@/lib/wallet-config";

type Step = "input" | "signing" | "success" | "error";

interface WithdrawModalProps {
  onClose: () => void;
}

export function WithdrawModal({ onClose }: WithdrawModalProps) {
  const { account, walletClient, refresh } = useAccount();

  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<Step>("input");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [bridgeTvl, setBridgeTvl] = useState<number | null>(null);

  // Fetch bridge TVL (USDC available for withdrawals)
  useEffect(() => {
    api.getBridgeStatus().then((s) => setBridgeTvl(s.tvl)).catch(() => {});
  }, []);

  const balanceTicks = account?.balance ?? 0;
  const balanceDollars = balanceTicks / 1000;
  const bridgeAvailableDollars = bridgeTvl !== null ? bridgeTvl / 1000 : null;

  // Parse user input (dollars) to ticks
  const parsedDollars = Number(amount) || 0;
  const amountTicks = Math.floor(parsedDollars * 1000);

  const feeDollars = WITHDRAW_FEE_TICKS / 1000;

  // Net USDC the user receives (fee is deducted from the withdrawal amount)
  const netUsdcDollars = Math.max(0, parsedDollars - feeDollars);

  const netAmountTicks = Math.max(0, amountTicks - WITHDRAW_FEE_TICKS);
  const exceedsBridgeLiquidity = bridgeTvl !== null && netAmountTicks > bridgeTvl;

  const amountTooSmall = amountTicks > 0 && amountTicks <= WITHDRAW_FEE_TICKS;

  const canSubmit =
    walletClient &&
    account &&
    amountTicks > 0 &&
    !amountTooSmall &&
    amountTicks <= balanceTicks &&
    !exceedsBridgeLiquidity;

  const handleSubmit = async () => {
    if (!canSubmit || !account || !walletClient) return;
    setError(null);
    setStep("signing");

    try {
      const result = await api.bridgeWithdraw(
        walletClient,
        account.address,
        amountTicks,
      );
      setTxHash(result.tx_hash);
      setStep("success");

      // Refresh Caster balance
      setTimeout(() => {
        refresh();
      }, 1000);
    } catch (err: unknown) {
      // Extract error message from any shape of thrown value:
      // - Error instances (standard path)
      // - EIP-1193 ProviderRpcError objects ({ code, message })
      // - Plain strings
      // - Unknown objects (JSON-stringified as last resort)
      let msg: string;
      if (err instanceof Error) {
        msg = err.message;
      } else if (
        typeof err === "object" &&
        err !== null &&
        "message" in err &&
        typeof (err as Record<string, unknown>).message === "string"
      ) {
        msg = (err as { message: string }).message;
      } else if (typeof err === "string") {
        msg = err;
      } else {
        try {
          msg = `Unexpected error: ${JSON.stringify(err)}`;
        } catch {
          msg = `Unexpected error: ${String(err)}`;
        }
      }

      console.error("[WithdrawModal] withdrawal error:", err);

      if (msg.includes("User rejected") || msg.includes("User denied")) {
        setStep("input");
      } else {
        setError(msg);
        setStep("error");
      }
    }
  };

  const handleMaxClick = () => {
    // Max withdrawal = full balance (fee is deducted from the amount)
    const maxDollars = balanceDollars;
    setAmount(maxDollars > 0 ? maxDollars.toFixed(2) : "");
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(4px)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && step === "input") onClose();
      }}
    >
      <div
        className="glass-elevated"
        style={{
          width: "100%",
          maxWidth: 420,
          borderRadius: "var(--radius-lg)",
          padding: "var(--space-6)",
          margin: "var(--space-4)",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "var(--space-5)",
          }}
        >
          <h2
            style={{
              fontSize: "var(--text-md)",
              fontWeight: 600,
              color: "var(--text-primary)",
              margin: 0,
            }}
          >
            Withdraw to Arbitrum
          </h2>
          <button
            onClick={onClose}
            aria-label="Close withdraw modal"
            style={{
              background: "none",
              border: "none",
              color: "var(--text-tertiary)",
              fontSize: 18,
              cursor: "pointer",
              padding: 4,
              lineHeight: 1,
            }}
          >
            x
          </button>
        </div>

        {step === "input" && (
          <>
            {/* Balance display */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: "var(--space-2)",
                fontSize: "var(--text-xs)",
                color: "var(--text-secondary)",
              }}
            >
              <span>Caster balance</span>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  cursor: "pointer",
                }}
                onClick={handleMaxClick}
                title="Click to use max"
              >
                ${balanceDollars.toFixed(2)}
              </span>
            </div>

            {/* Amount input */}
            <div
              style={{
                position: "relative",
                marginBottom: "var(--space-3)",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  left: 14,
                  top: "50%",
                  transform: "translateY(-50%)",
                  fontSize: "var(--text-md)",
                  color: "var(--text-tertiary)",
                  fontWeight: 600,
                }}
              >
                $
              </span>
              <input
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => {
                  const val = e.target.value;
                  if (/^[0-9]*\.?[0-9]{0,2}$/.test(val) || val === "") {
                    setAmount(val);
                    setError(null);
                  }
                }}
                aria-label="Withdrawal amount in dollars"
                style={{
                  width: "100%",
                  background: "var(--glass-subtle-bg)",
                  border: "1px solid var(--glass-subtle-border)",
                  borderRadius: "var(--radius-sm)",
                  padding: "12px 60px 12px 28px",
                  fontSize: "var(--text-md)",
                  fontFamily: "var(--font-mono)",
                  color: "var(--text-primary)",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
              <span
                style={{
                  position: "absolute",
                  right: 14,
                  top: "50%",
                  transform: "translateY(-50%)",
                  fontSize: "var(--text-sm)",
                  color: "var(--text-tertiary)",
                  fontWeight: 600,
                }}
              >
                USD
              </span>
            </div>

            {/* Fee and net breakdown */}
            {amountTicks > 0 && (
              <div
                style={{
                  background: "var(--glass-subtle-bg)",
                  borderRadius: "var(--radius-sm)",
                  padding: "var(--space-3)",
                  marginBottom: "var(--space-4)",
                  fontSize: "var(--text-xs)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    color: "var(--text-secondary)",
                    marginBottom: "var(--space-1)",
                  }}
                >
                  <span>Withdrawal amount</span>
                  <span>${parsedDollars.toFixed(2)}</span>
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    color: "var(--text-tertiary)",
                    marginBottom: "var(--space-1)",
                  }}
                >
                  <span>Bridge fee</span>
                  <span>-${feeDollars.toFixed(2)}</span>
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    color: "var(--text-primary)",
                    fontWeight: 600,
                    borderTop: "1px solid var(--border-default)",
                    paddingTop: "var(--space-1)",
                    marginTop: "var(--space-1)",
                  }}
                >
                  <span>You receive on Arbitrum</span>
                  <span>{netUsdcDollars.toFixed(2)} USDC</span>
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--no-text)",
                  marginBottom: "var(--space-3)",
                }}
              >
                {error}
              </div>
            )}

            {amountTooSmall && (
              <div
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--no-text)",
                  marginBottom: "var(--space-3)",
                }}
              >
                Withdrawal amount must be greater than the ${feeDollars.toFixed(2)} fee.
              </div>
            )}

            {amountTicks > balanceTicks && amountTicks > 0 && (
              <div
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--no-text)",
                  marginBottom: "var(--space-3)",
                }}
              >
                Insufficient balance.
              </div>
            )}

            {exceedsBridgeLiquidity && amountTicks > 0 && (
              <div
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--no-text)",
                  marginBottom: "var(--space-3)",
                }}
              >
                Exceeds bridge liquidity. Only ${bridgeAvailableDollars?.toFixed(2)} USDC available on Arbitrum.
                Faucet funds are not withdrawable — only deposited USDC can be withdrawn.
              </div>
            )}

            {/* Submit button */}
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              style={{
                width: "100%",
                padding: "12px",
                borderRadius: "var(--radius-sm)",
                border: "none",
                background: canSubmit ? "var(--accent)" : "var(--glass-subtle-bg)",
                color: canSubmit ? "var(--accent-on)" : "var(--text-tertiary)",
                fontSize: "var(--text-sm)",
                fontWeight: 600,
                cursor: canSubmit ? "pointer" : "not-allowed",
                fontFamily: "var(--font-body)",
              }}
            >
              Withdraw
            </button>

            {/* Info note */}
            <div
              style={{
                fontSize: "var(--text-2xs)",
                color: "var(--text-tertiary)",
                marginTop: "var(--space-3)",
                textAlign: "center",
                lineHeight: 1.4,
              }}
            >
              A {feeDollars.toFixed(0)} USDC fee will be deducted from the USDC withdrawn.
              <br />
              Processing typically takes 1-5 minutes.
            </div>
          </>
        )}

        {step === "signing" && (
          <div style={{ textAlign: "center", padding: "var(--space-6) 0" }}>
            <div
              style={{
                fontSize: "var(--text-sm)",
                color: "var(--text-secondary)",
                marginBottom: "var(--space-3)",
              }}
            >
              Sign the withdrawal in your wallet...
            </div>
            <div
              style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}
            >
              This is a Caster transaction signed with EIP-712.
            </div>
          </div>
        )}

        {step === "success" && (
          <div style={{ textAlign: "center", padding: "var(--space-6) 0" }}>
            <div
              style={{
                fontSize: "var(--text-md)",
                fontWeight: 600,
                color: "var(--yes-text)",
                marginBottom: "var(--space-3)",
              }}
            >
              Withdrawal Submitted
            </div>
            <div
              style={{
                fontSize: "var(--text-sm)",
                color: "var(--text-secondary)",
                marginBottom: "var(--space-2)",
              }}
            >
              {netUsdcDollars.toFixed(2)} USDC will be sent to your wallet on Arbitrum.
            </div>
            <div
              style={{
                fontSize: "var(--text-xs)",
                color: "var(--text-tertiary)",
                marginBottom: "var(--space-4)",
              }}
            >
              ${feeDollars.toFixed(2)} bridge fee was deducted from your ${parsedDollars.toFixed(2)} withdrawal.
            </div>
            {txHash && (
              <div
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--text-tertiary)",
                  fontFamily: "var(--font-mono)",
                  marginBottom: "var(--space-4)",
                  wordBreak: "break-all",
                }}
              >
                Caster TX: {txHash}
              </div>
            )}
            <button
              onClick={onClose}
              style={{
                width: "100%",
                padding: "10px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border-default)",
                background: "transparent",
                color: "var(--text-primary)",
                fontSize: "var(--text-sm)",
                fontWeight: 500,
                cursor: "pointer",
                fontFamily: "var(--font-body)",
              }}
            >
              Close
            </button>
          </div>
        )}

        {step === "error" && (
          <div style={{ textAlign: "center", padding: "var(--space-6) 0" }}>
            <div
              style={{
                fontSize: "var(--text-md)",
                fontWeight: 600,
                color: "var(--no-text)",
                marginBottom: "var(--space-3)",
              }}
            >
              Withdrawal Failed
            </div>
            <div
              style={{
                fontSize: "var(--text-xs)",
                color: "var(--text-secondary)",
                marginBottom: "var(--space-4)",
                wordBreak: "break-word",
              }}
            >
              {error}
            </div>
            <button
              onClick={() => {
                setStep("input");
                setError(null);
              }}
              style={{
                width: "100%",
                padding: "10px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border-default)",
                background: "transparent",
                color: "var(--text-primary)",
                fontSize: "var(--text-sm)",
                fontWeight: 500,
                cursor: "pointer",
                fontFamily: "var(--font-body)",
              }}
            >
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
