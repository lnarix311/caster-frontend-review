"use client";

import { useEffect, useState } from "react";
import * as api from "@/lib/api";
import type { Market } from "@/lib/types";

export type ParentResolutionState =
  | "loading"
  | "missing" // parent could not be fetched (404 / network)
  | "open"
  | "resolved-match" // parent resolved to the activating outcome -- child is live
  | "resolved-mismatch" // parent resolved to the wrong branch -- child has voided
  | "resolved-unknown"; // parent resolved Unknown -- child has voided

export interface ParentMarketInfo {
  /** Loaded parent market, or `null` while loading / on failure. */
  parent: (Market & { status_raw: string }) | null;
  state: ParentResolutionState;
  /** Convenience: did the chain auto-void this child? */
  voided: boolean;
}

/**
 * Resolve a child market's parent into a usable info object for the UI.
 *
 * The chain's `status_raw` is `Debug` formatted: "Open", "Resolved(Yes)",
 * "Resolved(No)", "Resolved(Unknown)". We parse that to produce a coarse
 * state enum the banner / icon components can switch on.
 *
 * Returns sentinel states for missing data so callers can render a
 * neutral fallback ("Conditional on market #N") rather than blank-flashing.
 */
export function useParentMarket(
  parentMarketId: number | null | undefined,
  parentOutcome: string | null | undefined,
): ParentMarketInfo {
  const [parent, setParent] = useState<(Market & { status_raw: string }) | null>(null);
  const [state, setState] = useState<ParentResolutionState>("loading");

  useEffect(() => {
    if (parentMarketId == null) {
      setParent(null);
      setState("loading");
      return;
    }

    let cancelled = false;

    api
      .getMarket(String(parentMarketId))
      .then((m) => {
        if (cancelled) return;
        setParent(m);
        setState(deriveState(m.status_raw, parentOutcome));
      })
      .catch(() => {
        if (cancelled) return;
        setParent(null);
        setState("missing");
      });

    return () => {
      cancelled = true;
    };
  }, [parentMarketId, parentOutcome]);

  const voided = state === "resolved-mismatch" || state === "resolved-unknown";

  return { parent, state, voided };
}

function deriveState(
  statusRaw: string,
  parentOutcome: string | null | undefined,
): ParentResolutionState {
  // status_raw comes from server-side Rust Debug formatting of MarketStatus:
  //   "Open" | "Resolved(Yes)" | "Resolved(No)" | "Resolved(Unknown)"
  if (statusRaw === "Open") return "open";

  const m = /^Resolved\((Yes|No|Unknown)\)$/.exec(statusRaw);
  if (!m) return "open"; // unknown future state -- treat as live

  const resolved = m[1];
  if (resolved === "Unknown") return "resolved-unknown";

  if (parentOutcome && resolved.toLowerCase() === parentOutcome.toLowerCase()) {
    return "resolved-match";
  }
  return "resolved-mismatch";
}
