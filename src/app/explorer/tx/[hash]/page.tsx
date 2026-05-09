"use client";

/**
 * /explorer/tx/[hash]
 *
 * Single-tx detail page. Fetches `GET /tx/{hash}` and renders:
 *   - Header (hash + status badge + back link)
 *   - Overview (block, time, signer, nonce, payload kind)
 *   - Payload (per-kind formatter + raw JSON drop-down)
 *   - Receipt (success/error + events)
 *   - Fills (if PlaceOrder produced trades)
 *
 * Visual language matches /explorer (CSS variables, monospace hashes,
 * tertiary-color labels, dim badges per payload kind).
 */

import { useEffect, useState, useMemo, use as usePromise } from "react";
import Link from "next/link";
import * as api from "@/lib/api";
import type { TxDetail, TxFillRecord } from "@/lib/api";
import { HashLink, CopyButton } from "@/components/HashLink";

// ---------------------------------------------------------------------------
// Helpers (kept local — explorer page has its own copies; we deliberately
// don't import from there to avoid pulling its 1200-line dependency tree)
// ---------------------------------------------------------------------------

const TICKS_PER_DOLLAR = 1000;

function ticksToDollars(ticks: number): string {
  return `$${(ticks / TICKS_PER_DOLLAR).toFixed(2)}`;
}

function truncAddr(a: string | undefined): string {
  if (!a) return "—";
  if (a.length <= 13) return a;
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}

function relativeTime(tsMs: number): string {
  const diff = Date.now() - tsMs;
  if (diff < 0) return "just now";
  if (diff < 5_000) return "just now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function absoluteTime(tsMs: number): string {
  return new Date(tsMs).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

// ---------------------------------------------------------------------------
// Payload classification + per-kind formatter (mirrors explorer/page.tsx
// helpers but defensively typed for `unknown`).
// ---------------------------------------------------------------------------

type PayloadObj = Record<string, Record<string, unknown>>;

function getPayloadKind(payload: unknown, fallback?: string): string {
  if (fallback) return fallback;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const keys = Object.keys(payload as PayloadObj);
    if (keys.length > 0) return keys[0];
  }
  return "Unknown";
}

function getPayloadInner(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object") return null;
  const keys = Object.keys(payload as PayloadObj);
  if (keys.length === 0) return null;
  const inner = (payload as PayloadObj)[keys[0]];
  return (inner ?? {}) as Record<string, unknown>;
}

function payloadColor(kind: string, side?: string): string {
  switch (kind) {
    case "PlaceOrder":
      return side === "Buy" ? "var(--yes)" : "var(--no)";
    case "CancelOrder":
    case "CancelAllOrders":
      return "var(--warning)";
    case "BridgeDeposit":
      return "var(--info)";
    case "BridgeWithdraw":
    case "CreateMarket":
    case "UpdateMarket":
      return "var(--accent)";
    case "ResolveMarket":
      return "#A78BFA";
    case "Faucet":
      return "var(--yes)";
    default:
      return "var(--text-secondary)";
  }
}

function payloadBg(kind: string, side?: string): string {
  switch (kind) {
    case "PlaceOrder":
      return side === "Buy" ? "var(--yes-dim)" : "var(--no-dim)";
    case "CancelOrder":
    case "CancelAllOrders":
      return "var(--warning-dim)";
    case "BridgeDeposit":
      return "var(--info-dim)";
    case "BridgeWithdraw":
    case "CreateMarket":
    case "UpdateMarket":
      return "var(--accent-dim)";
    case "ResolveMarket":
      return "rgba(167, 139, 250, 0.12)";
    case "Faucet":
      return "var(--yes-dim)";
    default:
      return "var(--bg-elevated)";
  }
}

