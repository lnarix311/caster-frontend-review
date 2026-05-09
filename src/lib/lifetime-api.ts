/**
 * Read-only HTTP client for the lifetime-analytics endpoints.
 *
 * Carved out of `lib/api.ts` so the lifetime UI surface (All-Time Stats card,
 * Lifetime Fills table, Equity Curve panel) can be unit-tested with a
 * mocked global `fetch` -- without `lib/api.ts` transitively pulling in
 * `viem` (via `signing.ts`) which Node's `--experimental-strip-types`
 * loader can't resolve.
 *
 * Backend reference (added 2026-04-24, chain task #21):
 *   GET /account/{addr}/lifetime
 *   GET /account/{addr}/fills        (cursor-paginated)
 *   GET /account/{addr}/equity-curve (501 stub until task #19 ships)
 *
 * Every monetary field is surfaced as both `*_ticks` (chain-native unit
 * where 1000 ticks = $1) and `*_usd` (f64 dollars). UI code should always
 * read the `*_usd` field per the user's standing dollar-amount preference --
 * the `*_ticks` companions are kept for power users / debug surfaces.
 */

const BASE = "/api";

async function request<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Lifetime stats
// ---------------------------------------------------------------------------

/**
 * Snapshot of a single account's lifetime aggregates returned by
 * `GET /account/{addr}/lifetime`.
 *
 * Behavioural notes:
 *   - A never-traded address still returns 200 with all-zero fields (not
 *     404), so the All-Time Stats card can render unconditionally without
 *     special-casing the empty state at the API layer.
 *   - `derived_win_rate` is computed server-side as
 *     `wins / (wins + losses)` and is `0.0` (not NaN) when no markets
 *     have resolved.
 */
export interface LifetimeStats {
  address: string;

  total_volume_traded_ticks: number;
  total_volume_traded_usd: number;

  total_fees_paid_ticks: number;
  total_fees_paid_usd: number;
  total_rebates_received_ticks: number;
  total_rebates_received_usd: number;

  /** Signed -- can be negative. */
  realized_pnl_ticks: number;
  realized_pnl_usd: number;

  cumulative_deposits_ticks: number;
  cumulative_deposits_usd: number;
  cumulative_withdrawals_ticks: number;
  cumulative_withdrawals_usd: number;

  markets_traded_count: number;
  /** Millis since epoch; null when the user has never traded. */
  first_trade_at_ms: number | null;
  last_trade_at_ms: number | null;
  resolution_wins: number;
  resolution_losses: number;
  /** Server-computed: wins / (wins + losses); 0.0 when no resolutions. */
  derived_win_rate: number;
  fills_count: number;
}

/** Fetch lifetime account stats. */
export async function getLifetimeStats(address: string): Promise<LifetimeStats> {
  return request<LifetimeStats>(`/account/${address}/lifetime`);
}

// ---------------------------------------------------------------------------
// Lifetime fills (cursor-paginated)
// ---------------------------------------------------------------------------

/**
 * One row in the paginated `/account/{addr}/fills` response.
 *
 * Identity = `(block_height, taker_order_id, maker_order_id)` -- the
 * trade-level cursor key. `your_role` is "buyer", "seller", or "self" (rare
 * self-cross). `notional_*` is a server-computed convenience field
 * = `price * quantity / 1000`.
 */
export interface LifetimeFill {
  market_id: number;
  maker_order_id: number;
  taker_order_id: number;
  block_height: number;
  timestamp_ms: number;

  price: number;
  quantity: number;
  taker_side: "Buy" | "Sell";

  taker_fee_ticks: number;
  taker_fee_usd: number;
  maker_rebate_ticks: number;
  maker_rebate_usd: number;

  notional_ticks: number;
  notional_usd: number;

  buyer: string;
  seller: string;
  /** "buyer" | "seller" | "self" -- which side of the trade `addr` is on. */
  your_role: "buyer" | "seller" | "self";
}

