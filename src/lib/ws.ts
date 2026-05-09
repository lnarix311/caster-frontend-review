import type { WsServerMessage, MarketId, AccountId } from "./types";

type Listener = (msg: WsServerMessage) => void;
type ConnectListener = () => void;

class WebSocketClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private connectListeners = new Set<ConnectListener>();
  private reconnectDelay = 1000;
  private maxDelay = 30000;
  private url: string;
  private shouldReconnect = true;
  private pendingMessages: unknown[] = [];
  /** Tracks whether we've had at least one successful open; used to distinguish
   *  reconnects from the initial connect. */
  private hasOpenedBefore = false;

  constructor(url: string) {
    this.url = url;
  }

  connect() {
    if (
      this.ws?.readyState === WebSocket.OPEN ||
      this.ws?.readyState === WebSocket.CONNECTING
    ) return;

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this.reconnectDelay = 1000;
        // Flush any messages queued before the socket was open
        for (const msg of this.pendingMessages) {
          this.ws!.send(JSON.stringify(msg));
        }
        this.pendingMessages = [];
        // Notify connect listeners. Consumers use this to resync state that
        // may have drifted while we were offline (missed balance_update, etc.)
        const wasReconnect = this.hasOpenedBefore;
        this.hasOpenedBefore = true;
        if (wasReconnect) {
          this.connectListeners.forEach((fn) => {
            try { fn(); } catch { /* swallow listener errors */ }
          });
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const msg: WsServerMessage = JSON.parse(event.data);
          this.listeners.forEach((fn) => fn(msg));
        } catch {
          // Ignore malformed messages
        }
      };

      this.ws.onclose = () => {
        if (this.shouldReconnect) {
          setTimeout(() => this.connect(), this.reconnectDelay);
          this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxDelay);
        }
      };

      this.ws.onerror = () => {
        this.ws?.close();
      };
    } catch {
      setTimeout(() => this.connect(), this.reconnectDelay);
    }
  }

  disconnect() {
    this.shouldReconnect = false;
    this.ws?.close();
  }

  subscribe(channels: string[], marketId?: MarketId) {
    this.send({
      type: "subscribe",
      channels,
      market_id: marketId ?? null,
    });
  }

  auth(accountId: AccountId) {
    this.send({ type: "auth", account_id: accountId });
  }

  addListener(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Register a callback fired whenever the WS *reconnects* (not the initial
   *  connect). Returns an unsubscribe function. */
  addConnectListener(fn: ConnectListener): () => void {
    this.connectListeners.add(fn);
    return () => { this.connectListeners.delete(fn); };
  }

  private send(data: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else {
      // Buffer messages until socket opens
      this.pendingMessages.push(data);
    }
  }
}

// Singleton — determine URL based on window location
let client: WebSocketClient | null = null;

export function getWsClient(): WebSocketClient {
  if (!client && typeof window !== "undefined") {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    client = new WebSocketClient(`${protocol}//${host}/ws`);
  }
  // Fallback for SSR (should never actually be used)
  if (!client) {
    client = new WebSocketClient("ws://localhost:9000/ws");
  }
  return client;
}
