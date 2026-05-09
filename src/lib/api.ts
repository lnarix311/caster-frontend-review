import type { Market, MarketId, Side, AccountTradeRecord, MarketPriceInfo, EnrichedOrder, ChainPosition } from "./types";
import type { WalletClient } from "viem";
import {
  signPlaceOrder,
  signCancelOrder,
  signCreateMarket,
  signResolveMarket,
  signMergeRedeem,
  signBridgeWithdraw,
  signApproveSessionKey,
  signRevokeSessionKey,
  submitSignedTx,
  PlaceOrderTypes,
  PlaceOrderTifTypes,
  CancelOrderTypes,
  MergeRedeemTypes,
} from "./signing";
import {
  getSessionKeyForOwner,
  signTypedDataWithSessionKey,
  type SessionKeyInfo,
} from "./session-key";

const BASE = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json();
}

// --- Transaction Receipt Polling ---

export interface TxReceipt {
  tx_hash: string;
  status: "confirmed" | "failed" | "pending" | "unknown";
  block_height: number | null;
  error: string | null;
  events: unknown[] | null;
}

/**
 * Lightweight tx summary returned by `GET /txs/recent?limit=N`.
 *
 * NOTE: This endpoint is being added by chain-engineer in parallel with this
 * frontend work. Until the chain ships it, `getRecentTxs` will throw and
 * callers should fall back to walking blocks via `/block/{height}/full`.
 *
 * Field names mirror the API contract:
 *   - `tx_hash`         -- 0x-prefixed sha256 of the tx
 *   - `block_height`    -- block where the tx was included
 *   - `timestamp`       -- millis since epoch (block timestamp)
 *   - `signer`          -- 0x-prefixed signer address
 *   - `payload_kind`    -- enum variant name (e.g. "PlaceOrder")
 *   - `payload_summary` -- one-line description for list display
 *   - `success`         -- receipt success flag
 *   - `fills_count`     -- number of trades produced by this tx (0 for non-PlaceOrder)
 */
export interface RecentTxSummary {
  tx_hash: string;
  block_height: number;
  timestamp: number;
  signer: string;
  payload_kind: string;
  payload_summary: string;
  success: boolean;
  fills_count: number;
}

/**
 * Fetch the N most recent transactions from the chain.
 *
 * TODO(chain-engineer): backend endpoint pending. Returns 404 today; the
 * caller is expected to catch and fall back to walking blocks. Once the
 * chain ships `/txs/recent`, this becomes the primary path for the
 * Transactions tab on /explorer.
 */
export async function getRecentTxs(limit = 50): Promise<RecentTxSummary[]> {
  return request<RecentTxSummary[]>(`/txs/recent?limit=${limit}`);
}

/**
 * Full transaction detail (extends the existing receipt with payload + fills).
 *
 * `payload` is the raw TxPayload variant the chain stored. `fills` is only
 * populated for PlaceOrder txs that matched against the book.
 *
 * TODO(chain-engineer): the existing `/tx/{hash}` returns just the receipt
 * fields (tx_hash/status/block_height/error/events). Chain-engineer is
 * extending it in-place to additionally surface `signer`, `nonce`,
 * `timestamp`, `payload`, and `fills`. Until that ships the extra fields
 * will be undefined and the detail page will degrade gracefully.
 */
export interface TxDetail extends TxReceipt {
  signer?: string;
  nonce?: number;
  timestamp?: number;
  payload?: unknown;
  fills?: TxFillRecord[];
}

export interface TxFillRecord {
  maker_order_id: number;
  taker_order_id: number;
  market_id: number;
  price: number;
  quantity: number;
  buyer: string;
  seller: string;
  taker_side: "Buy" | "Sell";
  taker_fee: number;
  maker_rebate: number;
  /** Counterparty for the *taker* (= maker address). Convenience field. */
  counterparty?: string;
}

/** Fetch full transaction detail by hash. */
export async function getTxDetail(hash: string): Promise<TxDetail> {
  return request<TxDetail>(`/tx/${hash}`);
}

/**
 * Poll the chain for a transaction receipt until it is confirmed or failed.
 *
 * The chain processes blocks every ~200ms, so most transactions confirm
 * within 1-2 polls. We poll every 300ms with a default timeout of 10s.
 *
 * @throws Error if the transaction fails on-chain or times out.
 */
