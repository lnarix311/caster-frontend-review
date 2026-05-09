"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";

// =============================================================================
// Stream Configuration
// =============================================================================

export interface SynopticStream {
  id: string;
  name: string;
  category: string;
}

export const SYNOPTIC_STREAMS: SynopticStream[] = [
  {
    id: "01JEYDKB3PH1WJ1BANH2V0H9HP",
    name: "Trump Truth Social",
    category: "Politics",
  },
  {
    id: "01J366F54MX6HBQHATHN7CHS06",
    name: "Economic Indicators",
    category: "Economics",
  },
  {
    id: "01JJ2C5SZ56VJYSZ2054GG8HTG",
    name: "Crypto News (Twitter)",
    category: "Crypto",
  },
  {
    id: "01J4D3D201CN0EMAJFZG27RCPJ",
    name: "Iran-Israel OSINT",
    category: "Geopolitics",
  },
  {
    id: "01JP3HYXN11BXQ5RBD27XHE704",
    name: "Finance & Business Media",
    category: "Finance",
  },
  {
    id: "01JP74Q0ABH9ABE2BM39061J4Z",
    name: "PR Newswire",
    category: "Press Releases",
  },
];

const STREAM_NAME_MAP = new Map(SYNOPTIC_STREAMS.map((s) => [s.id, s.name]));
const STREAM_CATEGORY_MAP = new Map(
  SYNOPTIC_STREAMS.map((s) => [s.id, s.category]),
);

// =============================================================================
// Types
// =============================================================================

export interface SynopticItem {
  /** Unique post ID from Synoptic */
  id: string;
  /** Stream ID this post belongs to */
  streamId: string;
  /** Human-readable stream name */
  source: string;
  /** Post content as plain text */
  text: string;
  /** Optional markdown-formatted content */
  markdown?: string;
  /** Category derived from stream config */
  category: string;
  /** ISO 8601 timestamp */
  createdAt: string;
  /** Parsed Date for sorting */
  timestamp: number;
}

interface SynopticPostPayload {
  id?: string;
  streamId?: string;
  text?: string;
  markdown?: string;
  createdAt?: string;
  content?: string;
  metadata?: Record<string, unknown>;
}

// =============================================================================
// Constants
// =============================================================================

const WS_ENDPOINT = "wss://api.synoptic.com/v1/ws";
const MAX_ITEMS = 50;
const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 30000;
const LAST_POSTS_ON_CONNECT = 5;
/** Send a ping every 30s to detect stale connections */
const HEARTBEAT_INTERVAL_MS = 30_000;
/** Close socket if no pong received within this window */
const HEARTBEAT_TIMEOUT_MS = 10_000;

// =============================================================================
// Hook
// =============================================================================

