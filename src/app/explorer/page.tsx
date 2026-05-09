"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useWs } from "@/providers/WebSocketProvider";
import * as api from "@/lib/api";
import type { RecentTxSummary } from "@/lib/api";
import { HashLink } from "@/components/HashLink";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChainStatus {
  chain: string;
  height: number;
  latest_hash: string;
  block_time_ms: number;
  cancel_priority: boolean;
}

/** Full block from /api/block/{height}/full */
interface FullBlock {
  height: number;
  timestamp: number; // millis since epoch
  prev_hash: string;
  hash: string;
  state_root: string;
  transactions: RawTransaction[];
}

/** Serialized transaction from the chain */
interface RawTransaction {
  from: string;
  nonce: number;
  payload: TxPayload;
  signature: string;
}

/** All possible transaction payload variants */
type TxPayload =
  | { Transfer: { to: string; amount: number } }
  | { Faucet: { to: string; amount: number } }
  | {
      CreateMarket: {
        question: string;
        condition_id: string | null;
        parent_market_id: number | null;
        parent_outcome: string | null;
      };
    }
  | {
      PlaceOrder: {
        market_id: number;
        side: "Buy" | "Sell";
        price: number;
        quantity: number;
        time_in_force?: "GTC" | "IOC";
      };
    }
  | { CancelOrder: { order_id: number } }
  | { CancelAllOrders: { market_id: number } }
  | { ResolveMarket: { market_id: number; outcome: "Yes" | "No" | "Unknown" } }
  | { MergeRedeem: { market_id: number; quantity: number } }
  | { UpdateMarket: { market_id: number; question: string } }
  | {
      BridgeDeposit: {
        to: string;
        amount: number;
        arbitrum_tx_hash: string;
      };
    }
  | { BridgeWithdraw: { amount: number } }
  | {
      WithdrawalFinalized: {
        withdrawal_id: number;
        arbitrum_tx_hash: string;
      };
    }
  | { WithdrawalRefunded: { withdrawal_id: number; reason: string } }
  | {
      ApproveSessionKey: {
        session_key_address: string;
        label: string;
        expires_at: number;
      };
    }
  | { RevokeSessionKey: { session_key_address: string } };

interface MarketInfo {
  id: number;
  question: string;
  status: string;
}