/** One-line human summary, used in the header. */
function describePayload(kind: string, inner: Record<string, unknown> | null): string {
  if (!inner) return kind;
  switch (kind) {
    case "PlaceOrder": {
      const side = String(inner.side ?? "");
      const tif = inner.time_in_force === "IOC" ? " IOC" : "";
      const outcome = side === "Buy" ? "YES" : "NO";
      return `${side} ${inner.quantity} ${outcome} @ ${ticksToDollars(Number(inner.price))} on market #${inner.market_id}${tif}`;
    }
    case "CancelOrder":
      return `Cancel order #${inner.order_id}`;
    case "CancelAllOrders":
      return `Cancel all orders on market #${inner.market_id}`;
    case "CreateMarket":
      return `Create: "${inner.question}"`;
    case "ResolveMarket":
      return `Resolve market #${inner.market_id} as ${inner.outcome}`;
    case "MergeRedeem":
      return `Redeem ${inner.quantity} pairs on market #${inner.market_id}`;
    case "BridgeDeposit":
      return `Deposit ${ticksToDollars(Number(inner.amount))} from Arbitrum`;
    case "BridgeWithdraw":
      return `Withdraw ${ticksToDollars(Number(inner.amount))}`;
    case "Transfer":
      return `Transfer ${ticksToDollars(Number(inner.amount))} → ${truncAddr(String(inner.to))}`;
    case "Faucet":
      return `Faucet ${ticksToDollars(Number(inner.amount))} → ${truncAddr(String(inner.to))}`;
    case "ApproveSessionKey":
      return `Approve session key ${truncAddr(String(inner.session_key_address))} ("${inner.label}")`;
    case "RevokeSessionKey":
      return `Revoke session key ${truncAddr(String(inner.session_key_address))}`;
    case "UpdateMarket":
      return `Update market #${inner.market_id}: "${inner.question}"`;
    case "WithdrawalFinalized":
      return `Withdrawal #${inner.withdrawal_id} finalized`;
    case "WithdrawalRefunded":
      return `Withdrawal #${inner.withdrawal_id} refunded: ${inner.reason}`;
    default:
      return kind;
  }
}

// ---------------------------------------------------------------------------
// Generic detail row (matches the look of explorer's DetailRow).
// ---------------------------------------------------------------------------

function DetailRow({
  label,
  children,
  mono,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 text-xs py-1">
      <span
        className="w-32 shrink-0 text-right"
        style={{
          color: "var(--text-tertiary)",
          fontFamily: "var(--font-sans)",
        }}
      >
        {label}
      </span>
      <span
        className="break-all flex items-center gap-1 flex-1 min-w-0"
        style={{
          color: "var(--text-primary)",
          fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)",
        }}
      >
        {children}
      </span>
    </div>
  );
}

function Section({
  title,
  children,
  meta,
}: {
  title: string;
  children: React.ReactNode;
  meta?: React.ReactNode;
}) {
  return (
    <div
      className="rounded-lg p-5 mb-4"
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border-default)",
      }}
    >
      <div
        className="flex items-center justify-between mb-3"
        style={{ borderBottom: "1px solid var(--border-default)", paddingBottom: 8 }}
      >
        <h2
          className="text-[10px] uppercase tracking-widest"
          style={{
            color: "var(--text-tertiary)",
            fontFamily: "var(--font-sans)",
            fontWeight: 600,
          }}
        >
          {title}
        </h2>
        {meta}
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-payload formatter
// ---------------------------------------------------------------------------