export function useSynopticFeed(streamIds: string[]) {
  const [items, setItems] = useState<SynopticItem[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pongTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  // Stable reference for streamIds to avoid reconnect loops
  const streamIdsKey = useMemo(() => streamIds.join(","), [streamIds]);

  /**
   * Extract a post from various possible Synoptic message shapes:
   * - Direct post object: { id, streamId, text, ... }
   * - Envelope wrapper: { event: "post", data: { id, streamId, text, ... } }
   * - Nested post: { post: { id, streamId, text, ... } }
   */
  const extractPost = useCallback(
    (raw: Record<string, unknown>): SynopticPostPayload | null => {
      // If it looks like an envelope, unwrap
      if (raw.event && raw.data && typeof raw.data === "object") {
        return raw.data as SynopticPostPayload;
      }
      if (raw.post && typeof raw.post === "object") {
        return raw.post as SynopticPostPayload;
      }
      // Direct post object
      if (raw.id || raw.streamId || raw.text || raw.content) {
        return raw as unknown as SynopticPostPayload;
      }
      return null;
    },
    [],
  );

  const parsePost = useCallback(
    (raw: SynopticPostPayload): SynopticItem | null => {
      const id = raw.id;
      const streamId = raw.streamId;
      const text = raw.text || raw.content || raw.markdown || "";
      if (!id || !streamId || !text) return null;

      const createdAt = raw.createdAt || new Date().toISOString();
      const timestamp = new Date(createdAt).getTime();
      if (isNaN(timestamp)) return null;

      return {
        id,
        streamId,
        source: STREAM_NAME_MAP.get(streamId) || "Unknown",
        text: text.length > 300 ? text.slice(0, 297) + "..." : text,
        markdown: raw.markdown,
        category: STREAM_CATEGORY_MAP.get(streamId) || "News",
        createdAt,
        timestamp,
      };
    },
    [],
  );

  const addItem = useCallback((item: SynopticItem) => {
    setItems((prev) => {
      // Deduplicate by ID
      if (prev.some((p) => p.id === item.id)) return prev;
      const next = [item, ...prev];
      // Sort newest first and cap at MAX_ITEMS
      next.sort((a, b) => b.timestamp - a.timestamp);
      if (next.length > MAX_ITEMS) next.length = MAX_ITEMS;
      return next;
    });
  }, []);

  /** Stop heartbeat timers */
  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    if (pongTimerRef.current) {
      clearTimeout(pongTimerRef.current);
      pongTimerRef.current = null;
    }
  }, []);

  /** Start periodic ping to detect stale connections */
  const startHeartbeat = useCallback(
    (ws: WebSocket) => {
      stopHeartbeat();
      heartbeatRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({ event: "ping" }));
          } catch {
            // Send failed -- socket is likely broken
          }
          // If we don't get any message within the timeout, force-close
          pongTimerRef.current = setTimeout(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.close();
            }
          }, HEARTBEAT_TIMEOUT_MS);
        }
      }, HEARTBEAT_INTERVAL_MS);
    },
    [stopHeartbeat],
  );

  const connect = useCallback(() => {
    const apiKey = process.env.NEXT_PUBLIC_SYNOPTIC_API_KEY;
    if (!apiKey) {
      setError("NEXT_PUBLIC_SYNOPTIC_API_KEY not configured");
      return;
    }
    if (!streamIdsKey) return;

    // Clean up any existing connection
    stopHeartbeat();
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.onopen = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    const params = new URLSearchParams({
      apiKey,
      streamIds: streamIdsKey,
      lastPosts: String(LAST_POSTS_ON_CONNECT),
    });

    const url = `${WS_ENDPOINT}/on-stream-post?${params.toString()}`;

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) return;
        setConnected(true);
        setError(null);
        reconnectAttemptRef.current = 0;
        startHeartbeat(ws);
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;

        // Any message counts as a pong -- clear the heartbeat timeout
        if (pongTimerRef.current) {
          clearTimeout(pongTimerRef.current);
          pongTimerRef.current = null;
        }

        try {
          const data =
            typeof event.data === "string"
              ? JSON.parse(event.data)
              : event.data;

          // Skip control/ack messages (e.g., {event: "pong"}, {status: "ok"})
          if (
            data &&
            typeof data === "object" &&
            !Array.isArray(data) &&
            (data.event === "pong" || data.type === "pong" || data.status)
          ) {
            return;
          }

          // Synoptic may send a single post object or an array (for lastPosts backfill)
          const rawItems: Record<string, unknown>[] = Array.isArray(data)
            ? data
            : [data];

          for (const raw of rawItems) {
            if (!raw || typeof raw !== "object") continue;
            const post = extractPost(raw);
            if (post) {
              const item = parsePost(post);
              if (item) addItem(item);
            }
          }
        } catch {
          // Non-JSON control messages (pings, etc.) -- ignore
        }
      };

      ws.onerror = () => {
        if (!mountedRef.current) return;
        setError("WebSocket error");
        setConnected(false);
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        setConnected(false);
        stopHeartbeat();
        wsRef.current = null;

        // Exponential backoff reconnect
        const attempt = reconnectAttemptRef.current;
        const delay = Math.min(
          RECONNECT_BASE_MS * Math.pow(2, attempt),
          RECONNECT_MAX_MS,
        );
        reconnectAttemptRef.current = attempt + 1;

        reconnectTimerRef.current = setTimeout(() => {
          if (mountedRef.current) connect();
        }, delay);
      };
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to connect to Synoptic",
      );
    }
  }, [streamIdsKey, extractPost, parsePost, addItem, startHeartbeat, stopHeartbeat]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      stopHeartbeat();
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect, stopHeartbeat]);

  return { items, connected, error };
}

// =============================================================================
// Utility: relative time formatting
// =============================================================================

export function formatRelativeTime(isoOrTimestamp: string | number): string {
  const ts =
    typeof isoOrTimestamp === "string"
      ? new Date(isoOrTimestamp).getTime()
      : isoOrTimestamp;
  const now = Date.now();
  const diffSec = Math.max(0, Math.floor((now - ts) / 1000));

  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}
