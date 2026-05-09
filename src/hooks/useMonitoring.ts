"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { Environment, MonitoringSnapshot } from "@/types/monitoring";

const POLL_INTERVAL_MS = 10_000;

export type FetchErrorKind = "network" | "auth" | "server" | "parse";

export interface FetchError {
  kind: FetchErrorKind;
  status?: number;
  message: string;
}

export interface UseMonitoringResult {
  /** Most-recent successful snapshot. Persists across fetch errors so the UI
   *  can show last-known data with a banner instead of wiping out. */
  data: MonitoringSnapshot | null;
  /** Clock time of the last successful fetch (used for "updated Xs ago"). */
  lastFetchedAt: Date | null;
  /** Last fetch error, cleared on the next successful fetch. */
  error: FetchError | null;
  /** True while the first fetch for this env is still in flight and no data
   *  has been rendered yet. Flips to false after the first response (ok or
   *  err). Subsequent env changes re-arm it. */
  loading: boolean;
  /** Trigger an out-of-band refetch (e.g. manual refresh button). */
  refetch: () => void;
}

/**
 * Poll `/status/{env}.json` every 10s. The endpoint lives at the same origin,
 * behind nginx basic auth; the browser handles the credential dialog on the
 * first request and caches the Authorization header for subsequent polls.
 *
 * - Uses `AbortController` so in-flight requests are cancelled on unmount
 *   and on env switch.
 * - On error, keeps the last successful snapshot in `data` so the UI can
 *   render stale data with a banner instead of flashing empty state.
 * - Distinguishes 401 ("re-auth required") from other server / network errors
 *   so the page can show a dedicated banner.
 */
export function useMonitoring(env: Environment): UseMonitoringResult {
  const [data, setData] = useState<MonitoringSnapshot | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);
  const [error, setError] = useState<FetchError | null>(null);
  const [loading, setLoading] = useState(true);
  // Bump this to force the effect to re-run (manual refetch).
  const [refreshTick, setRefreshTick] = useState(0);

  // Track the abort controller so we can cancel in-flight requests.
  const abortRef = useRef<AbortController | null>(null);

  const refetch = useCallback(() => {
    setRefreshTick((t) => t + 1);
  }, []);

  useEffect(() => {
    // Reset view state when switching environments so the grid doesn't briefly
    // show the other env's values.
    setLoading(true);
    setData(null);
    setLastFetchedAt(null);
    setError(null);

    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const runFetch = async () => {
      // Cancel any previous in-flight request.
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      try {
        const resp = await fetch(`/status/${env}.json`, {
          signal: ctrl.signal,
          credentials: "include",
          // Defeat browser caching -- ops dashboards want fresh bytes.
          cache: "no-store",
          headers: { Accept: "application/json" },
        });

        if (!resp.ok) {
          if (cancelled) return;
          const kind: FetchErrorKind =
            resp.status === 401 ? "auth" : "server";
          setError({
            kind,
            status: resp.status,
            message:
              kind === "auth"
                ? "Authentication required. Refresh the page to re-enter credentials."
                : `Fetch failed: HTTP ${resp.status}`,
          });
          setLoading(false);
          return;
        }

        const json: MonitoringSnapshot = await resp.json();
        if (cancelled) return;
        setData(json);
        setLastFetchedAt(new Date());
        setError(null);
        setLoading(false);
      } catch (err) {
        // AbortError is expected on unmount / env switch; ignore.
        if ((err as Error).name === "AbortError") return;
        if (cancelled) return;
        // SyntaxError => body wasn't JSON. Treat as parse error.
        const isParse = err instanceof SyntaxError;
        setError({
          kind: isParse ? "parse" : "network",
          message: isParse
            ? "Received response was not valid JSON."
            : `Network error: ${(err as Error).message}`,
        });
        setLoading(false);
      }
    };

    runFetch();
    intervalId = setInterval(runFetch, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
      abortRef.current?.abort();
    };
  }, [env, refreshTick]);

  return { data, lastFetchedAt, error, loading, refetch };
}