/** Cursor for the next page of `/account/{addr}/fills`. */
export interface LifetimeFillsCursor {
  block_height: number;
  taker_order_id: number;
  maker_order_id: number;
}

export interface LifetimeFillsPage {
  address: string;
  fills: LifetimeFill[];
  /** Absent when this is the final page. */
  next_cursor: LifetimeFillsCursor | null;
}

/**
 * Fetch one page of lifetime fills, newest-first.
 *
 * Pass `cursor = null` (or omit) for the first page; subsequent pages
 * supply the `next_cursor` from the previous response.
 *
 * `limit` defaults to the server-side default (50) and is server-clamped
 * to [1, 500]; values outside that range are silently clamped, not
 * rejected, so a misbehaving caller still makes forward progress.
 */
export async function getLifetimeFills(
  address: string,
  options?: { cursor?: LifetimeFillsCursor | null; limit?: number },
): Promise<LifetimeFillsPage> {
  const params = new URLSearchParams();
  if (options?.limit != null) params.set("limit", String(options.limit));
  if (options?.cursor) {
    params.set("before_block", String(options.cursor.block_height));
    params.set("before_taker_order_id", String(options.cursor.taker_order_id));
    params.set("before_maker_order_id", String(options.cursor.maker_order_id));
  }
  const qs = params.toString();
  const path = qs ? `/account/${address}/fills?${qs}` : `/account/${address}/fills`;
  return request<LifetimeFillsPage>(path);
}

// ---------------------------------------------------------------------------
// Equity curve (with pending sentinel handling)
// ---------------------------------------------------------------------------

export interface EquityCurveSnapshot {
  /** Millis since epoch. */
  timestamp_ms: number;
  equity_ticks: number;
  equity_usd: number;
}

export interface EquityCurveResponse {
  address: string;
  /** Ordered oldest-first. Empty list = no equity history yet. */
  snapshots: EquityCurveSnapshot[];
}

/**
 * Sentinel error tag returned in the body of /equity-curve while task #19
 * is pending. We gate against the response body, not the 501 status code,
 * so a future shape change won't silently break this branch.
 */
export const EQUITY_CURVE_PENDING_TAG = "EQUITY_CURVE_PENDING_TASK_19";

/**
 * Discriminator used by the portfolio page to decide between "render the
 * chart" and "render the placeholder" without distinguishing 501 from
 * other transport errors.
 */
export type EquityCurveResult =
  | { kind: "ready"; snapshots: EquityCurveSnapshot[] }
  | { kind: "pending" }
  | { kind: "error"; message: string };

/**
 * Fetch the equity curve for an account.
 *
 * Returns a discriminated union:
 *   - `{ kind: "ready", snapshots }`  -- normal success path
 *   - `{ kind: "pending" }`           -- backend returned the
 *     `EQUITY_CURVE_PENDING_TASK_19` sentinel; UI should render the
 *     "Coming soon" placeholder rather than an error toast
 *   - `{ kind: "error", message }`    -- transport / unexpected failure
 *
 * We match the sentinel via substring on the response body so the contract
 * stays stable even if axum upgrades the status code or wraps the body in
 * a different envelope.
 */
export async function getEquityCurve(
  address: string,
  options?: { sinceMs?: number; untilMs?: number },
): Promise<EquityCurveResult> {
  const params = new URLSearchParams();
  if (options?.sinceMs != null) params.set("since_ms", String(options.sinceMs));
  if (options?.untilMs != null) params.set("until_ms", String(options.untilMs));
  const qs = params.toString();
  const path = qs
    ? `/account/${address}/equity-curve?${qs}`
    : `/account/${address}/equity-curve`;

  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
  });

  if (res.ok) {
    const body = (await res.json()) as EquityCurveResponse;
    return { kind: "ready", snapshots: body.snapshots ?? [] };
  }

  // Non-2xx: read the body, look for the pending sentinel.
  const text = await res.text();
  if (text.includes(EQUITY_CURVE_PENDING_TAG)) {
    return { kind: "pending" };
  }
  return { kind: "error", message: `API error ${res.status}: ${text}` };
}
