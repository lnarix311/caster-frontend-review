export type OrderId = string;
export type MarketId = string;
export type AccountId = string;

export type Side = "Buy" | "Sell";
export type OrderType = "Limit" | "Market";
export type Outcome = "Yes" | "No" | "Unknown";
export type AccountTier = "Free" | "Premium";
export type MarketStatus = "Open" | "Closed" | "Resolved";

export interface Market {
  id: MarketId;
  question: string;
  status: MarketStatus;
  creator: string;
  parent_market_id: number | null;
  parent_outcome: string | null;
  /** URL path to market thumbnail image (e.g. `/api/v1/markets/123/image`).
   * `null` when no image has been scraped — callers should render the
   * `MarketImage` fallback. */
  image_url?: string | null;
  /** Resolution timestamp in milliseconds since epoch.
   *
   * Drives the "Resolves in …" countdown chip on `MarketCard` and the market
   * page header. Optional because the backend doesn't currently expose this
   * field on every market — when `null`/undefined the chip is hidden. Once
   * chain-engineer/api-engineer ship this field, the chip lights up for all
   * markets without any further frontend work. */
  resolves_at?: number | null;
}

export interface Account {
  address: `0x${string}`;
  balance: number;
  nonce: number;
}

export interface BookLevel {
  price: number;
  quantity: number;
}

export interface BookSnapshot {
  market_id: MarketId;
  bids: [number, number][];
  asks: [number, number][];
}

export interface Trade {
  market_id: MarketId;
  price: number;
  quantity: number;
  taker_side: Side;
  timestamp: string;
  /** Taker tx hash. Optional until chain-engineer's back-reference patch lands. */
  taker_tx_hash?: string;
  /** Buyer address (0x-prefixed). Optional during the WS migration rollout —
   * connected clients receive a mix of old (no buyer/seller) and new events
   * until every chain node ships. Becomes non-null once the patch lands
   * everywhere. */
  buyer?: string | null;
  /** Seller address (0x-prefixed). See `buyer` above. */
  seller?: string | null;
}

export interface Order {
  id: OrderId;
  market_id: MarketId;
  account_id: AccountId;
  side: Side;
  outcome: Outcome;
  price: number;
  quantity: number;
  remaining: number;
  order_type: OrderType;
  created_at: string;
}

export interface Fill {
  maker_order_id: OrderId;
  taker_order_id: OrderId;
  market_id: MarketId;
  price: number;
  quantity: number;
  maker_account_id: AccountId;
  taker_account_id: AccountId;
  maker_side: Side;
  taker_side: Side;
  timestamp: string;
}

export interface Position {
  account_id: AccountId;
  market_id: MarketId;
  yes_quantity: number;
  no_quantity: number;
  cost_basis: number;
}

export interface Comment {
  id: string;
  market_id: MarketId;
  account_id: AccountId;
  author_name: string;
  body: string;
  parent_id: string | null;
  created_at: string;
  flagged: boolean;
}

// Analytics types
export interface MetricsSnapshot {
  timestamp: string;
  caster_best_bid: number | null;
  caster_best_ask: number | null;
  caster_spread_bps: number | null;
  poly_best_bid: number | null;
  poly_best_ask: number | null;
  poly_spread_bps: number | null;
  spread_advantage_bps: number | null;
  mm_pnl: number;
  mm_position: number;
  mm_fills_count: number;
  mm_cancels_before_hit: number;
  mm_cancels_total: number;
  caster_volume: number;
  caster_trades_count: number;
}

export interface AnalyticsFillRecord {
  id: string;
  timestamp: string;
  market_id: string;
  fill_price_ticks: number;
  quantity: number;
  taker_side: string;
  maker_account_id: string;
  taker_account_id: string;
  is_mm_maker: boolean;
  markout_1s: number | null;
  markout_5s: number | null;
  markout_30s: number | null;
}

export interface ComparisonResponse {
  caster_best_bid: number | null;
  caster_best_ask: number | null;
  caster_spread_bps: number | null;
  poly_best_bid: number | null;
  poly_best_ask: number | null;
  poly_spread_bps: number | null;
  spread_advantage_bps: number | null;
}

export interface MmStatsResponse {
  pnl: number;
  net_position: number;
  total_fills: number;
  total_volume: number;
  cancels_before_hit: number;
  cancels_total: number;
  speed_bump_effectiveness_pct: number;
}

export interface BookComparisonResponse {
  caster_bids: [number, number][];
  caster_asks: [number, number][];
  poly_bids: [number, number][];
  poly_asks: [number, number][];
}

