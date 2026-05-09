/**
 * Schema for /status/{env}.json -- nginx-served monitoring snapshots generated
 * by the devops cron. Both devnet and testnet use an identical shape; anything
 * that is unavailable may be null, or the top-level `active`/`reachable`
 * field may be false. Components must render gracefully in those cases.
 *
 * This file is intentionally self-contained (no imports) so the /status
 * route can render without any server-side dependencies.
 */

export type Environment = "devnet" | "testnet";

export type ServiceState =
  | "active"
  | "inactive"
  | "failed"
  | "activating"
  | "deactivating"
  | "unknown";

export type AlertSeverity = "CRITICAL" | "WARNING" | "INFO";

export interface Meta {
  hostname: string;
  environment: string;
  generated_at: string;
  generated_epoch: number;
}

export interface ServiceStatus {
  name: string;
  state: ServiceState | string;
  uptime_seconds: number | null;
  restarts: number | null;
}

export interface ChainAdvance {
  delta_height: number;
  delta_seconds: number;
}

export interface FdUsage {
  used: number;
  limit: number;
  percent: number;
}

export interface ChainStatus {
  reachable: boolean;
  height: number | null;
  chain_id: string | null;
  block_time_ms: number | null;
  advance: ChainAdvance | null;
  fd_usage: FdUsage | null;
}

export interface ClpMarketRow {
  market_id: number;
  net_position: number;
  exposure_pct: number;
  realized_pnl_usd: number;
  realized_pct: number;
  last_requote_age_seconds: number | null;
  mid_ticks: number | null;
}

export interface ClpStatus {
  active: boolean;
  analytics_age_seconds: number | null;
  analytics_status: "fresh" | "stale" | "missing" | string | null;
  markets: ClpMarketRow[];
}

export interface BridgeCounts {
  total: number;
  last_hour: number;
}

export interface BridgeStatus {
  active: boolean;
  scan_cursor: number | null;
  latest_scanned: number | null;
  deposits: BridgeCounts | null;
  withdrawals: BridgeCounts | null;
}

export interface DiskStatus {
  used_pct: number;
  free_gb: number;
}

export interface MemoryStatus {
  available_mb: number;
}

export interface TlsStatus {
  domain: string;
  days_remaining: number;
  status: "ok" | "warning" | "critical" | string;
}

export interface InfrastructureStatus {
  disk: DiskStatus | null;
  memory: MemoryStatus | null;
  tls: TlsStatus | null;
}

export interface Alert {
  key: string;
  severity: AlertSeverity | string;
  message: string;
  since: string;
}

export interface AlertsStatus {
  active_count: number;
  active: Alert[];
}

export interface MonitoringSnapshot {
  meta: Meta;
  services: ServiceStatus[] | null;
  chain: ChainStatus | null;
  clp: ClpStatus | null;
  bridge: BridgeStatus | null;
  infrastructure: InfrastructureStatus | null;
  alerts: AlertsStatus | null;
}
