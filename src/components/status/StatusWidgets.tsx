"use client";

import type {
  Alert,
  AlertsStatus,
  BridgeStatus,
  ChainStatus,
  ClpStatus,
  InfrastructureStatus,
  ServiceStatus,
} from "@/types/monitoring";

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

export function StatusCard({
  title,
  children,
  unavailable,
  unavailableLabel,
  className,
  fullWidth,
}: {
  title: string;
  children?: React.ReactNode;
  unavailable?: boolean;
  unavailableLabel?: string;
  className?: string;
  fullWidth?: boolean;
}) {
  return (
    <section
      className={`glass rounded-lg p-4 flex flex-col gap-3 ${
        fullWidth ? "md:col-span-2" : ""
      } ${className ?? ""}`}
      style={{
        opacity: unavailable ? 0.55 : 1,
        minHeight: "100%",
      }}
      aria-busy={unavailable ? "true" : undefined}
    >
      <header className="flex items-center justify-between">
        <h2
          className="text-xs font-medium uppercase tracking-wider"
          style={{
            color: "var(--text-secondary)",
            letterSpacing: "0.08em",
          }}
        >
          {title}
        </h2>
        {unavailable && (
          <span
            className="text-xs font-mono px-2 py-0.5 rounded"
            style={{
              background: "var(--highlight)",
              color: "var(--text-tertiary)",
            }}
          >
            {unavailableLabel ?? "unavailable"}
          </span>
        )}
      </header>
      <div className="flex-1">{children}</div>
    </section>
  );
}

