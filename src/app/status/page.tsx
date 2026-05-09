"use client";

import { useEffect, useState } from "react";
import { useMonitoring } from "@/hooks/useMonitoring";
import type { Environment } from "@/types/monitoring";
import {
  AlertsCard,
  BridgeCard,
  ChainCard,
  ClpCard,
  InfrastructureCard,
  ServicesCard,
} from "@/components/status/StatusWidgets";

// ---------------------------------------------------------------------------
// "Last updated Xs ago" -- reactive to wall clock so the label refreshes
// without waiting for the next poll.
// ---------------------------------------------------------------------------
function useNow(tickMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(id);
  }, [tickMs]);
  return now;
}

function freshnessFromAge(ageSec: number | null, hasError: boolean) {
  if (hasError && ageSec == null) {
    return { color: "var(--no)", label: "no data" };
  }
  if (ageSec == null) {
    return { color: "var(--text-tertiary)", label: "—" };
  }
  const label =
    ageSec < 60
      ? `${Math.round(ageSec)}s ago`
      : ageSec < 3600
      ? `${Math.round(ageSec / 60)}m ago`
      : `${Math.round(ageSec / 3600)}h ago`;
  const color =
    ageSec < 60
      ? "var(--yes)"
      : ageSec <= 300
      ? "var(--warning)"
      : "var(--no)";
  return { color, label };
}

// ---------------------------------------------------------------------------
// Environment toggle (segmented control)
// ---------------------------------------------------------------------------
function EnvToggle({
  env,
  onChange,
}: {
  env: Environment;
  onChange: (next: Environment) => void;
}) {
  const options: Environment[] = ["devnet", "testnet"];
  return (
    <div
      role="tablist"
      aria-label="Environment"
      className="inline-flex rounded-md p-0.5"
      style={{
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-default)",
      }}
    >
      {options.map((opt) => {
        const active = env === opt;
        return (
          <button
            key={opt}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt)}
            className="px-3 py-1 text-xs font-mono rounded transition-colors"
            style={{
              background: active ? "var(--accent)" : "transparent",
              color: active ? "var(--accent-on)" : "var(--text-secondary)",
              textTransform: "capitalize",
              border: "none",
              cursor: active ? "default" : "pointer",
              letterSpacing: "0.05em",
            }}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton shown on first render (before first response).
// ---------------------------------------------------------------------------
function SkeletonCard({ fullWidth }: { fullWidth?: boolean }) {
  return (
    <div
      className={`glass rounded-lg p-4 flex flex-col gap-3 ${
        fullWidth ? "md:col-span-2" : ""
      }`}
      aria-hidden="true"
    >
      <div
        className="skeleton"
        style={{ height: 10, width: "40%", borderRadius: 2 }}
      />
      <div
        className="skeleton"
        style={{ height: 24, width: "60%", borderRadius: 2 }}
      />
      <div
        className="skeleton"
        style={{ height: 10, width: "80%", borderRadius: 2 }}
      />
      <div
        className="skeleton"
        style={{ height: 10, width: "50%", borderRadius: 2 }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function StatusPage() {
  const [env, setEnv] = useState<Environment>("devnet");
  const { data, lastFetchedAt, error, loading, refetch } = useMonitoring(env);
  const now = useNow(1000);

  const ageSec =
    lastFetchedAt != null ? (now - lastFetchedAt.getTime()) / 1000 : null;
  const fresh = freshnessFromAge(ageSec, !!error);
  const showingStale = !!error && data != null;
  const isAuthError = error?.kind === "auth";

  // First-render state: no data yet, and no error. Show skeletons.
  const firstLoad = loading && data == null && !error;

  return (
    <div
      className="mx-auto px-6 py-6"
      style={{ maxWidth: 1200 }}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
        <div className="flex flex-col gap-1">
          <h1
            className="font-semibold"
            style={{
              fontSize: "var(--text-xl)",
              color: "var(--text-primary)",
              letterSpacing: "-0.01em",
            }}
          >
            Caster Status
          </h1>
          <div
            className="flex items-center gap-2 text-xs font-mono"
            style={{ color: "var(--text-secondary)" }}
          >
            <span
              aria-hidden="true"
              className="inline-block rounded-full"
              style={{
                width: 8,
                height: 8,
                background: fresh.color,
                boxShadow: `0 0 6px ${fresh.color}`,
                animation:
                  ageSec != null && ageSec < 60
                    ? "caster-pulse 2s ease-in-out infinite"
                    : undefined,
              }}
            />
            <span>Last updated {fresh.label}</span>
            {data?.meta?.hostname && (
              <span style={{ color: "var(--text-tertiary)" }}>
                · {data.meta.hostname}
              </span>
            )}
            <button
              type="button"
              onClick={refetch}
              className="ml-1 underline-offset-2 hover:underline"
              style={{
                color: "var(--text-tertiary)",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: 0,
                fontSize: "inherit",
                fontFamily: "inherit",
              }}
              title="Refresh now"
            >
              refresh
            </button>
          </div>
        </div>
        <EnvToggle env={env} onChange={setEnv} />
      </div>

      {/* Error banner */}
      {error && (
        <div
          role="alert"
          className="mb-4 rounded-lg p-3 text-xs font-mono"
          style={{
            background: isAuthError ? "var(--warning-dim)" : "var(--no-dim)",
            color: isAuthError ? "var(--warning)" : "var(--no)",
            border: `1px solid ${
              isAuthError ? "var(--warning)" : "var(--no)"
            }`,
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <span>
              {isAuthError
                ? "Authentication required — please refresh the page to re-enter credentials."
                : error.message}
              {showingStale && !isAuthError && (
                <span
                  className="ml-1"
                  style={{ color: "var(--text-secondary)" }}
                >
                  · showing last-known data
                </span>
              )}
            </span>
          </div>
        </div>
      )}

      {/* Widget grid */}
      <div
        className="grid gap-4"
        style={{
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
        }}
      >
        {firstLoad ? (
          <>
            <SkeletonCard fullWidth />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard fullWidth />
          </>
        ) : (
          <>
            <ServicesCard services={data?.services ?? null} />
            <ChainCard chain={data?.chain ?? null} />
            <ClpCard clp={data?.clp ?? null} />
            <BridgeCard bridge={data?.bridge ?? null} />
            <InfrastructureCard infra={data?.infrastructure ?? null} />
            <AlertsCard alerts={data?.alerts ?? null} />
          </>
        )}
      </div>

      {/* Footer meta */}
      {data?.meta && (
        <div
          className="mt-6 text-xs font-mono"
          style={{ color: "var(--text-tertiary)" }}
        >
          Generated {data.meta.generated_at} · env {data.meta.environment}
        </div>
      )}
    </div>
  );
}