function PayloadFormatter({
  kind,
  inner,
}: {
  kind: string;
  inner: Record<string, unknown> | null;
}) {
  if (!inner) {
    return (
      <div className="text-xs italic" style={{ color: "var(--text-tertiary)" }}>
        No payload data available
      </div>
    );
  }

  const rows: { label: string; value: React.ReactNode; mono?: boolean }[] = [];

  switch (kind) {
    case "PlaceOrder": {
      const side = String(inner.side);
      rows.push({ label: "Action", value: `${side} order` });
      rows.push({ label: "Market", value: `#${inner.market_id}` });
      rows.push({
        label: "Price",
        value: `${ticksToDollars(Number(inner.price))} (${inner.price} ticks)`,
        mono: true,
      });
      rows.push({ label: "Quantity", value: `${inner.quantity} shares`, mono: true });
      rows.push({
        label: "Notional",
        value: ticksToDollars(Number(inner.price) * Number(inner.quantity)),
        mono: true,
      });
      rows.push({ label: "Time in Force", value: String(inner.time_in_force ?? "GTC") });
      break;
    }
    case "CancelOrder":
      rows.push({ label: "Order ID", value: `#${inner.order_id}`, mono: true });
      break;
    case "CancelAllOrders":
      rows.push({ label: "Market", value: `#${inner.market_id}`, mono: true });
      break;
    case "BridgeDeposit":
      rows.push({ label: "To", value: <HashLink hash={String(inner.to)} link={false} />, mono: true });
      rows.push({
        label: "Amount",
        value: ticksToDollars(Number(inner.amount)),
        mono: true,
      });
      rows.push({
        label: "Arbitrum Tx",
        value: <HashLink hash={String(inner.arbitrum_tx_hash)} link={false} />,
        mono: true,
      });
      break;
    case "BridgeWithdraw":
      rows.push({
        label: "Amount",
        value: ticksToDollars(Number(inner.amount)),
        mono: true,
      });
      break;
    case "CreateMarket":
      rows.push({ label: "Question", value: String(inner.question) });
      if (inner.parent_market_id != null) {
        rows.push({ label: "Parent Market", value: `#${inner.parent_market_id}` });
      }
      if (inner.parent_outcome != null) {
        rows.push({ label: "Parent Outcome", value: String(inner.parent_outcome) });
      }
      break;
    case "ResolveMarket":
      rows.push({ label: "Market", value: `#${inner.market_id}`, mono: true });
      rows.push({ label: "Outcome", value: String(inner.outcome) });
      break;
    case "MergeRedeem":
      rows.push({ label: "Market", value: `#${inner.market_id}`, mono: true });
      rows.push({ label: "Quantity", value: `${inner.quantity} pairs`, mono: true });
      rows.push({
        label: "Value",
        value: ticksToDollars(Number(inner.quantity) * TICKS_PER_DOLLAR),
        mono: true,
      });
      break;
    case "Transfer":
      rows.push({ label: "To", value: <HashLink hash={String(inner.to)} link={false} />, mono: true });
      rows.push({
        label: "Amount",
        value: ticksToDollars(Number(inner.amount)),
        mono: true,
      });
      break;
    case "Faucet":
      rows.push({ label: "To", value: <HashLink hash={String(inner.to)} link={false} />, mono: true });
      rows.push({
        label: "Amount",
        value: ticksToDollars(Number(inner.amount)),
        mono: true,
      });
      break;
    case "UpdateMarket":
      rows.push({ label: "Market", value: `#${inner.market_id}`, mono: true });
      rows.push({ label: "New Question", value: String(inner.question) });
      break;
    case "WithdrawalFinalized":
      rows.push({
        label: "Withdrawal ID",
        value: `#${inner.withdrawal_id}`,
        mono: true,
      });
      rows.push({
        label: "Arbitrum Tx",
        value: <HashLink hash={String(inner.arbitrum_tx_hash)} link={false} />,
        mono: true,
      });
      break;
    case "WithdrawalRefunded":
      rows.push({
        label: "Withdrawal ID",
        value: `#${inner.withdrawal_id}`,
        mono: true,
      });
      rows.push({ label: "Reason", value: String(inner.reason) });
      break;
    case "ApproveSessionKey":
      rows.push({
        label: "Session Key",
        value: <HashLink hash={String(inner.session_key_address)} link={false} />,
        mono: true,
      });
      rows.push({ label: "Label", value: String(inner.label) });
      if (inner.expires_at != null) {
        rows.push({
          label: "Expires",
          value: absoluteTime(Number(inner.expires_at)),
        });
      }
      break;
    case "RevokeSessionKey":
      rows.push({
        label: "Session Key",
        value: <HashLink hash={String(inner.session_key_address)} link={false} />,
        mono: true,
      });
      break;
    default:
      // Unknown payload: fall through to JSON dump.
      break;
  }

  if (rows.length === 0) {
    return (
      <pre
        className="text-[11px] overflow-x-auto rounded p-3"
        style={{
          background: "var(--bg-elevated)",
          color: "var(--text-secondary)",
          fontFamily: "var(--font-mono)",
        }}
      >
        {JSON.stringify(inner, null, 2)}
      </pre>
    );
  }

  return (
    <div className="grid gap-1">
      {rows.map((r, i) => (
        <DetailRow key={i} label={r.label} mono={r.mono}>
          {r.value}
        </DetailRow>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fills table
// ---------------------------------------------------------------------------

function FillsTable({
  fills,
  signer,
  blockTimestamp,
}: {
  fills: TxFillRecord[];
  signer: string | undefined;
  blockTimestamp: number | undefined;
}) {
  const me = signer?.toLowerCase();
  return (
    <div className="overflow-x-auto">
      <div
        className="grid text-[10px] uppercase tracking-widest pb-2 mb-1"
        style={{
          gridTemplateColumns: "0.7fr 0.7fr 0.7fr 1.4fr 1fr 0.6fr",
          gap: 8,
          color: "var(--text-tertiary)",
          borderBottom: "1px solid var(--border-default)",
          fontFamily: "var(--font-sans)",
        }}
      >
        <span>Side</span>
        <span style={{ textAlign: "right" }}>Price</span>
        <span style={{ textAlign: "right" }}>Qty</span>
        <span>Counterparty</span>
        <span style={{ textAlign: "right" }}>Notional</span>
        <span style={{ textAlign: "right" }}>Fee</span>
      </div>
      {fills.map((f, i) => {
        const counterparty =
          f.counterparty ??
          (me && f.buyer.toLowerCase() === me ? f.seller : f.buyer);
        const notional = f.price * f.quantity;
        const isBuy = f.taker_side === "Buy";
        return (
          <div
            key={i}
            className="grid items-center text-xs py-1.5"
            style={{
              gridTemplateColumns: "0.7fr 0.7fr 0.7fr 1.4fr 1fr 0.6fr",
              gap: 8,
              borderBottom: "1px solid var(--border-default)",
              fontFamily: "var(--font-mono)",
              color: "var(--text-primary)",
            }}
            title={blockTimestamp ? absoluteTime(blockTimestamp) : undefined}
          >
            <span
              style={{
                color: isBuy ? "var(--yes)" : "var(--no)",
                fontFamily: "var(--font-sans)",
                fontWeight: 600,
                fontSize: 11,
              }}
            >
              {isBuy ? "BUY" : "SELL"}
            </span>
            <span style={{ textAlign: "right" }}>{ticksToDollars(f.price)}</span>
            <span style={{ textAlign: "right" }}>{f.quantity}</span>
            <span>
              <HashLink hash={counterparty} link={false} />
            </span>
            <span style={{ textAlign: "right" }}>{ticksToDollars(notional)}</span>
            <span style={{ textAlign: "right", opacity: 0.7 }}>
              {ticksToDollars(f.taker_fee)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

interface PageProps {
  params: Promise<{ hash: string }>;
}

export default function TxDetailPage({ params }: PageProps) {
  const { hash: rawHash } = usePromise(params);
  const hash = rawHash.startsWith("0x") ? rawHash.toLowerCase() : `0x${rawHash.toLowerCase()}`;

  const [tx, setTx] = useState<TxDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showRawPayload, setShowRawPayload] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    async function load() {
      try {
        const detail = await api.getTxDetail(hash);
        if (cancelled) return;
        setTx(detail);
        setError(null);
        setLoading(false);

        // If still pending, poll every 1s. The chain finalises in <500ms
        // so this loop normally completes in 1-2 iterations.
        if (detail.status === "pending" || detail.status === "unknown") {
          if (!interval) {
            interval = setInterval(load, 1000);
          }
        } else if (interval) {
          clearInterval(interval);
          interval = null;
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [hash]);

  const inner = useMemo(() => getPayloadInner(tx?.payload), [tx?.payload]);
  const kind = useMemo(
    () => getPayloadKind(tx?.payload, undefined),
    [tx?.payload],
  );
  const side = inner?.side ? String(inner.side) : undefined;

  // ----- Header status badge -----
  const status = tx?.status ?? "unknown";
  const statusColor = (() => {
    switch (status) {
      case "confirmed":
        return { bg: "var(--yes-dim)", fg: "var(--yes)" };
      case "failed":
        return { bg: "var(--no-dim)", fg: "var(--no)" };
      case "pending":
        return { bg: "var(--warning-dim)", fg: "var(--warning)" };
      default:
        return { bg: "var(--bg-elevated)", fg: "var(--text-tertiary)" };
    }
  })();

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      {/* ----- Back link ----- */}
      <div className="mb-4">
        <Link
          href="/explorer"
          className="text-[11px] uppercase tracking-widest"
          style={{
            color: "var(--text-tertiary)",
            fontFamily: "var(--font-sans)",
            textDecoration: "none",
          }}
        >
          ← Back to Explorer
        </Link>
      </div>

      {/* ----- Header card ----- */}
      <div
        className="rounded-lg p-5 mb-4"
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border-default)",
        }}
      >
        <div className="flex items-center gap-3 mb-2 flex-wrap">
          <span
            className="text-[10px] uppercase tracking-widest"
            style={{
              color: "var(--text-tertiary)",
              fontFamily: "var(--font-sans)",
            }}
          >
            Transaction
          </span>
          <span
            className="text-[10px] font-medium px-2 py-0.5 rounded uppercase tracking-wide"
            style={{
              background: payloadBg(kind, side),
              color: payloadColor(kind, side),
            }}
          >
            {kind}
          </span>
          <span
            className="text-[10px] font-medium px-2 py-0.5 rounded uppercase tracking-wide"
            style={{
              background: statusColor.bg,
              color: statusColor.fg,
            }}
          >
            {status}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="text-sm break-all"
            style={{
              fontFamily: "var(--font-mono)",
              color: "var(--text-primary)",
            }}
          >
            {hash}
          </span>
          <CopyButton text={hash} size={14} />
        </div>

        {inner && (
          <div
            className="mt-3 text-xs"
            style={{
              color: "var(--text-secondary)",
              fontFamily: "var(--font-sans)",
            }}
          >
            {describePayload(kind, inner)}
          </div>
        )}
      </div>

      {/* ----- Loading / error ----- */}
      {loading && !tx && (
        <div
          className="rounded-lg p-8 text-center text-xs"
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-default)",
            color: "var(--text-tertiary)",
          }}
        >
          Loading transaction…
        </div>
      )}

      {error && (
        <div
          className="rounded-lg p-5 mb-4 text-xs"
          style={{
            background: "var(--no-dim)",
            border: "1px solid var(--no)",
            color: "var(--no)",
            fontFamily: "var(--font-mono)",
          }}
        >
          Failed to load tx: {error}
        </div>
      )}

      {tx && (
        <>
          {/* ----- Overview ----- */}
          <Section title="Overview">
            <div className="grid gap-1">
              <DetailRow label="Block">
                {tx.block_height != null ? (
                  <span style={{ fontFamily: "var(--font-mono)" }}>
                    #{tx.block_height.toLocaleString()}
                  </span>
                ) : (
                  <span style={{ color: "var(--text-tertiary)" }}>pending</span>
                )}
              </DetailRow>
              {tx.timestamp != null && (
                <DetailRow label="Time">
                  <span>
                    {absoluteTime(tx.timestamp)}{" "}
                    <span
                      style={{
                        color: "var(--text-tertiary)",
                        marginLeft: 6,
                      }}
                    >
                      ({relativeTime(tx.timestamp)})
                    </span>
                  </span>
                </DetailRow>
              )}
              {tx.signer && (
                <DetailRow label="Signer" mono>
                  <HashLink hash={tx.signer} link={false} />
                </DetailRow>
              )}
              {tx.nonce != null && (
                <DetailRow label="Nonce" mono>
                  <span>{tx.nonce}</span>
                </DetailRow>
              )}
              <DetailRow label="Payload Kind">
                <span>{kind}</span>
              </DetailRow>
            </div>
          </Section>

          {/* ----- Payload ----- */}
          <Section
            title="Payload"
            meta={
              tx.payload != null ? (
                <button
                  onClick={() => setShowRawPayload((s) => !s)}
                  className="text-[10px] uppercase tracking-widest"
                  style={{
                    color: "var(--text-tertiary)",
                    fontFamily: "var(--font-sans)",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  {showRawPayload ? "Hide raw JSON" : "Show raw JSON"}
                </button>
              ) : null
            }
          >
            {tx.payload == null ? (
              <div
                className="text-xs italic"
                style={{ color: "var(--text-tertiary)" }}
              >
                Chain endpoint did not return a payload (legacy /tx/{"{hash}"} response).
              </div>
            ) : showRawPayload ? (
              <pre
                className="text-[11px] overflow-x-auto rounded p-3"
                style={{
                  background: "var(--bg-elevated)",
                  color: "var(--text-secondary)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {JSON.stringify(tx.payload, null, 2)}
              </pre>
            ) : (
              <PayloadFormatter kind={kind} inner={inner} />
            )}
          </Section>

          {/* ----- Receipt ----- */}
          <Section title="Receipt">
            <div className="grid gap-1">
              <DetailRow label="Status">
                <span style={{ color: statusColor.fg, fontWeight: 500 }}>
                  {status}
                </span>
              </DetailRow>
              {tx.error && (
                <DetailRow label="Error">
                  <span
                    style={{
                      color: "var(--no)",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {tx.error}
                  </span>
                </DetailRow>
              )}
              <DetailRow label="Events">
                {tx.events && tx.events.length > 0 ? (
                  <span>
                    {tx.events.length} event{tx.events.length === 1 ? "" : "s"}
                  </span>
                ) : (
                  <span style={{ color: "var(--text-tertiary)" }}>none</span>
                )}
              </DetailRow>
            </div>

            {tx.events && tx.events.length > 0 && (
              <details className="mt-3">
                <summary
                  className="text-[10px] uppercase tracking-widest cursor-pointer"
                  style={{
                    color: "var(--text-tertiary)",
                    fontFamily: "var(--font-sans)",
                  }}
                >
                  View events
                </summary>
                <pre
                  className="text-[11px] overflow-x-auto rounded p-3 mt-2"
                  style={{
                    background: "var(--bg-elevated)",
                    color: "var(--text-secondary)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {JSON.stringify(tx.events, null, 2)}
                </pre>
              </details>
            )}
          </Section>

          {/* ----- Fills (PlaceOrder only) ----- */}
          {tx.fills && tx.fills.length > 0 && (
            <Section
              title={`Fills (${tx.fills.length})`}
              meta={
                <span
                  className="text-[10px] uppercase tracking-widest"
                  style={{
                    color: "var(--text-tertiary)",
                    fontFamily: "var(--font-sans)",
                  }}
                >
                  trades produced by this tx
                </span>
              }
            >
              <FillsTable
                fills={tx.fills}
                signer={tx.signer}
                blockTimestamp={tx.timestamp}
              />
            </Section>
          )}

          {kind === "PlaceOrder" && (!tx.fills || tx.fills.length === 0) && status === "confirmed" && (
            <Section title="Fills">
              <div
                className="text-xs italic"
                style={{ color: "var(--text-tertiary)" }}
              >
                No fills — order rested on the book or was an unfilled IOC.
              </div>
            </Section>
          )}
        </>
      )}
    </div>
  );
}