export async function waitForTx(
  txHash: string,
  options?: { timeoutMs?: number; intervalMs?: number },
): Promise<TxReceipt> {
  const timeout = options?.timeoutMs ?? 10_000;
  const interval = options?.intervalMs ?? 300;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const receipt = await request<TxReceipt>(`/tx/${txHash}`);

    if (receipt.status === "confirmed") {
      return receipt;
    }

    if (receipt.status === "failed") {
      throw new Error(receipt.error ?? "Transaction failed on-chain");
    }

    // Still pending or unknown -- wait and retry
    await new Promise((r) => setTimeout(r, interval));
  }

  throw new Error("Transaction confirmation timed out (10s)");
}

// --- Account ---

export async function getAccount(address: string): Promise<{ balance: number; nonce: number }> {
  return request(`/account/${address}`);
}

export async function claimFaucet(address: string, amount = 1_000_000): Promise<void> {
  await request("/faucet", {
    method: "POST",
    body: JSON.stringify({ address, amount }),
  });
  // Wait for tx inclusion
  await new Promise((r) => setTimeout(r, 500));
}

// --- Markets ---

export async function listMarkets(): Promise<Market[]> {
  const raw = await request<{ id: number; question: string; status: string; parent_market_id: number | null; parent_outcome: string | null; image_url?: string | null; resolves_at?: number | null }[]>("/markets");
  return raw.map((m) => ({
    id: String(m.id),
    question: m.question,
    status: parseStatus(m.status),
    creator: "",
    parent_market_id: m.parent_market_id ?? null,
    parent_outcome: m.parent_outcome ?? null,
    image_url: m.image_url ?? null,
    resolves_at: m.resolves_at ?? null,
  }));
}

function parseStatus(s: string): Market["status"] {
  if (s === "Open") return "Open";
  if (s === "Closed") return "Closed";
  return "Resolved";
}

export async function getMarket(marketId: MarketId): Promise<Market & { status_raw: string }> {
  const m = await request<{ id: number; question: string; status: string; creator: string; created_at_block: number; parent_market_id: number | null; parent_outcome: string | null; image_url?: string | null; resolves_at?: number | null }>(
    `/market/${marketId}`
  );
  return {
    id: String(m.id),
    question: m.question,
    status: parseStatus(m.status),
    status_raw: m.status,
    creator: m.creator,
    parent_market_id: m.parent_market_id ?? null,
    parent_outcome: m.parent_outcome ?? null,
    image_url: m.image_url ?? null,
    resolves_at: m.resolves_at ?? null,
  };
}

/**
 * Create a new prediction market via EIP-712 signed transaction.
 */
export async function createMarket(
  walletClient: WalletClient,
  address: `0x${string}`,
  question: string,
  parentMarketId?: number,
  parentOutcome?: string,
) {
  const { nonce } = await getAccount(address);
  const signature = await signCreateMarket(walletClient, {
    question,
    parentMarketId,
    parentOutcome,
    nonce,
  });
  return submitSignedTx(address, nonce, {
    CreateMarket: {
      question,
      condition_id: null,
      parent_market_id: parentMarketId ?? null,
      parent_outcome: parentOutcome ?? null,
    },
  }, signature);
}

/**
 * Resolve a market via EIP-712 signed transaction.
 */
export async function resolveMarket(
  walletClient: WalletClient,
  address: `0x${string}`,
  marketId: number,
  outcome: "Yes" | "No" | "Unknown",
) {
  const { nonce } = await getAccount(address);
  const signature = await signResolveMarket(walletClient, {
    marketId,
    outcome,
    nonce,
  });
  return submitSignedTx(address, nonce, {
    ResolveMarket: { market_id: marketId, outcome },
  }, signature);
}

// --- Orders ---

/**
 * Place a limit order via EIP-712 signed transaction.
 *
 * When an active session key exists for this address, the order is signed
 * locally (instant, no wallet popup). Otherwise falls back to wallet signing.
 *
 * Supports both GTC (default) and IOC (Immediate-or-Cancel / Fill-and-Kill).
 * IOC orders fill immediately against the book and cancel any unfilled
 * remainder -- they never rest on the book. Use IOC for "market orders".
 */
