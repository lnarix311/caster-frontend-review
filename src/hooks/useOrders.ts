"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useWs } from "@/providers/WebSocketProvider";
import { useAccount } from "@/providers/AccountProvider";
import { getAccountOrders } from "@/lib/api";
import type { Order, EnrichedOrder, WsServerMessage } from "@/lib/types";

/**
 * Convert an EnrichedOrder (REST response) into the internal Order shape
 * used by components.  The REST endpoint returns numeric ids / market_ids
 * while the WS Order type uses strings, so we coerce here.
 */
function enrichedToOrder(e: EnrichedOrder, accountId: string): Order {
  return {
    id: String(e.order_id),
    market_id: String(e.market_id),
    account_id: accountId,
    side: e.side,
    outcome: "Yes",          // REST endpoint doesn't return outcome; default
    price: e.price,
    quantity: e.quantity,
    remaining: e.remaining,
    order_type: "Limit",
    created_at: "",          // Not available from REST
  };
}

export function useOrders() {
  const { addListener } = useWs();
  const { account } = useAccount();
  const [orders, setOrders] = useState<Order[]>([]);
  // Track whether the initial REST fetch has completed so WS events
  // that arrive before it don't get overwritten by the fetch result.
  const bootstrappedRef = useRef(false);

  // Bootstrap existing orders from REST when account connects / changes
  const fetchOrders = useCallback(async () => {
    if (!account) return;
    try {
      const enriched = await getAccountOrders(account.address);
      const mapped = enriched.map((e) => enrichedToOrder(e, account.address));
      setOrders(mapped);
      bootstrappedRef.current = true;
    } catch (e) {
      console.error("Failed to fetch open orders:", e);
    }
  }, [account]);

  useEffect(() => {
    bootstrappedRef.current = false;
    setOrders([]);
    fetchOrders();
  }, [fetchOrders]);

  // Live WS updates: order_accepted, order_cancelled, order_fill
  useEffect(() => {
    if (!account) return;

    const remove = addListener((msg: WsServerMessage) => {
      if (msg.type === "order_accepted" && msg.order.account_id === account.address) {
        // Only add if it has remaining quantity (resting order)
        if (msg.order.remaining > 0) {
          setOrders((prev) => {
            // Deduplicate: if REST bootstrap already included this order, skip
            if (prev.some((o) => o.id === msg.order.id)) return prev;
            return [msg.order, ...prev];
          });
        }
      }

      if (msg.type === "order_cancelled") {
        setOrders((prev) => prev.filter((o) => o.id !== msg.order_id));
      }

      if (msg.type === "order_fill") {
        // The WsServerMessage for order_fill is typed as Fill, which has
        // maker_order_id, taker_order_id, and quantity as strings/numbers.
        const fill = msg as unknown as {
          taker_order_id: string;
          maker_order_id: string;
          quantity: number;
        };
        setOrders((prev) =>
          prev
            .map((o) => {
              if (o.id === fill.maker_order_id || o.id === fill.taker_order_id) {
                const updated = { ...o, remaining: o.remaining - fill.quantity };
                return updated.remaining > 0 ? updated : null;
              }
              return o;
            })
            .filter((o): o is Order => o !== null)
        );
      }
    });

    return remove;
  }, [account, addListener]);

  return orders;
}
