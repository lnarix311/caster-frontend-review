"use client";

/**
 * `GET /account/{addr}/lifetime` reader hook.
 *
 * Refetches when `address` changes and on a slow background poll
 * (`pollMs`, default 30s) so the All-Time Stats card stays roughly in
 * sync with on-chain activity without hammering the endpoint -- the
 * lifetime aggregates only move on resolution events and new fills,
 * which are already handled by the WebSocket layer for the rest of
 * the portfolio page.
 *
 * Concurrency: same request-token pattern as `useLifetimeFills` --
 * stale responses (after an address change or a `refresh` call) are
 * silently dropped.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { getLifetimeStats, type LifetimeStats } from "@/lib/lifetime-api";

export interface UseLifetimeStatsReturn {
  stats: LifetimeStats | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

const DEFAULT_POLL_MS = 30_000;

export function useLifetimeStats(
  address: string | null | undefined,
  options?: { pollMs?: number },
): UseLifetimeStatsReturn {
  const pollMs = options?.pollMs ?? DEFAULT_POLL_MS;

  const [stats, setStats] = useState<LifetimeStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reqTokenRef = useRef(0);
  const addressRef = useRef<string | null | undefined>(address);
  addressRef.current = address;

  const fetchOnce = useCallback(async () => {
    const addr = addressRef.current;
    if (!addr) return;
    const token = ++reqTokenRef.current;
    setLoading(true);
    try {
      const data = await getLifetimeStats(addr);
      if (token !== reqTokenRef.current) return;
      setStats(data);
      setError(null);
    } catch (e) {
      if (token !== reqTokenRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (token === reqTokenRef.current) setLoading(false);
    }
  }, []);

  const refresh = useCallback(() => {
    void fetchOnce();
  }, [fetchOnce]);

  useEffect(() => {
    // Bump token so any prior fetch becomes stale.
    reqTokenRef.current += 1;
    setStats(null);
    setError(null);
    if (!address) {
      setLoading(false);
      return;
    }
    void fetchOnce();
    // Visibility-gated background poll. Skip the network round-trip when
    // the tab is hidden -- saves API hits on the (very common) "user
    // leaves the portfolio open in a background tab" pattern. When the
    // tab becomes visible again we re-fetch immediately so the user sees
    // fresh numbers without waiting for the next interval boundary.
    const tick = () => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      ) {
        return;
      }
      void fetchOnce();
    };
    const onVisible = () => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "visible"
      ) {
        void fetchOnce();
      }
    };
    const handle = setInterval(tick, pollMs);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisible);
    }
    return () => {
      clearInterval(handle);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisible);
      }
    };
  }, [address, pollMs, fetchOnce]);

  return { stats, loading, error, refresh };
}
