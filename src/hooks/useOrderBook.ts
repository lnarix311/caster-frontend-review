"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useWs } from "@/providers/WebSocketProvider";
import type { MarketId, WsServerMessage } from "@/lib/types";

export interface BookEntry {
  price: number;
  quantity: number;
}

/**
 * Aggregate individual order levels (from REST /market/{id}/orderbook)
 * into price-level totals compatible with the WebSocket delta maps.
 */
function aggregateOrders(
  orders: { price: number; remaining: number }[],
): Map<number, number> {
  const map = new Map<number, number>();
  for (const o of orders) {
    map.set(o.price, (map.get(o.price) ?? 0) + o.remaining);
  }
  return map;
}

export function useOrderBook(marketId: MarketId | null) {
  const { subscribe, addListener } = useWs();
  const [bids, setBids] = useState<BookEntry[]>([]);
  const [asks, setAsks] = useState<BookEntry[]>([]);
  const sequenceRef = useRef(0);

  // Internal map state for applying deltas
  const bidMapRef = useRef(new Map<number, number>());
  const askMapRef = useRef(new Map<number, number>());

  const rebuildArrays = useCallback(() => {
    const bidArr = Array.from(bidMapRef.current.entries())
      .filter(([, q]) => q > 0)
      .map(([price, quantity]) => ({ price, quantity }))
      .sort((a, b) => b.price - a.price);

    const askArr = Array.from(askMapRef.current.entries())
      .filter(([, q]) => q > 0)
      .map(([price, quantity]) => ({ price, quantity }))
      .sort((a, b) => a.price - b.price);

    setBids(bidArr);
    setAsks(askArr);
  }, []);

  useEffect(() => {
    if (!marketId) return;

    bidMapRef.current.clear();
    askMapRef.current.clear();
    sequenceRef.current = 0;
    setBids([]);
    setAsks([]);

    // Fetch initial book state from REST API so we don't depend
    // on the WebSocket snapshot (which currently sends empty data).
    fetch(`/api/market/${marketId}/orderbook`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        // Only apply REST data if we haven't received a WS snapshot yet
        if (sequenceRef.current === 0) {
          const restBids = aggregateOrders(data.bids ?? []);
          const restAsks = aggregateOrders(data.asks ?? []);
          // Merge into maps (don't overwrite if WS deltas already arrived)
          for (const [price, qty] of restBids) {
            if (!bidMapRef.current.has(price)) {
              bidMapRef.current.set(price, qty);
            }
          }
          for (const [price, qty] of restAsks) {
            if (!askMapRef.current.has(price)) {
              askMapRef.current.set(price, qty);
            }
          }
          rebuildArrays();
        }
      })
      .catch(() => {
        // REST fallback is best-effort; WS will provide data
      });

    subscribe(["book", "trades"], marketId);

    const remove = addListener((msg: WsServerMessage) => {
      if (msg.type === "book_snapshot" && msg.market_id === marketId) {
        bidMapRef.current.clear();
        askMapRef.current.clear();
        for (const [price, qty] of msg.bids) {
          bidMapRef.current.set(price, qty);
        }
        for (const [price, qty] of msg.asks) {
          askMapRef.current.set(price, qty);
        }
        sequenceRef.current = msg.sequence;
        rebuildArrays();
      }

      if (msg.type === "book_delta" && msg.market_id === marketId) {
        // Sequence gap detection -- request re-sync if needed
        if (msg.sequence > sequenceRef.current + 1 && sequenceRef.current > 0) {
          // Reset sequence so we don't loop, then request fresh snapshot
          sequenceRef.current = 0;
          subscribe(["book"], marketId);
          return;
        }
        sequenceRef.current = msg.sequence;

        const map = msg.side === "Buy" ? bidMapRef.current : askMapRef.current;
        if (msg.new_total_qty === 0) {
          map.delete(msg.price);
        } else {
          map.set(msg.price, msg.new_total_qty);
        }
        rebuildArrays();
      }
    });

    return remove;
  }, [marketId, subscribe, addListener, rebuildArrays]);

  const spread = asks.length > 0 && bids.length > 0 ? asks[0].price - bids[0].price : null;

  return { bids, asks, spread };
}