export async function placeOrder(
  walletClient: WalletClient | null,
  address: `0x${string}`,
  params: {
    market_id: number;
    side: Side;
    price: number;
    quantity: number;
    /** `"GTC"` (default, resting) or `"IOC"` (fill-and-kill). */
    time_in_force?: "GTC" | "IOC";
  },
) {
  const { nonce } = await getAccount(address);
  const sessionKey = getSessionKeyForOwner(address);
  const tif: "GTC" | "IOC" = params.time_in_force ?? "GTC";

  let signature: `0x${string}`;
  if (sessionKey) {
    // GTC routes through the legacy PlaceOrder type (no timeInForce field).
    // IOC routes through the extended PlaceOrderTif type with uint8 timeInForce.
    if (tif === "GTC") {
      signature = signTypedDataWithSessionKey(
        PlaceOrderTypes,
        "PlaceOrder",
        {
          marketId: BigInt(params.market_id),
          side: params.side,
          price: BigInt(params.price),
          quantity: BigInt(params.quantity),
          nonce: BigInt(nonce),
        },
      );
    } else {
      signature = signTypedDataWithSessionKey(
        PlaceOrderTifTypes,
        "PlaceOrder",
        {
          marketId: BigInt(params.market_id),
          side: params.side,
          price: BigInt(params.price),
          quantity: BigInt(params.quantity),
          timeInForce: 1, // IOC
          nonce: BigInt(nonce),
        },
      );
    }
  } else {
    if (!walletClient) {
      throw new Error("No wallet connected and no session key active");
    }
    signature = await signPlaceOrder(walletClient, {
      marketId: params.market_id,
      side: params.side,
      price: params.price,
      quantity: params.quantity,
      nonce,
      timeInForce: tif,
    });
  }

  // For GTC we omit time_in_force from the JSON body so the chain's
  // `#[serde(default)]` handler produces identical binary-canonical hashes
  // to pre-IOC transactions. IOC orders include the explicit field.
  const placeOrderBody: {
    market_id: number;
    side: Side;
    price: number;
    quantity: number;
    time_in_force?: "GTC" | "IOC";
  } = {
    market_id: params.market_id,
    side: params.side,
    price: params.price,
    quantity: params.quantity,
  };
  if (tif === "IOC") {
    placeOrderBody.time_in_force = "IOC";
  }

  return submitSignedTx(
    address,
    nonce,
    { PlaceOrder: placeOrderBody },
    signature,
  );
}

/**
 * Cancel an order via EIP-712 signed transaction.
 *
 * Uses session key for instant signing when available.
 */
export async function cancelOrder(
  walletClient: WalletClient | null,
  address: `0x${string}`,
  orderId: number,
) {
  const { nonce } = await getAccount(address);
  const sessionKey = getSessionKeyForOwner(address);

  let signature: `0x${string}`;
  if (sessionKey) {
    signature = signTypedDataWithSessionKey(
      CancelOrderTypes,
      "CancelOrder",
      {
        orderId: BigInt(orderId),
        nonce: BigInt(nonce),
      },
    );
  } else {
    if (!walletClient) {
      throw new Error("No wallet connected and no session key active");
    }
    signature = await signCancelOrder(walletClient, { orderId, nonce });
  }

  return submitSignedTx(address, nonce, {
    CancelOrder: { order_id: orderId },
  }, signature);
}

// --- Positions ---

export async function getPositions(address: string): Promise<ChainPosition[]> {
  return request<ChainPosition[]>(
    `/account/${address}/positions`
  );
}

// --- Account Trades ---

export async function getAccountTrades(address: string): Promise<AccountTradeRecord[]> {
  return request<AccountTradeRecord[]>(`/account/${address}/trades`);
}

// --- Lifetime Account Stats (added 2026-04-24, chain task #21) ---
//
// Re-exported from ./lifetime-api for back-compat with callers that import
// these symbols from `@/lib/api`. The implementation lives in a sibling
// module (free of viem/signing imports) so unit tests can mock fetch
// without dragging the wallet stack in. New callers should import from
// `@/lib/lifetime-api` directly.

export {
  getLifetimeStats,
  getLifetimeFills,
  getEquityCurve,
  EQUITY_CURVE_PENDING_TAG,
} from "./lifetime-api";
export type {
  LifetimeStats,
  LifetimeFill,
  LifetimeFillsCursor,
  LifetimeFillsPage,
  EquityCurveSnapshot,
  EquityCurveResponse,
  EquityCurveResult,
} from "./lifetime-api";

// --- Bulk Market Prices ---

export async function getMarketPrices(): Promise<{ markets: MarketPriceInfo[] }> {
  return request<{ markets: MarketPriceInfo[] }>("/markets/prices");
}

