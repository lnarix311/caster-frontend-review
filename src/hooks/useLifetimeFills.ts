"use client";

/**
 * Cursor-paginated lifetime fills hook.
 *
 * Wraps `getLifetimeFills` into a stateful "infinite scroll" reader:
 *
 *   const { fills, loading, error, hasMore, loadMore, reset } =
 *       useLifetimeFills(address, { pageSize: 50 });
 *
 *   - `fills`     -- accumulated rows across all pages loaded so far,
 *                    newest-first (matches the backend response order)
 *   - `loading`   -- a fetch is currently in flight
 *   - `error`     -- last fetch error, or null
 *   - `hasMore`   -- backend returned a `next_cursor` on the last page;
 *                    `false` means we have hit the start of history
 *   - `loadMore`  -- idempotent; no-op while a fetch is in flight or when
 *                    `hasMore` is false; returns `void` (caller awaits via
 *                    re-render)
 *   - `reset`     -- drop all accumulated state and refetch page 1.
 *                    Called automatically when `address` changes
 *
 * Concurrency contract: all fetch responses include a request token; only
 * the latest token is allowed to mutate state. This means rapid
 * `address` changes never interleave -- the stale page silently drops
 * even if it arrives after the fresh one.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { getLifetimeFills, type LifetimeFill, type LifetimeFillsCursor } from "@/lib/lifetime-api";

/** Public hook return shape. */
export interface UseLifetimeFillsReturn {
  fills: LifetimeFill[];
  loading: boolean;
  /** Set to a non-null string when the most recent fetch failed.
   * Cleared when a subsequent fetch succeeds, or when `reset` is called. */
  error: string | null;
  /** `false` once `next_cursor` came back null (= start of history). */
  hasMore: boolean;
  /** Fire-and-forget; idempotent during in-flight loads and at history end. */
  loadMore: () => void;
  /** Drop all accumulated state and refetch page 1. */
  reset: () => void;
}

export interface UseLifetimeFillsOptions {
  /** Server clamps to [1, 500]; we default to 50 to match the backend. */
  pageSize?: number;
  /**
   * Set to false to skip the auto-fetch on mount. Useful for tests and for
   * any caller that wants to wait for an external trigger before kicking
   * off the first load. Defaults to true.
   */
  autoLoad?: boolean;
}

export function useLifetimeFills(
  address: string | null | undefined,
  options?: UseLifetimeFillsOptions,
): UseLifetimeFillsReturn {
  const pageSize = options?.pageSize ?? 50;
  const autoLoad = options?.autoLoad ?? true;

  const [fills, setFills] = useState<LifetimeFill[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);

  // Keep cursor + in-flight flag in refs so `loadMore` is stable across
  // renders and never sees stale closure state.
  const cursorRef = useRef<LifetimeFillsCursor | null>(null);
  const loadingRef = useRef(false);
  const hasMoreRef = useRef(true);
  const reqTokenRef = useRef(0);
  const addressRef = useRef<string | null | undefined>(address);
  addressRef.current = address;

  const fetchPage = useCallback(async () => {
    const addr = addressRef.current;
    if (!addr) return;
    if (loadingRef.current) return;
    if (!hasMoreRef.current) return;

    const token = ++reqTokenRef.current;
    loadingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const page = await getLifetimeFills(addr, {
        cursor: cursorRef.current,
        limit: pageSize,
      });

      // Discard stale responses (address changed, or reset bumped the token).
      if (token !== reqTokenRef.current) return;

      cursorRef.current = page.next_cursor;
      hasMoreRef.current = page.next_cursor !== null;
      setHasMore(page.next_cursor !== null);
      setFills((prev) => [...prev, ...page.fills]);
    } catch (e) {
      if (token !== reqTokenRef.current) return;
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      if (token === reqTokenRef.current) {
        loadingRef.current = false;
        setLoading(false);
      }
    }
  }, [pageSize]);

  const reset = useCallback(() => {
    // Bump the token so any in-flight requests can no longer mutate state.
    reqTokenRef.current += 1;
    cursorRef.current = null;
    hasMoreRef.current = true;
    loadingRef.current = false;
    setFills([]);
    setHasMore(true);
    setError(null);
    setLoading(false);
  }, []);

  // Reset + auto-fetch whenever the target address changes. The two-step
  // (reset, then fetch) is split so a caller could also opt out of auto-load
  // and trigger the first fetch on a button click.
  useEffect(() => {
    reset();
    if (autoLoad && address) {
      // Defer to a microtask so React commits the reset() state first.
      void Promise.resolve().then(fetchPage);
    }
  }, [address, autoLoad, fetchPage, reset]);

  return {
    fills,
    loading,
    error,
    hasMore,
    loadMore: fetchPage,
    reset,
  };
}