/** Flattened transaction for the Transactions tab */
interface FlatTx {
  from: string;
  nonce: number;
  payload: TxPayload;
  blockHeight: number;
  blockTimestamp: number;
  blockHash: string;
  txIndex: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TICKS_PER_DOLLAR = 1000;

function ticksToDollars(ticks: number): string {
  return `$${(ticks / TICKS_PER_DOLLAR).toFixed(2)}`;
}

function truncAddr(a: string): string {
  if (a.length <= 13) return a;
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}

function truncHash(h: string): string {
  if (h.length <= 14) return h;
  return `${h.slice(0, 6)}...${h.slice(-4)}`;
}

function relativeTime(tsMs: number): string {
  const now = Date.now();
  const diff = now - tsMs;
  if (diff < 0) return "just now";
  if (diff < 5000) return "just now";
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

function getPayloadType(payload: TxPayload): string {
  return Object.keys(payload)[0];
}

/** Get the CSS color variable for a transaction type */
function getTxColor(payload: TxPayload): string {
  const type = getPayloadType(payload);
  switch (type) {
    case "PlaceOrder": {
      const data = (payload as { PlaceOrder: { side: string } }).PlaceOrder;
      return data.side === "Buy" ? "var(--yes)" : "var(--no)";
    }
    case "CancelOrder":
    case "CancelAllOrders":
      return "var(--warning)";
    case "BridgeDeposit":
      return "var(--info)";
    case "BridgeWithdraw":
      return "var(--accent)";
    case "CreateMarket":
      return "var(--accent)";
    case "ResolveMarket":
      return "#A78BFA"; // purple
    case "Faucet":
      return "var(--yes)";
    case "Transfer":
      return "var(--text-secondary)";
    case "MergeRedeem":
      return "var(--text-secondary)";
    case "WithdrawalFinalized":
    case "WithdrawalRefunded":
      return "var(--info)";
    case "UpdateMarket":
      return "var(--accent)";
    case "ApproveSessionKey":
    case "RevokeSessionKey":
      return "var(--text-secondary)";
    default:
      return "var(--text-secondary)";
  }
}

function getTxLabel(payload: TxPayload): string {
  const type = getPayloadType(payload);
  switch (type) {
    case "PlaceOrder": {
      const data = (payload as { PlaceOrder: { side: string; time_in_force?: string } }).PlaceOrder;
      const tif = data.time_in_force === "IOC" ? " (IOC)" : "";
      return data.side === "Buy" ? `Buy${tif}` : `Sell${tif}`;
    }
    case "CancelOrder":
      return "Cancel";
    case "CancelAllOrders":
      return "Cancel All";
    case "BridgeDeposit":
      return "Deposit";
    case "BridgeWithdraw":
      return "Withdraw";
    case "CreateMarket":
      return "Create Market";
    case "ResolveMarket":
      return "Resolve";
    case "Faucet":
      return "Faucet";
    case "Transfer":
      return "Transfer";
    case "MergeRedeem":
      return "Merge/Redeem";
    case "WithdrawalFinalized":
      return "Withdrawal Finalized";
    case "WithdrawalRefunded":
      return "Withdrawal Refunded";
    case "UpdateMarket":
      return "Update Market";
    case "ApproveSessionKey":
      return "Session Key";
    case "RevokeSessionKey":
      return "Revoke Key";
    default:
      return type;
  }
}

function getTxLabelBg(payload: TxPayload): string {
  const type = getPayloadType(payload);
  switch (type) {
    case "PlaceOrder": {
      const data = (payload as { PlaceOrder: { side: string } }).PlaceOrder;
      return data.side === "Buy" ? "var(--yes-dim)" : "var(--no-dim)";
    }
    case "CancelOrder":
    case "CancelAllOrders":
      return "var(--warning-dim)";
    case "BridgeDeposit":
      return "var(--info-dim)";
    case "BridgeWithdraw":
      return "var(--accent-dim)";
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

/** Build a human-readable one-line summary of a transaction */
function describeTx(
  payload: TxPayload,
  from: string,
  markets: Map<number, MarketInfo>,
): string {
  const type = getPayloadType(payload);
  const addr = truncAddr(from);

  function marketName(id: number): string {
    const m = markets.get(id);
    return m ? `"${m.question}"` : `Market #${id}`;
  }

  switch (type) {
    case "PlaceOrder": {
      const d = (payload as { PlaceOrder: { market_id: number; side: string; price: number; quantity: number; time_in_force?: string } }).PlaceOrder;
      const sideWord = d.side === "Buy" ? "placed buy order" : "placed sell order";
      const outcome = d.side === "Buy" ? "YES" : "NO";
      const tif = d.time_in_force === "IOC" ? " (IOC)" : "";
      return `${addr} ${sideWord} for ${d.quantity} ${outcome} shares of ${marketName(d.market_id)} at ${ticksToDollars(d.price)}${tif}`;
    }
    case "CancelOrder": {
      const d = (payload as { CancelOrder: { order_id: number } }).CancelOrder;
      return `${addr} cancelled order #${d.order_id}`;
    }
    case "CancelAllOrders": {
      const d = (payload as { CancelAllOrders: { market_id: number } }).CancelAllOrders;
      return `${addr} cancelled all orders on ${marketName(d.market_id)}`;
    }
    case "BridgeDeposit": {
      const d = (payload as { BridgeDeposit: { to: string; amount: number } }).BridgeDeposit;
      return `${truncAddr(d.to)} deposited ${ticksToDollars(d.amount)} from Arbitrum`;
    }
    case "BridgeWithdraw": {
      const d = (payload as { BridgeWithdraw: { amount: number } }).BridgeWithdraw;
      return `${addr} withdrew ${ticksToDollars(d.amount)}`;
    }
    case "CreateMarket": {
      const d = (payload as { CreateMarket: { question: string } }).CreateMarket;
      return `${addr} created market: "${d.question}"`;
    }
    case "ResolveMarket": {
      const d = (payload as { ResolveMarket: { market_id: number; outcome: string } }).ResolveMarket;
      return `${marketName(d.market_id)} resolved: ${d.outcome}`;
    }
    case "MergeRedeem": {
      const d = (payload as { MergeRedeem: { market_id: number; quantity: number } }).MergeRedeem;
      return `${addr} redeemed ${d.quantity} pairs on ${marketName(d.market_id)}`;
    }
    case "Transfer": {
      const d = (payload as { Transfer: { to: string; amount: number } }).Transfer;
      return `${addr} transferred ${ticksToDollars(d.amount)} to ${truncAddr(d.to)}`;
    }
    case "Faucet": {
      const d = (payload as { Faucet: { to: string; amount: number } }).Faucet;
      return `Faucet: ${ticksToDollars(d.amount)} to ${truncAddr(d.to)}`;
    }
    case "UpdateMarket": {
      const d = (payload as { UpdateMarket: { market_id: number; question: string } }).UpdateMarket;
      return `${addr} updated ${marketName(d.market_id)}: "${d.question}"`;
    }
    case "WithdrawalFinalized": {
      const d = (payload as { WithdrawalFinalized: { withdrawal_id: number; arbitrum_tx_hash: string } }).WithdrawalFinalized;
      return `Withdrawal #${d.withdrawal_id} finalized (Arb tx: ${truncHash(d.arbitrum_tx_hash)})`;
    }
    case "WithdrawalRefunded": {
      const d = (payload as { WithdrawalRefunded: { withdrawal_id: number; reason: string } }).WithdrawalRefunded;
      return `Withdrawal #${d.withdrawal_id} refunded: ${d.reason}`;
    }
    case "ApproveSessionKey": {
      const d = (payload as { ApproveSessionKey: { session_key_address: string; label: string } }).ApproveSessionKey;
      return `${addr} approved session key ${truncAddr(d.session_key_address)} (${d.label})`;
    }
    case "RevokeSessionKey": {
      const d = (payload as { RevokeSessionKey: { session_key_address: string } }).RevokeSessionKey;
      return `${addr} revoked session key ${truncAddr(d.session_key_address)}`;
    }
    default:
      return `${addr}: ${type}`;
  }
}

// ---------------------------------------------------------------------------
// CopyButton component
// ---------------------------------------------------------------------------

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [text]);

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        handleCopy();
      }}
      aria-label={`Copy ${text}`}
      className="inline-flex items-center justify-center w-5 h-5 rounded hover:bg-[var(--bg-elevated)] transition-colors"
      style={{ color: copied ? "var(--yes)" : "var(--text-tertiary)", flexShrink: 0 }}
    >
      {copied ? (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
          <path d="M3 8l3 3 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
          <rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M4 11H3.5A1.5 1.5 0 012 9.5v-7A1.5 1.5 0 013.5 1h7A1.5 1.5 0 0112 2.5V3" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Transaction detail panel
// ---------------------------------------------------------------------------

function TxDetailPanel({
  tx,
  markets,
}: {
  tx: FlatTx;
  markets: Map<number, MarketInfo>;
}) {
  const type = getPayloadType(tx.payload);

  function marketName(id: number): string {
    const m = markets.get(id);
    return m ? m.question : `Market #${id}`;
  }

  const details: { label: string; value: string; mono?: boolean }[] = [
    { label: "From", value: tx.from, mono: true },
    { label: "Nonce", value: String(tx.nonce), mono: true },
    { label: "Block", value: `#${tx.blockHeight.toLocaleString()}`, mono: true },
    { label: "Block Hash", value: tx.blockHash, mono: true },
    { label: "Time", value: absoluteTime(tx.blockTimestamp) },
    { label: "Tx Index", value: String(tx.txIndex) },
  ];

  // Add type-specific details
  switch (type) {
    case "PlaceOrder": {
      const d = (tx.payload as { PlaceOrder: { market_id: number; side: string; price: number; quantity: number; time_in_force?: string } }).PlaceOrder;
      details.push({ label: "Action", value: `${d.side} Order` });
      details.push({ label: "Market", value: marketName(d.market_id) });
      details.push({ label: "Price", value: `${ticksToDollars(d.price)} (${d.price} ticks)`, mono: true });
      details.push({ label: "Quantity", value: `${d.quantity} shares`, mono: true });
      details.push({ label: "Notional", value: ticksToDollars(d.price * d.quantity), mono: true });
      details.push({ label: "Time in Force", value: d.time_in_force || "GTC" });
      break;
    }
    case "CancelOrder": {
      const d = (tx.payload as { CancelOrder: { order_id: number } }).CancelOrder;
      details.push({ label: "Order ID", value: `#${d.order_id}`, mono: true });
      break;
    }
    case "CancelAllOrders": {
      const d = (tx.payload as { CancelAllOrders: { market_id: number } }).CancelAllOrders;
      details.push({ label: "Market", value: marketName(d.market_id) });
      break;
    }
    case "BridgeDeposit": {
      const d = (tx.payload as { BridgeDeposit: { to: string; amount: number; arbitrum_tx_hash: string } }).BridgeDeposit;
      details.push({ label: "To", value: d.to, mono: true });
      details.push({ label: "Amount", value: ticksToDollars(d.amount), mono: true });
      details.push({ label: "Arbitrum Tx", value: d.arbitrum_tx_hash, mono: true });
      break;
    }
    case "BridgeWithdraw": {
      const d = (tx.payload as { BridgeWithdraw: { amount: number } }).BridgeWithdraw;
      details.push({ label: "Amount", value: ticksToDollars(d.amount), mono: true });
      break;
    }
    case "CreateMarket": {
      const d = (tx.payload as { CreateMarket: { question: string; parent_market_id: number | null } }).CreateMarket;
      details.push({ label: "Question", value: d.question });
      if (d.parent_market_id != null) {
        details.push({ label: "Parent Market", value: marketName(d.parent_market_id) });
      }
      break;
    }
    case "ResolveMarket": {
      const d = (tx.payload as { ResolveMarket: { market_id: number; outcome: string } }).ResolveMarket;
      details.push({ label: "Market", value: marketName(d.market_id) });
      details.push({ label: "Outcome", value: d.outcome });
      break;
    }
    case "MergeRedeem": {
      const d = (tx.payload as { MergeRedeem: { market_id: number; quantity: number } }).MergeRedeem;
      details.push({ label: "Market", value: marketName(d.market_id) });
      details.push({ label: "Quantity", value: `${d.quantity} pairs`, mono: true });
      details.push({ label: "Value", value: ticksToDollars(d.quantity * TICKS_PER_DOLLAR), mono: true });
      break;
    }
    case "Transfer": {
      const d = (tx.payload as { Transfer: { to: string; amount: number } }).Transfer;
      details.push({ label: "To", value: d.to, mono: true });
      details.push({ label: "Amount", value: ticksToDollars(d.amount), mono: true });
      break;
    }
    case "Faucet": {
      const d = (tx.payload as { Faucet: { to: string; amount: number } }).Faucet;
      details.push({ label: "To", value: d.to, mono: true });
      details.push({ label: "Amount", value: ticksToDollars(d.amount), mono: true });
      break;
    }
    case "UpdateMarket": {
      const d = (tx.payload as { UpdateMarket: { market_id: number; question: string } }).UpdateMarket;
      details.push({ label: "Market", value: marketName(d.market_id) });
      details.push({ label: "New Question", value: d.question });
      break;
    }
    case "WithdrawalFinalized": {
      const d = (tx.payload as { WithdrawalFinalized: { withdrawal_id: number; arbitrum_tx_hash: string } }).WithdrawalFinalized;
      details.push({ label: "Withdrawal ID", value: `#${d.withdrawal_id}`, mono: true });
      details.push({ label: "Arbitrum Tx", value: d.arbitrum_tx_hash, mono: true });
      break;
    }
    case "WithdrawalRefunded": {
      const d = (tx.payload as { WithdrawalRefunded: { withdrawal_id: number; reason: string } }).WithdrawalRefunded;
      details.push({ label: "Withdrawal ID", value: `#${d.withdrawal_id}`, mono: true });
      details.push({ label: "Reason", value: d.reason });
      break;
    }
    case "ApproveSessionKey": {
      const d = (tx.payload as { ApproveSessionKey: { session_key_address: string; label: string; expires_at: number } }).ApproveSessionKey;
      details.push({ label: "Session Key", value: d.session_key_address, mono: true });
      details.push({ label: "Label", value: d.label });
      details.push({ label: "Expires", value: absoluteTime(d.expires_at) });
      break;
    }
    case "RevokeSessionKey": {
      const d = (tx.payload as { RevokeSessionKey: { session_key_address: string } }).RevokeSessionKey;
      details.push({ label: "Session Key", value: d.session_key_address, mono: true });
      break;
    }
  }

  return (
    <div
      className="mt-3 pt-3 grid gap-2"
      style={{ borderTop: "1px solid var(--border-default)" }}
    >
      {details.map((d, i) => (
        <div key={i} className="flex items-start gap-3 text-xs">
          <span
            className="w-28 shrink-0 text-right"
            style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-sans)" }}
          >
            {d.label}
          </span>
          <span
            className="break-all flex items-center gap-1"
            style={{
              color: "var(--text-primary)",
              fontFamily: d.mono ? "var(--font-mono)" : "var(--font-sans)",
            }}
          >
            {d.value}
            {d.mono && d.value.length > 20 && <CopyButton text={d.value} />}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Transaction row
// ---------------------------------------------------------------------------

function TxRow({
  tx,
  markets,
}: {
  tx: FlatTx;
  markets: Map<number, MarketInfo>;
}) {
  const [expanded, setExpanded] = useState(false);
  const color = getTxColor(tx.payload);
  const label = getTxLabel(tx.payload);
  const labelBg = getTxLabelBg(tx.payload);
  const desc = describeTx(tx.payload, tx.from, markets);
  const onToggle = () => setExpanded((e) => !e);

  return (
    <div
      className="rounded-lg px-4 py-3 cursor-pointer transition-all"
      style={{
        background: expanded ? "var(--bg-surface)" : "transparent",
        border: expanded ? "1px solid var(--border-default)" : "1px solid transparent",
      }}
      onClick={onToggle}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onToggle(); }}
      aria-expanded={expanded}
    >
      <div className="flex items-center gap-3">
        {/* Type badge */}
        <span
          className="text-[10px] font-medium px-2 py-0.5 rounded shrink-0 uppercase tracking-wide"
          style={{ background: labelBg, color }}
        >
          {label}
        </span>

        {/* Description */}
        <span
          className="text-xs truncate flex-1"
          style={{ color: "var(--text-primary)", fontFamily: "var(--font-sans)" }}
        >
          {desc}
        </span>

        {/* Block height */}
        <span
          className="text-[10px] font-mono shrink-0"
          style={{ color: "var(--text-tertiary)" }}
        >
          #{tx.blockHeight.toLocaleString()}
        </span>

        {/* Timestamp */}
        <span
          className="text-[10px] shrink-0"
          style={{ color: "var(--text-tertiary)" }}
          title={absoluteTime(tx.blockTimestamp)}
        >
          {relativeTime(tx.blockTimestamp)}
        </span>
      </div>

      {expanded && <TxDetailPanel tx={tx} markets={markets} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recent-tx row (renders summary from /txs/recent and links to /explorer/tx/<hash>)
// ---------------------------------------------------------------------------

function RecentTxRow({
  tx,
  onClick,
}: {
  tx: RecentTxSummary;
  onClick: () => void;
}) {
  // Re-use the existing color/label palette by faking a payload object with
  // just the kind. For PlaceOrder we sniff Buy/Sell from the summary string
  // so the badge stays color-coded. (The proper fix is for the backend to
  // surface a `side` field on the summary; this is a small UI affordance.)
  const sniffSide = tx.payload_kind === "PlaceOrder"
    ? (tx.payload_summary.toLowerCase().includes("sell") ? "Sell" : "Buy")
    : undefined;
  const fakePayload = sniffSide
    ? ({ PlaceOrder: { side: sniffSide } } as TxPayload)
    : ({ [tx.payload_kind]: {} } as unknown as TxPayload);
  const color = getTxColor(fakePayload);
  const label = getTxLabel(fakePayload);
  const labelBg = getTxLabelBg(fakePayload);

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className="rounded-lg px-4 py-3 cursor-pointer transition-all"
      style={{
        background: "transparent",
        border: "1px solid transparent",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = "var(--bg-surface)";
        (e.currentTarget as HTMLDivElement).style.borderColor = "var(--border-default)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = "transparent";
        (e.currentTarget as HTMLDivElement).style.borderColor = "transparent";
      }}
    >
      <div className="flex items-center gap-3">
        {/* Status dot */}
        <span
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{
            background: tx.success ? "var(--yes)" : "var(--no)",
            boxShadow: tx.success ? "0 0 4px rgba(34,197,94,0.4)" : "0 0 4px rgba(239,68,68,0.4)",
          }}
          title={tx.success ? "confirmed" : "failed"}
        />
        <span
          className="text-[10px] font-medium px-2 py-0.5 rounded shrink-0 uppercase tracking-wide"
          style={{ background: labelBg, color }}
        >
          {label}
        </span>

        {/* Summary */}
        <span
          className="text-xs truncate flex-1"
          style={{ color: "var(--text-primary)", fontFamily: "var(--font-sans)" }}
        >
          {tx.payload_summary}
        </span>

        {/* Fills count badge */}
        {tx.fills_count > 0 && (
          <span
            className="text-[9px] font-medium px-1.5 py-0.5 rounded shrink-0"
            style={{
              background: "var(--accent-dim)",
              color: "var(--accent)",
              fontFamily: "var(--font-mono)",
            }}
            title={`${tx.fills_count} fill${tx.fills_count === 1 ? "" : "s"}`}
          >
            {tx.fills_count}f
          </span>
        )}

        {/* Hash */}
        <span
          className="hidden md:inline shrink-0"
          style={{ color: "var(--text-tertiary)" }}
          onClick={(e) => e.stopPropagation()}
        >
          <HashLink hash={tx.tx_hash} compact link={false} />
        </span>

        {/* Block height */}
        <span
          className="text-[10px] font-mono shrink-0"
          style={{ color: "var(--text-tertiary)" }}
        >
          #{tx.block_height.toLocaleString()}
        </span>

        {/* Timestamp */}
        <span
          className="text-[10px] shrink-0"
          style={{ color: "var(--text-tertiary)" }}
          title={absoluteTime(tx.timestamp)}
        >
          {relativeTime(tx.timestamp)}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Block row
// ---------------------------------------------------------------------------

function BlockRow({
  block,
  expanded,
  onToggle,
  markets,
}: {
  block: FullBlock;
  expanded: boolean;
  onToggle: () => void;
  markets: Map<number, MarketInfo>;
}) {
  const hasTxs = block.transactions.length > 0;
  const hasCancels = block.transactions.some((tx) => {
    const type = getPayloadType(tx.payload);
    return type === "CancelOrder" || type === "CancelAllOrders";
  });

  return (
    <div
      className="rounded-lg px-4 py-3 cursor-pointer transition-all"
      style={{
        background: expanded ? "var(--bg-surface)" : "transparent",
        border: expanded ? "1px solid var(--border-default)" : "1px solid transparent",
      }}
      onClick={onToggle}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onToggle(); }}
      aria-expanded={expanded}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {/* Block height */}
          <span
            className="text-sm font-mono"
            style={{ color: "var(--accent)" }}
          >
            #{block.height.toLocaleString()}
          </span>

          {/* Tx count */}
          {hasTxs ? (
            <span
              className="text-[10px] font-medium px-2 py-0.5 rounded"
              style={{
                background: "var(--accent-dim)",
                color: "var(--accent)",
              }}
            >
              {block.transactions.length} tx{block.transactions.length !== 1 ? "s" : ""}
            </span>
          ) : (
            <span
              className="text-[10px] px-2 py-0.5 rounded"
              style={{
                background: "var(--bg-elevated)",
                color: "var(--text-tertiary)",
              }}
            >
              empty
            </span>
          )}

          {hasCancels && (
            <span
              className="text-[10px] px-2 py-0.5 rounded"
              style={{
                background: "var(--warning-dim)",
                color: "var(--warning)",
              }}
            >
              cancel priority
            </span>
          )}
        </div>

        <div className="flex items-center gap-4">
          {/* Hash */}
          <span className="text-[10px] font-mono hidden md:inline" style={{ color: "var(--text-tertiary)" }}>
            {truncHash(block.hash)}
          </span>

          {/* Timestamp */}
          <span
            className="text-[10px]"
            style={{ color: "var(--text-tertiary)" }}
            title={absoluteTime(block.timestamp)}
          >
            {relativeTime(block.timestamp)}
          </span>
        </div>
      </div>

      {/* Expanded: show block details and transactions */}
      {expanded && (
        <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--border-default)" }}>
          {/* Block metadata */}
          <div className="grid gap-1.5 mb-3">
            <DetailRow label="Hash" value={block.hash} mono copy />
            <DetailRow label="Prev Hash" value={block.prev_hash} mono copy />
            <DetailRow label="State Root" value={block.state_root} mono copy />
            <DetailRow label="Timestamp" value={absoluteTime(block.timestamp)} />
            <DetailRow label="Transactions" value={String(block.transactions.length)} />
          </div>

          {/* Transactions in this block */}
          {block.transactions.length > 0 && (
            <div className="mt-3">
              <h4 className="text-[10px] uppercase tracking-widest mb-2" style={{ color: "var(--text-tertiary)" }}>
                Transactions
              </h4>
              <div className="space-y-1">
                {block.transactions.map((tx, i) => {
                  const color = getTxColor(tx.payload);
                  const label = getTxLabel(tx.payload);
                  const labelBg = getTxLabelBg(tx.payload);
                  const desc = describeTx(tx.payload, tx.from, markets);

                  return (
                    <div
                      key={i}
                      className="flex items-center gap-2 py-1.5 px-2 rounded text-xs"
                      style={{ background: "var(--bg-elevated)" }}
                    >
                      <span className="text-[10px] font-mono w-4 text-center" style={{ color: "var(--text-tertiary)" }}>
                        {i}
                      </span>
                      <span
                        className="text-[9px] font-medium px-1.5 py-0.5 rounded uppercase tracking-wide shrink-0"
                        style={{ background: labelBg, color }}
                      >
                        {label}
                      </span>
                      <span className="font-mono text-[10px]" style={{ color: "var(--text-tertiary)" }}>
                        {truncAddr(tx.from)}
                      </span>
                      <span className="truncate flex-1" style={{ color: "var(--text-primary)", fontFamily: "var(--font-sans)", fontSize: 11 }}>
                        {desc}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {block.transactions.length === 0 && (
            <div className="text-xs text-center py-2" style={{ color: "var(--text-tertiary)" }}>
              Empty block (heartbeat)
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono,
  copy,
}: {
  label: string;
  value: string;
  mono?: boolean;
  copy?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 text-xs">
      <span
        className="w-20 shrink-0 text-right"
        style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-sans)" }}
      >
        {label}
      </span>
      <span
        className="break-all flex items-center gap-1"
        style={{
          color: "var(--text-primary)",
          fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)",
        }}
      >
        {value}
        {copy && <CopyButton text={value} />}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pagination component
// ---------------------------------------------------------------------------

function Pagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (p: number) => void;
}) {
  if (totalPages <= 1) return null;

  // Show up to 5 page buttons centered around current page
  const start = Math.max(1, page - 2);
  const end = Math.min(totalPages, start + 4);
  const pages: number[] = [];
  for (let i = start; i <= end; i++) pages.push(i);

  return (
    <div className="flex items-center justify-center gap-1 mt-4">
      <button
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        className="text-xs px-2 py-1 rounded transition-colors"
        aria-label="Previous page"
        style={{
          color: page <= 1 ? "var(--text-tertiary)" : "var(--text-secondary)",
          background: "transparent",
          border: "1px solid var(--border-default)",
          cursor: page <= 1 ? "not-allowed" : "pointer",
          opacity: page <= 1 ? 0.4 : 1,
        }}
      >
        Prev
      </button>

      {pages.map((p) => (
        <button
          key={p}
          onClick={() => onPageChange(p)}
          className="text-xs w-8 h-8 rounded transition-colors font-mono"
          style={{
            color: p === page ? "var(--accent)" : "var(--text-secondary)",
            background: p === page ? "var(--accent-dim)" : "transparent",
            border: p === page ? "1px solid var(--accent)" : "1px solid transparent",
            cursor: "pointer",
            fontWeight: p === page ? 600 : 400,
          }}
        >
          {p}
        </button>
      ))}

      <button
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        className="text-xs px-2 py-1 rounded transition-colors"
        aria-label="Next page"
        style={{
          color: page >= totalPages ? "var(--text-tertiary)" : "var(--text-secondary)",
          background: "transparent",
          border: "1px solid var(--border-default)",
          cursor: page >= totalPages ? "not-allowed" : "pointer",
          opacity: page >= totalPages ? 0.4 : 1,
        }}
      >
        Next
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function SkeletonRow() {
  return (
    <div
      className="rounded-lg px-4 py-3 animate-pulse"
      style={{ background: "var(--bg-surface)" }}
    >
      <div className="flex items-center gap-3">
        <div className="w-14 h-4 rounded" style={{ background: "var(--bg-elevated)" }} />
        <div className="flex-1 h-3 rounded" style={{ background: "var(--bg-elevated)" }} />
        <div className="w-16 h-3 rounded" style={{ background: "var(--bg-elevated)" }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page Component
// ---------------------------------------------------------------------------

const BLOCKS_PER_PAGE = 20;
const TXS_PER_PAGE = 25;

export default function ExplorerPage() {
  const router = useRouter();
  const { addListener } = useWs();
  const [status, setStatus] = useState<ChainStatus | null>(null);
  const [blocks, setBlocks] = useState<FullBlock[]>([]);
  const [markets, setMarkets] = useState<Map<number, MarketInfo>>(new Map());
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"transactions" | "blocks">("transactions");
  const [blockPage, setBlockPage] = useState(1);
  const [txPage, setTxPage] = useState(1);
  const [expandedBlock, setExpandedBlock] = useState<number | null>(null);
  const [live, setLive] = useState(true);
  const liveRef = useRef(live);
  liveRef.current = live;
  const blocksRef = useRef<FullBlock[]>([]);
  blocksRef.current = blocks;
  const initialLoadDone = useRef(false);

  // Recent txs from the new GET /txs/recent endpoint. When this returns data
  // we render it directly in the Transactions tab (cheaper + includes tx_hash
  // for each row, enabling row-click navigation to /explorer/tx/<hash>).
  // When the endpoint isn't available yet (chain-engineer's patch pending),
  // `recentTxsAvailable` flips false and we fall back to the legacy
  // block-walking flow that flattens transactions out of `blocks`.
  const [recentTxs, setRecentTxs] = useState<RecentTxSummary[]>([]);
  const [recentTxsAvailable, setRecentTxsAvailable] = useState<boolean | null>(null);
  const recentTxsRef = useRef<RecentTxSummary[]>([]);
  recentTxsRef.current = recentTxs;

  // Fetch chain status
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/status");
      const data: ChainStatus = await res.json();
      setStatus(data);
      return data.height;
    } catch {
      return null;
    }
  }, []);

  // Fetch a full block
  const fetchBlock = useCallback(async (height: number): Promise<FullBlock | null> => {
    try {
      const res = await fetch(`/api/block/${height}/full`);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }, []);

  // Fetch recent txs from /txs/recent. Returns true if the endpoint is
  // wired, false if the request 404'd (chain-engineer hasn't shipped yet).
  const fetchRecentTxs = useCallback(async (): Promise<boolean> => {
    try {
      const txs = await api.getRecentTxs(50);
      setRecentTxs(txs);
      setRecentTxsAvailable(true);
      return true;
    } catch (e) {
      // 404 means the endpoint isn't deployed yet; degrade silently.
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("404") || msg.includes("Not Found")) {
        setRecentTxsAvailable(false);
      }
      return false;
    }
  }, []);

  // Initial fetch + subscribe to WS for trade-driven refetches
  useEffect(() => {
    let mounted = true;

    fetchRecentTxs();

    // Trade events on any market trigger a refetch (debounced) so the LIVE
    // indicator surfaces new txs without polling.
    let pending: ReturnType<typeof setTimeout> | null = null;
    const unsub = addListener((msg) => {
      if (!mounted || !liveRef.current) return;
      if (msg.type === "trade" || msg.type === "order_accepted") {
        if (pending) return;
        pending = setTimeout(() => {
          pending = null;
          if (mounted && liveRef.current) fetchRecentTxs();
        }, 400);
      }
    });

    // Periodic poll as a safety net (in case of missed WS events)
    const interval = setInterval(() => {
      if (mounted && liveRef.current) fetchRecentTxs();
    }, 3000);

    return () => {
      mounted = false;
      unsub();
      if (pending) clearTimeout(pending);
      clearInterval(interval);
    };
  }, [fetchRecentTxs, addListener]);

  // Fetch all markets for name resolution
  useEffect(() => {
    async function loadMarkets() {
      try {
        const res = await fetch("/api/markets");
        const data: { id: number; question: string; status: string }[] = await res.json();
        const map = new Map<number, MarketInfo>();
        for (const m of data) {
          map.set(m.id, m);
        }
        setMarkets(map);
      } catch {
        // Markets are optional, explorer still works without names
      }
    }
    loadMarkets();
  }, []);

  // Initial load + live polling
  useEffect(() => {
    let mounted = true;

    const loadBlocks = async () => {
      setLoading(true);
      const height = await fetchStatus();
      if (height === null || !mounted) return;

      // Fetch last 50 blocks using full endpoint
      const promises: Promise<FullBlock | null>[] = [];
      const startHeight = Math.max(height - 49, 0);
      for (let h = height; h >= startHeight; h--) {
        promises.push(fetchBlock(h));
      }
      const results = await Promise.all(promises);
      if (!mounted) return;

      const newBlocks = results.filter((b): b is FullBlock => b !== null);
      newBlocks.sort((a, b) => b.height - a.height);
      setBlocks(newBlocks);
      setLoading(false);
      initialLoadDone.current = true;
    };

    loadBlocks();

    // Poll every 2s for new blocks
    const interval = setInterval(async () => {
      if (!liveRef.current || !mounted || !initialLoadDone.current) return;
      const height = await fetchStatus();
      if (height === null || !mounted) return;

      const maxHeight = blocksRef.current.length > 0 ? blocksRef.current[0].height : 0;
      if (height <= maxHeight) return;

      const toFetch = Math.min(height - maxHeight, 10);
      const promises: Promise<FullBlock | null>[] = [];
      for (let h = height; h > height - toFetch; h--) {
        promises.push(fetchBlock(h));
      }
      const fetched = await Promise.all(promises);
      if (!mounted) return;

      const valid = fetched.filter((b): b is FullBlock => b !== null);
      setBlocks((prev) => {
        const existing = new Set(prev.map((b) => b.height));
        const merged = [...valid.filter((b) => !existing.has(b.height)), ...prev];
        merged.sort((a, b) => b.height - a.height);
        return merged.slice(0, 100); // Keep last 100 blocks
      });
    }, 2000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [fetchStatus, fetchBlock]);

  // Flatten all transactions from all loaded blocks
  const allTxs = useMemo((): FlatTx[] => {
    const txs: FlatTx[] = [];
    for (const block of blocks) {
      for (let i = 0; i < block.transactions.length; i++) {
        const tx = block.transactions[i];
        txs.push({
          from: tx.from,
          nonce: tx.nonce,
          payload: tx.payload,
          blockHeight: block.height,
          blockTimestamp: block.timestamp,
          blockHash: block.hash,
          txIndex: i,
        });
      }
    }
    // Already sorted by block height (descending), then by tx index (ascending within block)
    return txs;
  }, [blocks]);

  // Prefer the dedicated /txs/recent endpoint when available; fall back
  // to walking blocks only when the endpoint is known-unavailable.
  const useRecent = recentTxsAvailable === true;

  // Compute pagination
  const totalBlockPages = Math.max(1, Math.ceil(blocks.length / BLOCKS_PER_PAGE));
  const totalTxPages = useRecent
    ? Math.max(1, Math.ceil(recentTxs.length / TXS_PER_PAGE))
    : Math.max(1, Math.ceil(allTxs.length / TXS_PER_PAGE));

  const paginatedBlocks = useMemo(() => {
    const start = (blockPage - 1) * BLOCKS_PER_PAGE;
    return blocks.slice(start, start + BLOCKS_PER_PAGE);
  }, [blocks, blockPage]);

  const paginatedTxs = useMemo(() => {
    const start = (txPage - 1) * TXS_PER_PAGE;
    return allTxs.slice(start, start + TXS_PER_PAGE);
  }, [allTxs, txPage]);

  const paginatedRecentTxs = useMemo(() => {
    const start = (txPage - 1) * TXS_PER_PAGE;
    return recentTxs.slice(start, start + TXS_PER_PAGE);
  }, [recentTxs, txPage]);

  // Clamp pages when data changes
  useEffect(() => {
    if (blockPage > totalBlockPages) setBlockPage(totalBlockPages);
  }, [blockPage, totalBlockPages]);
  useEffect(() => {
    if (txPage > totalTxPages) setTxPage(totalTxPages);
  }, [txPage, totalTxPages]);

  // Count non-empty blocks and total transactions for stats
  const txCount = useRecent ? recentTxs.length : allTxs.length;
  const nonEmptyBlocks = blocks.filter((b) => b.transactions.length > 0).length;

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      {/* Chain Status Banner */}
      {status && (
        <div
          className="rounded-lg p-5 mb-6"
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-default)",
          }}
        >
          <div className="flex items-center justify-between mb-4">
            <h1
              className="text-lg"
              style={{
                fontFamily: "var(--font-serif)",
                color: "var(--text-primary)",
                fontWeight: 400,
              }}
            >
              Block Explorer
            </h1>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setLive(!live)}
                className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest px-3 py-1 rounded-full transition-colors"
                style={{
                  background: live ? "var(--yes-dim)" : "var(--bg-elevated)",
                  color: live ? "var(--yes)" : "var(--text-tertiary)",
                  border: `1px solid ${live ? "rgba(34,197,94,0.2)" : "var(--border-default)"}`,
                  cursor: "pointer",
                  fontFamily: "var(--font-sans)",
                  fontWeight: 500,
                }}
                aria-label={live ? "Pause live updates" : "Resume live updates"}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{
                    background: live ? "var(--yes)" : "var(--text-tertiary)",
                    boxShadow: live ? "0 0 4px rgba(34,197,94,0.5)" : "none",
                  }}
                />
                {live ? "Live" : "Paused"}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <StatCard label="Chain" value={status.chain} />
            <StatCard label="Height" value={status.height.toLocaleString()} mono />
            <StatCard label="Block Time" value={`${status.block_time_ms}ms`} />
            <StatCard label="Blocks Loaded" value={`${nonEmptyBlocks} / ${blocks.length}`} />
            <StatCard label="Transactions" value={txCount.toLocaleString()} accent />
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-0 mb-4" style={{ borderBottom: "1px solid var(--border-default)" }}>
        <TabButton
          active={tab === "transactions"}
          onClick={() => { setTab("transactions"); setTxPage(1); }}
          label="Transactions"
        />
        <TabButton
          active={tab === "blocks"}
          onClick={() => { setTab("blocks"); setBlockPage(1); }}
          label="Blocks"
        />
      </div>

      {/* Content */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      ) : tab === "transactions" ? (
        <>
          {useRecent ? (
            paginatedRecentTxs.length === 0 ? (
              <div className="text-center py-12" style={{ color: "var(--text-tertiary)" }}>
                <p className="text-sm">No recent transactions</p>
              </div>
            ) : (
              <div className="space-y-1">
                {paginatedRecentTxs.map((tx) => (
                  <RecentTxRow
                    key={tx.tx_hash}
                    tx={tx}
                    onClick={() => router.push(`/explorer/tx/${tx.tx_hash}`)}
                  />
                ))}
              </div>
            )
          ) : paginatedTxs.length === 0 ? (
            <div className="text-center py-12" style={{ color: "var(--text-tertiary)" }}>
              <p className="text-sm">No transactions found in recent blocks</p>
              {recentTxsAvailable === false && (
                <p className="text-xs mt-2 opacity-60">
                  /txs/recent endpoint not deployed; falling back to block walk
                </p>
              )}
            </div>
          ) : (
            // Legacy fallback: block-walked txs (no per-tx hash, no link).
            // Once chain-engineer's /txs/recent ships everywhere this branch
            // becomes dead code and can be removed.
            <div className="space-y-1">
              {paginatedTxs.map((tx) => {
                const key = `${tx.blockHeight}-${tx.txIndex}`;
                return (
                  <TxRow
                    key={key}
                    tx={tx}
                    markets={markets}
                  />
                );
              })}
            </div>
          )}
          <Pagination page={txPage} totalPages={totalTxPages} onPageChange={setTxPage} />
        </>
      ) : (
        <>
          {paginatedBlocks.length === 0 ? (
            <div className="text-center py-12" style={{ color: "var(--text-tertiary)" }}>
              <p className="text-sm">No blocks loaded yet</p>
            </div>
          ) : (
            <div className="space-y-1">
              {paginatedBlocks.map((block) => (
                <BlockRow
                  key={block.height}
                  block={block}
                  expanded={expandedBlock === block.height}
                  onToggle={() =>
                    setExpandedBlock(expandedBlock === block.height ? null : block.height)
                  }
                  markets={markets}
                />
              ))}
            </div>
          )}
          <Pagination page={blockPage} totalPages={totalBlockPages} onPageChange={setBlockPage} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  mono,
  accent,
}: {
  label: string;
  value: string;
  mono?: boolean;
  accent?: boolean;
}) {
  return (
    <div>
      <div
        className="text-[10px] uppercase tracking-widest mb-0.5"
        style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-sans)", fontWeight: 500 }}
      >
        {label}
      </div>
      <div
        className="text-sm"
        style={{
          color: accent ? "var(--accent)" : "var(--text-primary)",
          fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)",
          fontWeight: 400,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className="relative px-4 py-2.5 text-xs uppercase tracking-widest transition-colors"
      style={{
        fontFamily: "var(--font-sans)",
        fontWeight: active ? 600 : 400,
        color: active ? "var(--text-primary)" : "var(--text-tertiary)",
        background: "transparent",
        border: "none",
        cursor: "pointer",
        borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
        marginBottom: "-1px",
      }}
    >
      {label}
    </button>
  );
}