/** Dot indicator used by the service list + alert items. */
function Dot({ color, pulse = false }: { color: string; pulse?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block rounded-full"
      style={{
        width: 8,
        height: 8,
        background: color,
        boxShadow: `0 0 6px ${color}`,
        animation: pulse ? "caster-pulse 2s ease-in-out infinite" : undefined,
        flexShrink: 0,
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatUptime(seconds: number | null): string {
  if (seconds == null || seconds <= 0) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${seconds}s`;
}

function formatNumber(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString();
}

function serviceColor(state: string): string {
  if (state === "active") return "var(--yes)";
  if (state === "activating" || state === "deactivating") return "var(--warning)";
  return "var(--no)";
}

function ticksToCents(ticks: number): string {
  return (ticks / 10).toFixed(1);
}

function signedPct(v: number, digits = 2): string {
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(digits)}%`;
}

function signedUsd(v: number): string {
  const sign = v >= 0 ? "+" : "-";
  return `${sign}$${Math.abs(v).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

export function ServicesCard({ services }: { services: ServiceStatus[] | null }) {
  if (!services) {
    return <StatusCard title="Services" fullWidth unavailable />;
  }
  if (services.length === 0) {
    return (
      <StatusCard title="Services" fullWidth>
        <div
          className="text-xs italic"
          style={{ color: "var(--text-tertiary)" }}
        >
          No services reported.
        </div>
      </StatusCard>
    );
  }
  return (
    <StatusCard title="Services" fullWidth>
      <ul
        className="grid gap-x-4 gap-y-1.5"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}
      >
        {services.map((s) => (
          <li
            key={s.name}
            className="flex items-center justify-between text-xs font-mono"
            style={{ color: "var(--text-primary)" }}
          >
            <span className="flex items-center gap-2 min-w-0">
              <Dot color={serviceColor(s.state)} />
              <span className="truncate">{s.name}</span>
            </span>
            <span
              className="shrink-0 ml-2"
              style={{
                color:
                  s.state === "active"
                    ? "var(--text-secondary)"
                    : serviceColor(s.state),
              }}
              title={`${s.state}${s.restarts != null ? ` · ${s.restarts} restarts` : ""}`}
            >
              {s.state === "active"
                ? formatUptime(s.uptime_seconds)
                : s.state}
            </span>
          </li>
        ))}
      </ul>
    </StatusCard>
  );
}

// ---------------------------------------------------------------------------
// Chain
// ---------------------------------------------------------------------------

export function ChainCard({ chain }: { chain: ChainStatus | null }) {
  if (!chain || !chain.reachable) {
    return (
      <StatusCard
        title="Chain"
        unavailable
        unavailableLabel={chain ? "unreachable" : "unavailable"}
      >
        <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>
          Chain RPC did not respond.
        </div>
      </StatusCard>
    );
  }

  const advText = chain.advance
    ? `+${chain.advance.delta_height} blocks / ${chain.advance.delta_seconds}s`
    : "—";
  const fd = chain.fd_usage;
  const fdPct = fd ? Math.max(0, Math.min(100, fd.percent)) : 0;
  const fdColor =
    fdPct >= 90
      ? "var(--no)"
      : fdPct >= 70
      ? "var(--warning)"
      : "var(--yes)";

  return (
    <StatusCard title="Chain">
      <div className="flex flex-col gap-3">
        <div>
          <div
            className="font-mono"
            style={{ fontSize: 28, lineHeight: 1, color: "var(--text-primary)" }}
          >
            {chain.height != null ? chain.height.toLocaleString() : "—"}
          </div>
          <div
            className="text-xs font-mono mt-1"
            style={{ color: "var(--text-secondary)" }}
          >
            {chain.chain_id ?? "—"}
            {chain.block_time_ms != null ? ` · ${chain.block_time_ms}ms blocks` : ""}
          </div>
          <div
            className="text-xs font-mono mt-0.5"
            style={{ color: "var(--text-tertiary)" }}
          >
            advancing {advText}
          </div>
        </div>
        {fd && (
          <div>
            <div
              className="flex justify-between text-xs font-mono"
              style={{ color: "var(--text-secondary)" }}
            >
              <span>FD usage</span>
              <span>
                {fd.used.toLocaleString()} / {fd.limit.toLocaleString()} ({fdPct}%)
              </span>
            </div>
            <div
              className="mt-1 h-1.5 rounded overflow-hidden"
              style={{ background: "var(--highlight)" }}
            >
              <div
                style={{
                  width: `${fdPct}%`,
                  height: "100%",
                  background: fdColor,
                  transition: "width 400ms ease-out",
                }}
              />
            </div>
          </div>
        )}
      </div>
    </StatusCard>
  );
}

// ---------------------------------------------------------------------------
// CLP
// ---------------------------------------------------------------------------

export function ClpCard({ clp }: { clp: ClpStatus | null }) {
  if (!clp || !clp.active) {
    return (
      <StatusCard
        title="CLP"
        unavailable
        unavailableLabel={clp ? "inactive" : "unavailable"}
      >
        <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>
          CLP strategy is not running.
        </div>
      </StatusCard>
    );
  }

  const freshness = clp.analytics_status;
  const freshnessColor =
    freshness === "fresh"
      ? "var(--yes)"
      : freshness === "stale"
      ? "var(--warning)"
      : "var(--no)";
  const ageLabel =
    clp.analytics_age_seconds != null ? `${clp.analytics_age_seconds}s` : "—";

  return (
    <StatusCard title="CLP">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-xs font-mono">
          <span style={{ color: "var(--text-secondary)" }}>Analytics</span>
          <span className="flex items-center gap-1.5">
            <Dot color={freshnessColor} />
            <span style={{ color: "var(--text-primary)" }}>
              {freshness ?? "—"} · {ageLabel}
            </span>
          </span>
        </div>
        {clp.markets.length === 0 ? (
          <div
            className="text-xs italic"
            style={{ color: "var(--text-tertiary)" }}
          >
            No market data.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table
              className="w-full text-xs font-mono"
              style={{ borderCollapse: "collapse" }}
            >
              <thead>
                <tr
                  style={{
                    color: "var(--text-tertiary)",
                    borderBottom: "1px solid var(--border-default)",
                  }}
                >
                  <th className="text-left py-1 pr-2 font-medium">Mkt</th>
                  <th className="text-right py-1 px-2 font-medium">Mid</th>
                  <th className="text-right py-1 px-2 font-medium">Net Pos</th>
                  <th className="text-right py-1 px-2 font-medium">Exp%</th>
                  <th className="text-right py-1 px-2 font-medium">P&amp;L</th>
                  <th className="text-right py-1 pl-2 font-medium">Requote</th>
                </tr>
              </thead>
              <tbody>
                {clp.markets.map((m) => {
                  const saturated = Math.abs(m.net_position) > 0.5;
                  const requoteAge = m.last_requote_age_seconds;
                  const requoteColor =
                    requoteAge == null
                      ? "var(--text-tertiary)"
                      : requoteAge > 120
                      ? "var(--no)"
                      : requoteAge > 30
                      ? "var(--warning)"
                      : "var(--text-secondary)";
                  const pnlColor =
                    m.realized_pnl_usd > 0
                      ? "var(--yes)"
                      : m.realized_pnl_usd < 0
                      ? "var(--no)"
                      : "var(--text-primary)";
                  return (
                    <tr
                      key={m.market_id}
                      style={{
                        borderBottom: "1px solid var(--border-default)",
                        color: "var(--text-primary)",
                      }}
                    >
                      <td className="py-1 pr-2">#{m.market_id}</td>
                      <td className="text-right py-1 px-2">
                        {m.mid_ticks != null ? `${ticksToCents(m.mid_ticks)}¢` : "—"}
                      </td>
                      <td
                        className="text-right py-1 px-2"
                        style={{
                          color: saturated ? "var(--no)" : "var(--text-primary)",
                        }}
                        title={saturated ? "|q| > 0.5 — saturation risk" : undefined}
                      >
                        {m.net_position > 0 ? "+" : ""}
                        {m.net_position}
                      </td>
                      <td className="text-right py-1 px-2">
                        {m.exposure_pct.toFixed(1)}%
                      </td>
                      <td
                        className="text-right py-1 px-2"
                        style={{ color: pnlColor }}
                      >
                        {signedUsd(m.realized_pnl_usd)}{" "}
                        <span style={{ color: "var(--text-tertiary)" }}>
                          ({signedPct(m.realized_pct)})
                        </span>
                      </td>
                      <td
                        className="text-right py-1 pl-2"
                        style={{ color: requoteColor }}
                      >
                        {requoteAge != null ? `${requoteAge}s` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </StatusCard>
  );
}

// ---------------------------------------------------------------------------
// Bridge
// ---------------------------------------------------------------------------

export function BridgeCard({ bridge }: { bridge: BridgeStatus | null }) {
  if (!bridge || !bridge.active) {
    return (
      <StatusCard
        title="Bridge"
        unavailable
        unavailableLabel={bridge ? "inactive" : "unavailable"}
      >
        <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>
          Bridge scanner is not running.
        </div>
      </StatusCard>
    );
  }
  const lag =
    bridge.latest_scanned != null && bridge.scan_cursor != null
      ? bridge.latest_scanned - bridge.scan_cursor
      : null;
  const lagColor =
    lag == null
      ? "var(--text-tertiary)"
      : lag > 50
      ? "var(--warning)"
      : "var(--text-primary)";

  return (
    <StatusCard title="Bridge">
      <div className="flex flex-col gap-3 text-xs font-mono">
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          <div>
            <div style={{ color: "var(--text-secondary)" }}>Cursor</div>
            <div style={{ color: "var(--text-primary)" }}>
              {formatNumber(bridge.scan_cursor)}
            </div>
          </div>
          <div>
            <div style={{ color: "var(--text-secondary)" }}>Head</div>
            <div style={{ color: "var(--text-primary)" }}>
              {formatNumber(bridge.latest_scanned)}
            </div>
          </div>
          <div>
            <div style={{ color: "var(--text-secondary)" }}>Lag</div>
            <div style={{ color: lagColor }}>
              {lag != null ? `${lag} blocks` : "—"}
            </div>
          </div>
        </div>
        <div
          className="grid grid-cols-2 gap-x-3 gap-y-1.5 pt-2"
          style={{ borderTop: "1px solid var(--border-default)" }}
        >
          <div>
            <div style={{ color: "var(--text-secondary)" }}>Deposits</div>
            <div style={{ color: "var(--text-primary)" }}>
              {formatNumber(bridge.deposits?.total)}
              <span
                className="ml-1"
                style={{ color: "var(--text-tertiary)" }}
              >
                ({bridge.deposits?.last_hour ?? 0}/h)
              </span>
            </div>
          </div>
          <div>
            <div style={{ color: "var(--text-secondary)" }}>Withdrawals</div>
            <div style={{ color: "var(--text-primary)" }}>
              {formatNumber(bridge.withdrawals?.total)}
              <span
                className="ml-1"
                style={{ color: "var(--text-tertiary)" }}
              >
                ({bridge.withdrawals?.last_hour ?? 0}/h)
              </span>
            </div>
          </div>
        </div>
      </div>
    </StatusCard>
  );
}

// ---------------------------------------------------------------------------
// Infrastructure
// ---------------------------------------------------------------------------

export function InfrastructureCard({ infra }: { infra: InfrastructureStatus | null }) {
  if (!infra) {
    return <StatusCard title="Infrastructure" unavailable />;
  }
  const disk = infra.disk;
  const mem = infra.memory;
  const tls = infra.tls;
  const diskPct = disk ? Math.max(0, Math.min(100, disk.used_pct)) : 0;
  const diskColor =
    diskPct >= 90
      ? "var(--no)"
      : diskPct >= 75
      ? "var(--warning)"
      : "var(--yes)";
  const tlsColor =
    !tls
      ? "var(--text-tertiary)"
      : tls.status === "critical" || tls.days_remaining < 7
      ? "var(--no)"
      : tls.status === "warning" || tls.days_remaining < 30
      ? "var(--warning)"
      : "var(--yes)";

  return (
    <StatusCard title="Infrastructure">
      <div className="flex flex-col gap-3 text-xs font-mono">
        {disk ? (
          <div>
            <div
              className="flex justify-between"
              style={{ color: "var(--text-secondary)" }}
            >
              <span>Disk</span>
              <span style={{ color: "var(--text-primary)" }}>
                {diskPct}% used · {disk.free_gb.toFixed(1)} GB free
              </span>
            </div>
            <div
              className="mt-1 h-1.5 rounded overflow-hidden"
              style={{ background: "var(--highlight)" }}
            >
              <div
                style={{
                  width: `${diskPct}%`,
                  height: "100%",
                  background: diskColor,
                  transition: "width 400ms ease-out",
                }}
              />
            </div>
          </div>
        ) : (
          <div
            className="flex justify-between"
            style={{ color: "var(--text-secondary)" }}
          >
            <span>Disk</span>
            <span style={{ color: "var(--text-tertiary)" }}>—</span>
          </div>
        )}
        <div
          className="flex justify-between"
          style={{ color: "var(--text-secondary)" }}
        >
          <span>Memory available</span>
          <span style={{ color: "var(--text-primary)" }}>
            {mem ? `${mem.available_mb.toLocaleString()} MB` : "—"}
          </span>
        </div>
        <div
          className="flex justify-between"
          style={{ color: "var(--text-secondary)" }}
        >
          <span>TLS</span>
          <span style={{ color: tlsColor }}>
            {tls
              ? `${tls.domain} · ${tls.days_remaining}d`
              : "—"}
          </span>
        </div>
      </div>
    </StatusCard>
  );
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

function severityStyle(severity: string): { bg: string; fg: string } {
  if (severity === "CRITICAL") {
    return { bg: "var(--no-dim)", fg: "var(--no)" };
  }
  if (severity === "WARNING") {
    return { bg: "var(--warning-dim)", fg: "var(--warning)" };
  }
  return { bg: "var(--info-dim)", fg: "var(--info)" };
}

function AlertRow({ alert }: { alert: Alert }) {
  const st = severityStyle(alert.severity);
  let since = alert.since;
  try {
    const d = new Date(alert.since);
    since = d.toLocaleString();
  } catch {
    // keep raw string
  }
  return (
    <li
      className="flex items-start gap-3 py-2"
      style={{ borderBottom: "1px solid var(--border-default)" }}
    >
      <span
        className="text-xs font-mono px-1.5 py-0.5 rounded shrink-0"
        style={{
          background: st.bg,
          color: st.fg,
          letterSpacing: "0.05em",
        }}
      >
        {alert.severity}
      </span>
      <div className="flex-1 min-w-0">
        <div
          className="text-xs"
          style={{ color: "var(--text-primary)" }}
        >
          {alert.message}
        </div>
        <div
          className="text-xs font-mono mt-0.5"
          style={{ color: "var(--text-tertiary)" }}
        >
          {alert.key} · since {since}
        </div>
      </div>
    </li>
  );
}

export function AlertsCard({ alerts }: { alerts: AlertsStatus | null }) {
  if (!alerts) {
    return <StatusCard title="Alerts" fullWidth unavailable />;
  }
  if (alerts.active_count === 0 || alerts.active.length === 0) {
    return (
      <StatusCard title="Alerts" fullWidth>
        <div
          className="flex items-center gap-2 text-xs font-mono"
          style={{ color: "var(--yes)" }}
        >
          <Dot color="var(--yes)" />
          <span>No active alerts.</span>
        </div>
      </StatusCard>
    );
  }
  return (
    <StatusCard title={`Alerts (${alerts.active_count})`} fullWidth>
      <ul className="flex flex-col">
        {alerts.active.map((a) => (
          <AlertRow key={a.key} alert={a} />
        ))}
      </ul>
    </StatusCard>
  );
}
