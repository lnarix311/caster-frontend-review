/**
 * EIP-712 signing utilities for Caster transactions.
 *
 * These types and domain MUST match the Rust implementation in
 * crates/predx-chain/src/eip712.rs exactly.
 */

import type { WalletClient } from "viem";
import { bridgeChain } from "./wallet-config";

// ---------------------------------------------------------------------------
// Domain
// ---------------------------------------------------------------------------

// Uses the bridge chain's ID (Arbitrum Sepolia = 421614) so wallets sign
// without network-switch prompts; chain-side `chain_id_to_numeric` maps
// `caster-testnet-1` to the same id. Mirrors Hyperliquid's pattern.
export const CASTER_DOMAIN = {
  name: "Caster" as const,
  version: "1" as const,
  chainId: BigInt(bridgeChain.id),
} as const;

/**
 * Separate EIP-712 domain for BridgeWithdraw signing.
 *
 * Uses the bridge chain's ID (Arbitrum Sepolia = 421614) so that wallets
 * (MetaMask/Rabby) can sign without switching networks. This mirrors how
 * Hyperliquid uses Arbitrum's chainId (42161) for their withdrawal domain.
 */
const BRIDGE_WITHDRAW_DOMAIN = {
  name: "CasterBridge" as const,
  version: "1" as const,
  chainId: BigInt(bridgeChain.id), // 421614 (Arbitrum Sepolia)
} as const;

// ---------------------------------------------------------------------------
// EIP-712 type definitions (one per TxPayload variant)
// ---------------------------------------------------------------------------

/**
 * Legacy PlaceOrder EIP-712 type (Good-Til-Cancelled only).
 *
 * Kept for backwards compatibility with already-signed GTC orders and
 * pre-IOC wallets. The chain routes `TimeInForce::GTC` through this type
 * so existing signatures and SDKs continue to work unchanged.
 */
