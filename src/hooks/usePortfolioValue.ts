"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import * as api from "@/lib/api";
import type { ChainPosition, MarketPriceInfo } from "@/lib/types";

/**
 * Lightweight hook that computes total portfolio value for a connected account.
 *
 * Total portfolio value = cash balance + mark-to-market value of all positions.
 *
 * Position value for each market:
 *   yes_shares * mid_price + no_shares * (1000 - mid_price)
 *
 * Polls prices every 30 seconds (navbar is global, so keep this light).
 * The portfolio page has its own faster 3s price poll for the equity chart.
 */

const PRICE_POLL_MS = 30_000;

export function usePortfolioValue(
  address: string | null,
  cashBalance: number,
): { totalValue: number; positionsValue: number; loading: boolean } {
  const [positions, setPositions] = useState<ChainPosition[]>([]);
  const [priceMap, setPriceMap] = useState<Map<number, MarketPriceInfo>>(new Map());
  const [loading, setLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    if (!address) return;
    const [posData, priceData] = await Promise.all([
      api.getPositions(address).catch(() => [] as ChainPosition[]),
      api.getMarketPrices().catch(() => ({ markets: [] as MarketPriceInfo[] })),
    ]);
    if (!mountedRef.current) return;
    setPositions(posData);
    setPriceMap(new Map(priceData.markets.map((p) => [p.market_id, p])));
    setLoading(false);
  }, [address]);

  useEffect(() => {
    mountedRef.current = true;
    if (!address) {
      setPositions([]);
      setPriceMap(new Map());
      return;
    }

    setLoading(true);
    fetchData();

    pollRef.current = setInterval(fetchData, PRICE_POLL_MS);

    return () => {
      mountedRef.current = false;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [address, fetchData]);

  // Memoize position value computation
  const positionsValue = useMemo(() => {
    let value = 0;
    for (const pos of positions) {
      const price = priceMap.get(pos.market_id);
      if (!price) continue;
      const mid = price.mid;
      value += pos.yes_shares * mid;
      value += pos.no_shares * (1000 - mid);
    }
    return value;
  }, [positions, priceMap]);

  const totalValue = cashBalance + positionsValue;

  return { totalValue, positionsValue, loading };
}
