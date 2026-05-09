/**
 * Shared number formatters.
 *
 * Convention: prediction-market prices are expressed in ticks where
 * 1000 ticks = $1.00. Share quantity is raw count.
 *
 *   dollars per share  = ticks / 1000
 *   notional at level  = (ticks / 1000) * qty
 *
 * `formatDollars` is the canonical compact-currency formatter used across
 * the orderbook, volume displays, and anywhere else we show $ values.
 *
 *   < $1      -> $0.42
 *   < $1K     -> $325
 *   < $1M     -> $12.4K
 *   >= $1M    -> $1.2M
 */
export function formatDollars(dollars: number): string {
  if (!Number.isFinite(dollars)) return "--";
  const abs = Math.abs(dollars);
  const sign = dollars < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  if (abs >= 1) return `${sign}$${abs.toFixed(0)}`;
  if (abs === 0) return "$0";
  return `${sign}$${abs.toFixed(2)}`;
}

/** Compute $ notional for an orderbook level. */
export function notionalDollars(priceTicks: number, quantity: number): number {
  return (priceTicks / 1000) * quantity;
}

/** Convenience: price ticks + qty -> compact $ string. */
export function formatNotional(priceTicks: number, quantity: number): string {
  return formatDollars(notionalDollars(priceTicks, quantity));
}