// --- Enriched Orders ---

export async function getAccountOrders(address: string): Promise<EnrichedOrder[]> {
  return request<EnrichedOrder[]>(`/account/${address}/orders`);
}

// --- Orderbook (REST fallback) ---

export async function getOrderbook(marketId: MarketId) {
  return request<{
    market_id: number;
    bids: { order_id: number; owner: string; price: number; remaining: number }[];
    asks: { order_id: number; owner: string; price: number; remaining: number }[];
  }>(`/market/${marketId}/orderbook`);
}

// --- Trades & Stats ---

export interface TradeRecord {
  maker_order_id: number;
  taker_order_id: number;
  price: number;
  quantity: number;
  /** Buyer address (0x-prefixed). Optional because the WS migration will have
   * connected clients receiving a mix of old and new events during rollout;
   * REST callers should treat this as always-present in practice. */
  buyer?: string | null;
  /** Seller address (0x-prefixed). See `buyer` above. */
  seller?: string | null;
  block_height: number;
  taker_fee: number;
  maker_rebate: number;
  taker_side: "Buy" | "Sell";
  /** Hash of the taker tx that produced this fill. Optional until
   * chain-engineer's back-reference patch lands. */
  taker_tx_hash?: string;
}

export interface MarketStats {
  market_id: number;
  total_trades: number;
  total_volume: number;
  total_notional: number;
  unique_traders: number;
  vwap: number;
  last_price: number | null;
  high_price: number | null;
  low_price: number | null;
  buy_volume: number;
  sell_volume: number;
  total_taker_fees: number;
  total_maker_rebates: number;
}

export async function getTrades(marketId: string | number): Promise<TradeRecord[]> {
  return request<TradeRecord[]>(`/market/${marketId}/trades`);
}

export async function getMarketStats(marketId: string | number): Promise<MarketStats> {
  return request<MarketStats>(`/market/${marketId}/stats`);
}

// --- Candles & Recent Trades ---

