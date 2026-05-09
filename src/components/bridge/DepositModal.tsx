"use client";

import { useState, useEffect, useCallback } from "react";
import {
  useAccount as useWagmiAccount,
  useWalletClient,
  useSwitchChain,
  usePublicClient,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { parseUnits, formatUnits, erc20Abi } from "viem";
import { bridgeChain } from "@/lib/wallet-config";
import { useAccount } from "@/providers/AccountProvider";
import {
  BRIDGE_CONTRACT,
  USDC_ADDRESS,
  USDC_DECIMALS,
  MIN_DEPOSIT_USDC,
} from "@/lib/wallet-config";

const IS_TESTNET = process.env.NEXT_PUBLIC_TESTNET_MODE === "true";

const ARBISCAN_BASE = IS_TESTNET
  ? "https://sepolia.arbiscan.io/tx"
  : "https://arbiscan.io/tx";

// Sepolia ETH faucet -- needed for gas to call bridge.deposit()
const SEPOLIA_ETH_FAUCET = "https://sepoliafaucet.com";
// Circle's Sepolia USDC faucet -- needed to actually have USDC to deposit
const SEPOLIA_USDC_FAUCET = "https://faucet.circle.com";

/**
 * Threshold (ms) at which we swap the deposit-pending copy to a more
 * patient "still confirming" message. UX spec calls for 60s. Override
 * via window.__casterPendingThresholdMs for QA (e.g. set to 5000 to
 * verify the swap fires without waiting a full minute).
 */
const PENDING_LONG_THRESHOLD_MS = 60_000;

/**
 * Parse a wallet/RPC error message and bucket it into a user-facing
 * copy block. Detects insufficient-gas errors so we can point the user
 * straight at the Sepolia ETH faucet.
 */
type ErrorKind = "gas" | "rpc" | "generic";

function classifyError(msg: string): { kind: ErrorKind; copy: string } {
  const lc = msg.toLowerCase();

  // viem/wagmi surface insufficient-funds errors with these phrases.
  // We match conservatively so we don't mis-attribute e.g. "insufficient
  // allowance" to gas.
  if (
    lc.includes("insufficient funds") ||
    lc.includes("insufficient balance for transfer") ||
    lc.includes("insufficient eth") ||
    lc.includes("gas required exceeds")
  ) {
    return {
      kind: "gas",
      copy: "Not enough Sepolia ETH for gas. Get some at sepoliafaucet.com.",
    };
  }

  // RPC connectivity / network issues.
  if (
    lc.includes("network request failed") ||
    lc.includes("failed to fetch") ||
    lc.includes("connection") ||
    lc.includes("timeout") ||
    lc.includes("rpc") ||
    lc.includes("could not be reached")
  ) {
    return {
      kind: "rpc",
      copy:
        "Couldn’t reach the bridge contract. Refresh and retry — your USDC is still in your wallet.",
    };
  }

  return { kind: "generic", copy: msg };
}

// Minimal ABI for the bridge deposit function
const BRIDGE_ABI = [
  {
    name: "deposit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
] as const;

type Step = "input" | "approving" | "depositing" | "success" | "error";

interface DepositModalProps {
  onClose: () => void;
}

export function DepositModal({ onClose }: DepositModalProps) {
  const { address, chainId } = useWagmiAccount();
  const { data: walletClient } = useWalletClient();
  const { refresh } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: bridgeChain.id });

  const [amount, setAmount] = useState("");
  const [usdcBalance, setUsdcBalance] = useState<bigint>(BigInt(0));
  const [allowance, setAllowance] = useState<bigint>(BigInt(0));
  const [step, setStep] = useState<Step>("input");
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<ErrorKind>("generic");
  const [depositTxHash, setDepositTxHash] = useState<`0x${string}` | null>(null);
  // True after the deposit tx has been sitting in "pending" longer than
  // PENDING_LONG_THRESHOLD_MS. Used to swap copy to the "still confirming"
  // version without re-rendering on every tick.
  const [pendingLong, setPendingLong] = useState(false);

  // Write contract hooks
  const {
    writeContractAsync: writeApprove,
    data: approveTxHash,
    isPending: isApprovePending,
  } = useWriteContract();

  const {
    writeContractAsync: writeDeposit,
    isPending: isDepositPending,
  } = useWriteContract();

  // Wait for approve tx
  const { isSuccess: isApproveConfirmed } = useWaitForTransactionReceipt({
    hash: approveTxHash,
    chainId: bridgeChain.id,
  });

  // Wait for deposit tx
  const { isSuccess: isDepositConfirmed } = useWaitForTransactionReceipt({
    hash: depositTxHash ?? undefined,
    chainId: bridgeChain.id,
  });

  // Fetch USDC balance and allowance
  const fetchBalanceAndAllowance = useCallback(async () => {
    if (!address || !publicClient) return;
    try {
      const [bal, allow] = await Promise.all([
        publicClient.readContract({
          address: USDC_ADDRESS,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address],
        }),
        publicClient.readContract({
          address: USDC_ADDRESS,
          abi: erc20Abi,
          functionName: "allowance",
          args: [address, BRIDGE_CONTRACT],
        }),
      ]);
      setUsdcBalance(bal);
      setAllowance(allow);
    } catch {
      // Public client may not be available if not on Arbitrum
    }
  }, [address, publicClient]);

  useEffect(() => {
    fetchBalanceAndAllowance();
  }, [fetchBalanceAndAllowance]);

  // When approve is confirmed, re-fetch allowance then do deposit
  useEffect(() => {
    if (isApproveConfirmed && step === "approving") {
      fetchBalanceAndAllowance().then(() => {
        handleDeposit();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isApproveConfirmed]);

  // When deposit is confirmed, show success and refresh Caster balance
  useEffect(() => {
    if (isDepositConfirmed && step === "depositing") {
      setStep("success");
      // Refresh Caster balance after a short delay for chain processing
      setTimeout(() => {
        refresh();
      }, 2000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDepositConfirmed]);

  // Swap the pending copy after PENDING_LONG_THRESHOLD_MS. We start the
  // timer the moment we have a tx hash (i.e. the user signed and the tx
  // is broadcasting / awaiting Arbitrum finality). Resets on success/error.
  useEffect(() => {
    if (step !== "depositing" || !depositTxHash) {
      setPendingLong(false);
      return;
    }
    // Allow QA / E2E to override the threshold for fast local testing.
    const override =
      typeof window !== "undefined" &&
      typeof (window as unknown as { __casterPendingThresholdMs?: number })
        .__casterPendingThresholdMs === "number"
        ? (window as unknown as { __casterPendingThresholdMs: number })
            .__casterPendingThresholdMs
        : PENDING_LONG_THRESHOLD_MS;
    const id = window.setTimeout(() => setPendingLong(true), override);
    return () => window.clearTimeout(id);
  }, [step, depositTxHash]);

  const parsedAmount = (() => {
    try {
      if (!amount || isNaN(Number(amount))) return BigInt(0);
      return parseUnits(amount, USDC_DECIMALS);
    } catch {
      return BigInt(0);
    }
  })();

  const needsApproval = allowance < parsedAmount;
  const isOnArbitrum = chainId === bridgeChain.id;
  const bridgeNotConfigured = BRIDGE_CONTRACT === "0x0000000000000000000000000000000000000000" as `0x${string}`;

  const handleSwitchNetwork = async () => {
    try {
      await switchChainAsync({ chainId: bridgeChain.id });
    } catch (err) {
      setError("Failed to switch to Arbitrum. Please switch manually in your wallet.");
    }
  };

  const handleDeposit = async () => {
    if (!address || !walletClient) return;
    if (bridgeNotConfigured) {
      setError("Bridge contract not configured. Set NEXT_PUBLIC_BRIDGE_CONTRACT.");
      setErrorKind("generic");
      setStep("error");
      return;
    }
    setError(null);
    setErrorKind("generic");
    setStep("depositing");
    try {
      const hash = await writeDeposit({
        address: BRIDGE_CONTRACT,
        abi: BRIDGE_ABI,
        functionName: "deposit",
        args: [parsedAmount],
        chainId: bridgeChain.id,
      });
      setDepositTxHash(hash);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Deposit failed";
      if (msg.includes("User rejected") || msg.includes("User denied")) {
        setStep("input");
      } else {
        const classified = classifyError(msg);
        setErrorKind(classified.kind);
        setError(classified.copy);
        setStep("error");
      }
    }
  };

  const handleSubmit = async () => {
    if (!address || !walletClient) return;
    setError(null);

    if (parsedAmount < MIN_DEPOSIT_USDC) {
      setError("Minimum deposit is $5.00");
      return;
    }
    if (parsedAmount > usdcBalance) {
      setError("Insufficient USDC balance on Arbitrum");
      return;
    }

    if (needsApproval) {
      setStep("approving");
      try {
        await writeApprove({
          address: USDC_ADDRESS,
          abi: erc20Abi,
          functionName: "approve",
          args: [BRIDGE_CONTRACT, parsedAmount],
          chainId: bridgeChain.id,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Approval failed";
        if (msg.includes("User rejected") || msg.includes("User denied")) {
          setStep("input");
        } else {
          const classified = classifyError(msg);
          setErrorKind(classified.kind);
          setError(classified.copy);
          setStep("error");
        }
      }
    } else {
      await handleDeposit();
    }
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
            Deposit USDC
          </h2>
          <button
            onClick={onClose}
            aria-label="Close deposit modal"
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

        {/* Network check */}
        {!isOnArbitrum && step === "input" && (
          <div
            style={{
              background: "var(--warning-dim)",
              border: "1px solid var(--warning)",
              borderRadius: "var(--radius-sm)",
              padding: "var(--space-3)",
              marginBottom: "var(--space-4)",
              fontSize: "var(--text-sm)",
              color: "var(--warning)",
            }}
          >
            <div style={{ marginBottom: "var(--space-2)" }}>
              Switch to Arbitrum to deposit USDC.
            </div>
            <button
              onClick={handleSwitchNetwork}
              style={{
                background: "var(--warning)",
                color: "#000",
                border: "none",
                borderRadius: "var(--radius-sm)",
                padding: "6px 12px",
                fontSize: "var(--text-xs)",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Switch to Arbitrum
            </button>
          </div>
        )}

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
              <span>USDC on Arbitrum</span>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  cursor: "pointer",
                }}
                onClick={() =>
                  setAmount(formatUnits(usdcBalance, USDC_DECIMALS))
                }
                title="Click to use max"
              >
                {formatUnits(usdcBalance, USDC_DECIMALS)} USDC
              </span>
            </div>

            {/* Amount input */}
            <div
              style={{
                position: "relative",
                marginBottom: "var(--space-4)",
              }}
            >
              <input
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => {
                  const val = e.target.value;
                  if (/^[0-9]*\.?[0-9]{0,6}$/.test(val) || val === "") {
                    setAmount(val);
                    setError(null);
                  }
                }}
                aria-label="Deposit amount in USDC"
                style={{
                  width: "100%",
                  background: "var(--glass-subtle-bg)",
                  border: "1px solid var(--glass-subtle-border)",
                  borderRadius: "var(--radius-sm)",
                  padding: "12px 60px 12px 14px",
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
                USDC
              </span>
            </div>

            {/* Conversion info */}
            {parsedAmount > BigInt(0) && (
              <div
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--text-tertiary)",
                  marginBottom: "var(--space-4)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                You will receive ${Number(amount).toFixed(2)} on Caster
              </div>
            )}

            {/* Minimum deposit notice */}
            <div
              style={{
                fontSize: "var(--text-xs)",
                color: "var(--text-tertiary)",
                marginBottom: "var(--space-4)",
              }}
            >
              Minimum deposit: $5.00 USDC
            </div>

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

            {/* Submit button */}
            <button
              onClick={handleSubmit}
              disabled={!isOnArbitrum || parsedAmount === BigInt(0) || !walletClient}
              style={{
                width: "100%",
                padding: "12px",
                borderRadius: "var(--radius-sm)",
                border: "none",
                background:
                  !isOnArbitrum || parsedAmount === BigInt(0)
                    ? "var(--glass-subtle-bg)"
                    : "var(--accent)",
                color:
                  !isOnArbitrum || parsedAmount === BigInt(0)
                    ? "var(--text-tertiary)"
                    : "var(--accent-on)",
                fontSize: "var(--text-sm)",
                fontWeight: 600,
                cursor:
                  !isOnArbitrum || parsedAmount === BigInt(0)
                    ? "not-allowed"
                    : "pointer",
                fontFamily: "var(--font-body)",
              }}
            >
              {needsApproval ? "Approve & Deposit" : "Deposit"}
            </button>

            {/*
             * Sepolia faucet helper block (testnet only).
             * Shown when the user has no Sepolia USDC to deposit yet --
             * this is the moment they need the links most. Also shown
             * regardless of balance because new testers usually need both
             * USDC and ETH. We keep it muted so it doesn't crowd the form.
             */}
            {IS_TESTNET && (
              <FaucetLinks emphasised={usdcBalance === BigInt(0)} />
            )}
          </>
        )}

        {step === "approving" && (
          <div style={{ textAlign: "center", padding: "var(--space-6) 0" }}>
            <div
              style={{
                fontSize: "var(--text-sm)",
                color: "var(--text-secondary)",
                marginBottom: "var(--space-3)",
              }}
            >
              {isApprovePending
                ? "Confirm USDC approval in your wallet..."
                : "Waiting for approval confirmation..."}
            </div>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
              Step 1 of 2: Approve USDC spending
            </div>
          </div>
        )}

        {step === "depositing" && (
          <div style={{ textAlign: "center", padding: "var(--space-6) 0" }}>
            <div
              style={{
                fontSize: "var(--text-sm)",
                color: "var(--text-secondary)",
                marginBottom: "var(--space-3)",
              }}
            >
              {isDepositPending
                ? "Confirm deposit in your wallet..."
                : pendingLong
                  ? "Still confirming on Arbitrum… this can take up to 2 minutes."
                  : "Bridge deposits confirm in ~30s after Arbitrum finality."}
            </div>
            <div
              style={{
                fontSize: "var(--text-xs)",
                color: "var(--text-tertiary)",
                marginBottom: "var(--space-3)",
                lineHeight: 1.5,
              }}
            >
              You can close this — your balance updates in your wallet menu when ready.
            </div>
            {depositTxHash && (
              <a
                href={`${ARBISCAN_BASE}/${depositTxHash}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--accent)",
                  textDecoration: "underline",
                  display: "inline-block",
                }}
              >
                {"View on Arbiscan ↗"}
              </a>
            )}
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
              Deposit Successful
            </div>
            <div
              style={{
                fontSize: "var(--text-sm)",
                color: "var(--text-secondary)",
                marginBottom: "var(--space-4)",
              }}
            >
              {Number(amount).toFixed(2)} USDC deposited. Your Caster balance will update shortly.
            </div>
            {depositTxHash && (
              <a
                href={`${ARBISCAN_BASE}/${depositTxHash}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--accent)",
                  textDecoration: "underline",
                  display: "block",
                  marginBottom: "var(--space-4)",
                }}
              >
                View on Arbiscan
              </a>
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
              Transaction Failed
            </div>
            <div
              style={{
                fontSize: "var(--text-sm)",
                color: "var(--text-secondary)",
                marginBottom: "var(--space-4)",
                wordBreak: "break-word",
                lineHeight: 1.5,
              }}
            >
              {error}
            </div>
            {errorKind === "gas" && (
              <a
                href={SEPOLIA_ETH_FAUCET}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "inline-block",
                  marginBottom: "var(--space-4)",
                  fontSize: "var(--text-xs)",
                  color: "var(--accent)",
                  textDecoration: "underline",
                }}
              >
                {"Open sepoliafaucet.com ↗"}
              </a>
            )}
            <button
              onClick={() => {
                setStep("input");
                setError(null);
                setErrorKind("generic");
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

// ---------------------------------------------------------------------------
// FaucetLinks -- Sepolia USDC + ETH faucet links shown inside the Deposit
// modal on testnet. Bridging to Caster requires *both*:
//   - Sepolia USDC (the asset itself), and
//   - Sepolia ETH (for the gas to call deposit())
// New testers consistently get stuck on this; surfacing the links inline
// removes the "where do I get test funds?" support load.
// ---------------------------------------------------------------------------

function FaucetLinks({ emphasised }: { emphasised: boolean }) {
  return (
    <div
      style={{
        marginTop: "var(--space-4)",
        paddingTop: "var(--space-4)",
        borderTop: "1px solid var(--border-default)",
      }}
    >
      <div
        style={{
          fontSize: "var(--text-xs)",
          color: emphasised ? "var(--text-secondary)" : "var(--text-tertiary)",
          fontWeight: emphasised ? 600 : 500,
          marginBottom: "var(--space-2)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        First time on Sepolia?
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-1)",
        }}
      >
        <FaucetLink
          label="Need Sepolia USDC?"
          host="faucet.circle.com"
          href={SEPOLIA_USDC_FAUCET}
        />
        <FaucetLink
          label="Need Sepolia ETH for gas?"
          host="sepoliafaucet.com"
          href={SEPOLIA_ETH_FAUCET}
        />
      </div>
    </div>
  );
}

function FaucetLink({
  label,
  host,
  href,
}: {
  label: string;
  host: string;
  href: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: "var(--space-2)",
        padding: "6px 0",
        fontSize: "var(--text-xs)",
        textDecoration: "none",
        color: "var(--text-tertiary)",
      }}
    >
      <span>{label}</span>
      <span
        style={{
          color: "var(--accent)",
          fontWeight: 500,
          // The arrow is the universal "leaves the app" cue. Keep it
          // consistent with the Arbiscan link above.
          whiteSpace: "nowrap",
        }}
      >
        {host} {"↗"}
      </span>
    </a>
  );
}