// Portfolio types
export interface AccountTradeRecord {
  maker_order_id: number;
  taker_order_id: number;
  market_id: number;
  price: number;
  quantity: number;
  buyer: string;
  seller: string;
  block_height: number;
  taker_fee: number;
  maker_rebate: number;
  taker_side: Side;
  timestamp: number; // millis since epoch
  /** Hash of the taker tx that produced this fill. Optional until
   * chain-engineer's back-reference patch lands; until then per-trade
   * tx links are hidden. */
  taker_tx_hash?: string;
}

export interface MarketPriceInfo {
  market_id: number;
  best_bid: number | null;
  best_ask: number | null;
  mid: number;
  last_trade_price: number | null;
}

export interface EnrichedOrder {
  order_id: number;
  market_id: number;
  side: Side;
  price: number;
  quantity: number;
  remaining: number;
  close_qty: number;
  block_height: number;
  locked_collateral: number;
}

/**
 * String form of a market's resolution status. Matches the Rust debug
 * format emitted by `format!("{:?}", market.status)` from the chain:
 *   - `"Open"`                -- still accepting orders
 *   - `"Resolved(Yes)"`       -- resolved positively
 *   - `"Resolved(No)"`        -- resolved negatively
 *   - `"Resolved(Unknown)"`   -- voided (50/50 payout, typically via
 *                                conditional parent-child cascade)
 *   - `"Closed"`              -- legacy/transient state (pre-resolution);
 *                                shouldn't appear in current chain but
 *                                kept for defensiveness
 *   - `"MissingMarket"`       -- defensive sentinel when the position's
 *                                owning market record was not found
 *                                (the chain currently emits `"Unknown"`
 *                                in this case; chain-engineer is renaming
 *                                to `"MissingMarket"` to disambiguate
 *                                from `"Resolved(Unknown)"`, which is a
 *                                legitimate void resolution. Both variants
 *                                are accepted here during rollout.)
 *   - `"Unknown"`             -- legacy sentinel; treat identically to
 *                                `"MissingMarket"` until the rename ships.
 *
 * The `string & {}` trick on the trailing branch keeps literal-completeness
 * warnings firing in `switch` statements (a bare `| string` would silently
 * widen the union and mask missed cases) while still accepting arbitrary
 * strings at runtime for forward-compat. See TypeScript issue #29729.
 */
export type MarketStatusRaw =
  | "Open"
  | "Closed"
  | "Resolved(Yes)"
  | "Resolved(No)"
  | "Resolved(Unknown)"
  | "MissingMarket"
  | "Unknown"
  | (string & {});

/**
 * Resolved outcome string as returned by the enriched `/positions` endpoint.
 * `null` when the market is still Open (or when the owning market is missing).
 */
export type ResolvedOutcome = "Yes" | "No" | "Unknown" | null;

export interface ChainPosition {
  market_id: number;
  yes_shares: number;
  no_shares: number;

  // --- Enrichment fields (added 2026-04-23, branch api/enrich-positions-response)
  //
  // All optional at the type level so existing call sites that build
  // `ChainPosition` objects by hand (e.g. WS `position_update` handler)
  // continue to compile unchanged. The portfolio UI tolerates `undefined`
  // and falls back to "Open"-like rendering -- a correct default for any
  // position that WS just told us changed.
  /** Debug-formatted market status (see `MarketStatusRaw`). Absent on
   * rows rehydrated from WS events where we haven't re-fetched yet. */
  market_status?: MarketStatusRaw;
  /** `"Yes"`, `"No"`, `"Unknown"`, or null/undefined if still Open. */
  resolved_outcome?: ResolvedOutcome;
  /** Unix-millisecond resolution timestamp. */
  resolves_at?: number | null;
  /** Full market question text (non-truncated). */
  question?: string;
  /** Parent market id for conditional children; undefined/null for top-level. */
  parent_market_id?: number | null;
  /** Parent outcome that activates this child ("Yes" / "No"). */
  parent_outcome?: string | null;
}

// WebSocket messages
export type WsServerMessage =
  | { type: "book_snapshot"; market_id: MarketId; bids: [number, number][]; asks: [number, number][]; sequence: number }
  | { type: "book_delta"; market_id: MarketId; side: Side; price: number; new_total_qty: number; sequence: number }
  | { type: "trade"; market_id: MarketId; price: number; quantity: number; taker_side: Side; timestamp: string; taker_tx_hash?: string; buyer?: string | null; seller?: string | null }
  | { type: "order_accepted"; order: Order }
  | { type: "order_fill"; } & Fill
  | { type: "order_cancelled"; order_id: OrderId; remaining: number }
  | { type: "balance_update"; balance: number; frozen: number }
  | { type: "position_update"; market_id: MarketId; yes_quantity: number; no_quantity: number }
  | { type: "error"; message: string };