export interface CandleRecord {
  time: number;   // UNIX timestamp in seconds
  open: number;   // price in ticks (0-1000)
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Fetch OHLCV candle data for a market.
 *
 * @param marketId  Market ID
 * @param resolution  Candle resolution: "1m", "5m", "15m", "1h", "4h"
 * @param from  Optional start time (UNIX seconds)
 * @param to  Optional end time (UNIX seconds)
 */
export async function getCandles(
  marketId: string | number,
  resolution: string,
  from?: number,
  to?: number,
): Promise<CandleRecord[]> {
  const params = new URLSearchParams({ resolution });
  if (from != null) params.set("from", String(from));
  if (to != null) params.set("to", String(to));
  return request<CandleRecord[]>(`/market/${marketId}/candles?${params.toString()}`);
}

/**
 * Lightweight trade record returned by GET /market/{id}/trades/recent.
 * Matches the backend's `RecentTradeResponse` struct.
 */
export interface RecentTradeRecord {
  price: number;
  quantity: number;
  side: string;
  /** Milliseconds since epoch */
  timestamp: number;
  /** Taker tx hash (added by chain-engineer in parallel — optional until shipped). */
  taker_tx_hash?: string;
  /** Buyer address (0x-prefixed). Optional during the backend rollout — absent
   * on older records, present once chain-engineer's extension ships. */
  buyer?: string | null;
  /** Seller address (0x-prefixed). See `buyer` above. */
  seller?: string | null;
}

/**
 * Fetch recent trades for a market (most recent first).
 *
 * @param marketId  Market ID
 * @param limit  Max number of trades to return (default 50)
 */
export async function getRecentTrades(
  marketId: string | number,
  limit = 50,
): Promise<RecentTradeRecord[]> {
  return request<RecentTradeRecord[]>(`/market/${marketId}/trades/recent?limit=${limit}`);
}

// --- Merge/Redeem ---

/**
 * Merge-redeem YES+NO share pairs back to collateral.
 *
 * Uses session key for instant signing when available.
 */
export async function mergeRedeem(
  walletClient: WalletClient | null,
  address: `0x${string}`,
  marketId: number,
  quantity: number,
) {
  const { nonce } = await getAccount(address);
  const sessionKey = getSessionKeyForOwner(address);

  let signature: `0x${string}`;
  if (sessionKey) {
    signature = signTypedDataWithSessionKey(
      MergeRedeemTypes,
      "MergeRedeem",
      {
        marketId: BigInt(marketId),
        quantity: BigInt(quantity),
        nonce: BigInt(nonce),
      },
    );
  } else {
    if (!walletClient) {
      throw new Error("No wallet connected and no session key active");
    }
    signature = await signMergeRedeem(walletClient, {
      marketId,
      quantity,
      nonce,
    });
  }

  return submitSignedTx(address, nonce, {
    MergeRedeem: { market_id: marketId, quantity },
  }, signature);
}

// --- Bridge ---

export interface BridgeStatus {
  tvl: number;
  pending_count: number;
}

export interface WithdrawalRecord {
  id: number;
  from: string;
  amount: number;
  fee: number;
  block_height: number;
  timestamp: number; // millis since epoch (0 for pre-migration records)
  status: string; // "Pending" | "Finalized" | "Refunded"
  arbitrum_tx_hash: string | null;
}

export interface DepositRecord {
  id: number;
  to: string;
  amount: number;
  block_height: number;
  timestamp: number; // millis since epoch (0 for pre-migration records)
  arbitrum_tx_hash: string;
}

export async function getBridgeStatus(): Promise<BridgeStatus> {
  return request<BridgeStatus>("/bridge/status");
}

/**
 * Submit a BridgeWithdraw transaction signed on the bridge domain.
 *
 * Uses the CasterBridge EIP-712 domain with the bridge chain's ID
 * (e.g. 421614 for Arbitrum Sepolia). Since the domain chainId matches
 * the wallet's current chain, viem's standard signTypedData works
 * without any raw provider workarounds.
 *
 * @param walletClient Viem WalletClient from the connected wallet
 * @param address User's Ethereum address
 * @param amount Amount in ticks (1000 ticks = $1)
 */
export async function bridgeWithdraw(
  walletClient: WalletClient,
  address: `0x${string}`,
  amount: number,
): Promise<{ tx_hash: string; status: string }> {
  const { nonce } = await getAccount(address);
  const signature = await signBridgeWithdraw(walletClient, { amount, nonce });
  return submitSignedTx(address, nonce, { BridgeWithdraw: { amount } }, signature);
}

export async function getWithdrawals(address: string): Promise<WithdrawalRecord[]> {
  return request<WithdrawalRecord[]>(`/bridge/withdrawals/${address}`);
}

export async function getDeposits(address: string): Promise<DepositRecord[]> {
  return request<DepositRecord[]>(`/bridge/deposits/${address}`);
}

// --- Session Keys ---

/**
 * Fetch active session keys for an account.
 */
export async function getSessionKeys(address: string): Promise<SessionKeyInfo[]> {
  return request<SessionKeyInfo[]>(`/session-keys/${address}`);
}

/**
 * Approve a session key -- sign with wallet and submit to chain.
 *
 * Returns the tx_hash immediately after submission. The caller should
 * use `waitForTx(tx_hash)` to verify on-chain confirmation before
 * storing the session key locally.
 */
export async function signAndSubmitApproveSessionKey(
  walletClient: WalletClient,
  address: `0x${string}`,
  sessionKeyAddress: `0x${string}`,
  label: string,
  expiresAt: number,
): Promise<{ tx_hash: string }> {
  const { nonce } = await getAccount(address);
  const signature = await signApproveSessionKey(walletClient, {
    sessionKeyAddress,
    label,
    expiresAt,
    nonce,
  });
  return submitSignedTx(address, nonce, {
    ApproveSessionKey: {
      session_key_address: sessionKeyAddress,
      label,
      expires_at: expiresAt,
    },
  }, signature);
}

/**
 * Revoke a session key -- sign with wallet and submit to chain.
 *
 * Returns the tx_hash immediately after submission. The caller should
 * use `waitForTx(tx_hash)` to verify on-chain confirmation before
 * clearing the local session key.
 */
export async function signAndSubmitRevokeSessionKey(
  walletClient: WalletClient,
  address: `0x${string}`,
  sessionKeyAddress: `0x${string}`,
): Promise<{ tx_hash: string }> {
  const { nonce } = await getAccount(address);
  const signature = await signRevokeSessionKey(walletClient, {
    sessionKeyAddress,
    nonce,
  });
  return submitSignedTx(address, nonce, {
    RevokeSessionKey: { session_key_address: sessionKeyAddress },
  }, signature);
}
