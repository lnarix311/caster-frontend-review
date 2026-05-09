"use client";

import { useState, useEffect, useRef } from "react";
import { useWs } from "@/providers/WebSocketProvider";
import { getRecentTrades } from "@/lib/api";
import type { MarketId, Trade, WsServerMessage } from "@/lib/types";

const MAX_TRADES = 50;

export function useTrades(marketId: MarketId | null) {
  const { addListener, subscribe } = useWs();
  const [trades, setTrades] = useState<Trade[]>([]);

  // Track the latest REST trade timestamp to deduplicate against WS trades
  // that may arrive during or just after the REST fetch window.
  const restTimestampRef = useRef<string | null>(null);

  // Subscribe to trades channel
  useEffect(() => {
    if (!marketId) return;
    subscribe(["trades"], marketId);
  }, [marketId, subscribe]);

  // REST bootstrap: fetch recent trades on mount
  useEffect(() => {
    if (!marketId) return;
    let cancelled = false;

    getRecentTrades(marketId, MAX_TRADES)
      .then((recent) => {
        if (cancelled) return;
        const mapped = recent.map((t) => ({
          market_id: marketId,
          price: t.price,
          quantity: t.quantity,
          taker_side: t.side as Trade["taker_side"],
          timestamp: new Date(t.timestamp).toISOString(),
          taker_tx_hash: t.taker_tx_hash,
          buyer: t.buyer ?? null,
          seller: t.seller ?? null,
        }));
        // Record the newest REST trade timestamp so the WS listener can
        // skip any duplicates that arrive after this snapshot is set.
        if (mapped.length > 0) {
          restTimestampRef.current = mapped[0].timestamp;
        }
        setTrades(mapped);
      })
      .catch(() => {
        // Silently fall back to WS-only if endpoint unavailable
      });

    return () => { cancelled = true; };
  }, [marketId]);

  // WS: append live trades
  useEffect(() => {
    if (!marketId) return;

    const remove = addListener((msg: WsServerMessage) => {
      if (msg.type === "trade" && String(msg.market_id) === String(marketId)) {
        // Skip WS trades that are older than or equal to the latest REST trade
        // to prevent duplicates during the REST-to-WS handoff window.
        if (
          restTimestampRef.current &&
          msg.timestamp <= restTimestampRef.current
        ) {
          return;
        }
        setTrades((prev) => [
          {
            market_id: msg.market_id,
            price: msg.price,
            quantity: msg.quantity,
            taker_side: msg.taker_side,
            timestamp: msg.timestamp,
            taker_tx_hash: msg.taker_tx_hash,
            buyer: msg.buyer ?? null,
            seller: msg.seller ?? null,
          },
          ...prev.slice(0, MAX_TRADES - 1),
        ]);
      }
    });

    return remove;
  }, [marketId, addListener]);

  return trades;
}