export const PlaceOrderTypes = {
  PlaceOrder: [
    { name: "marketId", type: "uint256" },
    { name: "side", type: "string" },
    { name: "price", type: "uint256" },
    { name: "quantity", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

/**
 * Extended PlaceOrder EIP-712 type with `timeInForce` field.
 *
 * Used for Immediate-or-Cancel (IOC / Fill-and-Kill) orders. The chain
 * uses this type only when `timeInForce != 0` (GTC), so wallets that still
 * use `PlaceOrderTypes` continue producing valid GTC signatures.
 *
 * timeInForce encoding: `0 = GTC`, `1 = IOC`.
 */
export const PlaceOrderTifTypes = {
  PlaceOrder: [
    { name: "marketId", type: "uint256" },
    { name: "side", type: "string" },
    { name: "price", type: "uint256" },
    { name: "quantity", type: "uint256" },
    { name: "timeInForce", type: "uint8" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export type TimeInForce = "GTC" | "IOC";

/** Convert a TimeInForce tag to its canonical uint8 representation. */
export function timeInForceToU8(tif: TimeInForce): 0 | 1 {
  return tif === "IOC" ? 1 : 0;
}

export const CancelOrderTypes = {
  CancelOrder: [
    { name: "orderId", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

const CreateMarketTypes = {
  CreateMarket: [
    { name: "question", type: "string" },
    { name: "conditionId", type: "string" },
    { name: "parentMarketId", type: "uint256" },
    { name: "parentOutcome", type: "string" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

const ResolveMarketTypes = {
  ResolveMarket: [
    { name: "marketId", type: "uint256" },
    { name: "outcome", type: "string" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

const TransferTypes = {
  Transfer: [
    { name: "to", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export const MergeRedeemTypes = {
  MergeRedeem: [
    { name: "marketId", type: "uint256" },
    { name: "quantity", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

const UpdateMarketTypes = {
  UpdateMarket: [
    { name: "marketId", type: "uint256" },
    { name: "question", type: "string" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

const BridgeWithdrawTypes = {
  BridgeWithdraw: [
    { name: "amount", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

// Session key management types
const ApproveSessionKeyTypes = {
  ApproveSessionKey: [
    { name: "sessionKeyAddress", type: "address" },
    { name: "label", type: "string" },
    { name: "expiresAt", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

const RevokeSessionKeyTypes = {
  RevokeSessionKey: [
    { name: "sessionKeyAddress", type: "address" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

// ---------------------------------------------------------------------------
// Signing functions
// ---------------------------------------------------------------------------

export async function signPlaceOrder(
  walletClient: WalletClient,
  params: {
    marketId: number;
    side: "Buy" | "Sell";
    price: number;
    quantity: number;
    nonce: number;
    /**
     * Optional time-in-force policy. Defaults to `"GTC"` for backwards
     * compatibility with pre-IOC wallets. When set to `"IOC"`, the order
     * fills immediately and any unfilled remainder is cancelled instead
     * of resting on the book.
     */
    timeInForce?: TimeInForce;
  },
): Promise<`0x${string}`> {
  const tif: TimeInForce = params.timeInForce ?? "GTC";

  // GTC orders use the legacy PlaceOrder type so historical signatures and
  // older SDKs remain compatible. IOC orders use the extended type that
  // includes the uint8 `timeInForce` field.
  if (tif === "GTC") {
    return walletClient.signTypedData({
      account: walletClient.account!,
      domain: CASTER_DOMAIN,
      types: PlaceOrderTypes,
      primaryType: "PlaceOrder",
      message: {
        marketId: BigInt(params.marketId),
        side: params.side,
        price: BigInt(params.price),
        quantity: BigInt(params.quantity),
        nonce: BigInt(params.nonce),
      },
    });
  }

  return walletClient.signTypedData({
    account: walletClient.account!,
    domain: CASTER_DOMAIN,
    types: PlaceOrderTifTypes,
    primaryType: "PlaceOrder",
    message: {
      marketId: BigInt(params.marketId),
      side: params.side,
      price: BigInt(params.price),
      quantity: BigInt(params.quantity),
      timeInForce: timeInForceToU8(tif),
      nonce: BigInt(params.nonce),
    },
  });
}

export async function signCancelOrder(
  walletClient: WalletClient,
  params: { orderId: number; nonce: number },
): Promise<`0x${string}`> {
  return walletClient.signTypedData({
    account: walletClient.account!,
    domain: CASTER_DOMAIN,
    types: CancelOrderTypes,
    primaryType: "CancelOrder",
    message: {
      orderId: BigInt(params.orderId),
      nonce: BigInt(params.nonce),
    },
  });
}

export async function signCreateMarket(
  walletClient: WalletClient,
  params: {
    question: string;
    conditionId?: string;
    parentMarketId?: number;
    parentOutcome?: string;
    nonce: number;
  },
): Promise<`0x${string}`> {
  return walletClient.signTypedData({
    account: walletClient.account!,
    domain: CASTER_DOMAIN,
    types: CreateMarketTypes,
    primaryType: "CreateMarket",
    message: {
      question: params.question,
      conditionId: params.conditionId ?? "",
      parentMarketId: BigInt(params.parentMarketId ?? 0),
      parentOutcome: params.parentOutcome ?? "",
      nonce: BigInt(params.nonce),
    },
  });
}

export async function signResolveMarket(
  walletClient: WalletClient,
  params: {
    marketId: number;
    outcome: "Yes" | "No" | "Unknown";
    nonce: number;
  },
): Promise<`0x${string}`> {
  return walletClient.signTypedData({
    account: walletClient.account!,
    domain: CASTER_DOMAIN,
    types: ResolveMarketTypes,
    primaryType: "ResolveMarket",
    message: {
      marketId: BigInt(params.marketId),
      outcome: params.outcome,
      nonce: BigInt(params.nonce),
    },
  });
}

export async function signTransfer(
  walletClient: WalletClient,
  params: { to: `0x${string}`; amount: number; nonce: number },
): Promise<`0x${string}`> {
  return walletClient.signTypedData({
    account: walletClient.account!,
    domain: CASTER_DOMAIN,
    types: TransferTypes,
    primaryType: "Transfer",
    message: {
      to: params.to,
      amount: BigInt(params.amount),
      nonce: BigInt(params.nonce),
    },
  });
}

export async function signMergeRedeem(
  walletClient: WalletClient,
  params: { marketId: number; quantity: number; nonce: number },
): Promise<`0x${string}`> {
  return walletClient.signTypedData({
    account: walletClient.account!,
    domain: CASTER_DOMAIN,
    types: MergeRedeemTypes,
    primaryType: "MergeRedeem",
    message: {
      marketId: BigInt(params.marketId),
      quantity: BigInt(params.quantity),
      nonce: BigInt(params.nonce),
    },
  });
}

export async function signUpdateMarket(
  walletClient: WalletClient,
  params: { marketId: number; question: string; nonce: number },
): Promise<`0x${string}`> {
  return walletClient.signTypedData({
    account: walletClient.account!,
    domain: CASTER_DOMAIN,
    types: UpdateMarketTypes,
    primaryType: "UpdateMarket",
    message: {
      marketId: BigInt(params.marketId),
      question: params.question,
      nonce: BigInt(params.nonce),
    },
  });
}

/**
 * Sign a BridgeWithdraw using the bridge domain (CasterBridge + bridge chainId).
 *
 * The domain uses the bridge chain's ID (e.g. 421614 for Arbitrum Sepolia)
 * which matches the wallet's current chain. This means viem's standard
 * `walletClient.signTypedData()` works without any raw provider hacks --
 * the wallet will not reject the signing request due to a chain ID mismatch.
 *
 * This mirrors Hyperliquid's approach: they use Arbitrum's chainId (42161)
 * in their withdrawal EIP-712 domain.
 */
export async function signBridgeWithdraw(
  walletClient: WalletClient,
  params: { amount: number; nonce: number },
): Promise<`0x${string}`> {
  return walletClient.signTypedData({
    account: walletClient.account!,
    domain: BRIDGE_WITHDRAW_DOMAIN,
    types: BridgeWithdrawTypes,
    primaryType: "BridgeWithdraw",
    message: {
      amount: BigInt(params.amount),
      nonce: BigInt(params.nonce),
    },
  });
}

// ---------------------------------------------------------------------------
// Session key signing (wallet-based, for approve/revoke)
// ---------------------------------------------------------------------------

export async function signApproveSessionKey(
  walletClient: WalletClient,
  params: {
    sessionKeyAddress: `0x${string}`;
    label: string;
    expiresAt: number;
    nonce: number;
  },
): Promise<`0x${string}`> {
  return walletClient.signTypedData({
    account: walletClient.account!,
    domain: BRIDGE_WITHDRAW_DOMAIN,
    types: ApproveSessionKeyTypes,
    primaryType: "ApproveSessionKey",
    message: {
      sessionKeyAddress: params.sessionKeyAddress,
      label: params.label,
      expiresAt: BigInt(params.expiresAt),
      nonce: BigInt(params.nonce),
    },
  });
}

export async function signRevokeSessionKey(
  walletClient: WalletClient,
  params: {
    sessionKeyAddress: `0x${string}`;
    nonce: number;
  },
): Promise<`0x${string}`> {
  return walletClient.signTypedData({
    account: walletClient.account!,
    domain: BRIDGE_WITHDRAW_DOMAIN,
    types: RevokeSessionKeyTypes,
    primaryType: "RevokeSessionKey",
    message: {
      sessionKeyAddress: params.sessionKeyAddress,
      nonce: BigInt(params.nonce),
    },
  });
}

// ---------------------------------------------------------------------------
// Transaction submission
// ---------------------------------------------------------------------------

/**
 * Build the JSON payload and submit a pre-signed transaction to the chain.
 *
 * The chain expects:
 * {
 *   "from": "0x...",           // 20-byte address, 0x-prefixed hex
 *   "nonce": 42,               // u64
 *   "payload": { ... },        // TxPayload enum variant (serde tagged)
 *   "signature": "0x..."       // 65-byte sig, 0x-prefixed hex
 * }
 */
export async function submitSignedTx(
  from: `0x${string}`,
  nonce: number,
  payload: TxPayloadJson,
  signature: `0x${string}`,
): Promise<{ tx_hash: string; status: string }> {
  const res = await fetch("/api/tx/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from, nonce, payload, signature }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TX submit failed (${res.status}): ${text}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Payload JSON types (matching Rust TxPayload serde representation)
// ---------------------------------------------------------------------------

export type TxPayloadJson =
  | {
      PlaceOrder: {
        market_id: number;
        side: "Buy" | "Sell";
        price: number;
        quantity: number;
        /**
         * Optional. Omit (or send `"GTC"`) for default Good-Til-Cancelled
         * behaviour. Set to `"IOC"` for Immediate-or-Cancel / Fill-and-Kill
         * orders that must not rest on the book if they under-fill.
         * The chain treats missing field as GTC.
         */
        time_in_force?: "GTC" | "IOC";
      };
    }
  | { CancelOrder: { order_id: number } }
  | { CreateMarket: { question: string; condition_id: string | null; parent_market_id: number | null; parent_outcome: string | null } }
  | { ResolveMarket: { market_id: number; outcome: "Yes" | "No" | "Unknown" } }
  | { Transfer: { to: string; amount: number } }
  | { MergeRedeem: { market_id: number; quantity: number } }
  | { UpdateMarket: { market_id: number; question: string } }
  | { BridgeWithdraw: { amount: number } }
  | { ApproveSessionKey: { session_key_address: string; label: string; expires_at: number } }
  | { RevokeSessionKey: { session_key_address: string } };
