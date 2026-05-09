"use client";

import { useEffect, useState } from "react";

/**
 * Track the user's `prefers-reduced-motion` setting. Returns `true` when the
 * OS/browser is asking us to disable non-essential motion. Live-updates if
 * the user flips the preference mid-session.
 *
 * SSR-safe: returns `false` on the server and during the first client render
 * until the `MediaQueryList` check runs in `useEffect`.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);

    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    // Safari <14 uses addListener/removeListener
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
    mq.addListener(handler);
    return () => mq.removeListener(handler);
  }, []);

  return reduced;
}
