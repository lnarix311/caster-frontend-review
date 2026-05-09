"use client";

import { createContext, useContext, useEffect, useRef, useCallback } from "react";
import { getWsClient } from "@/lib/ws";
import { useAccount } from "./AccountProvider";
import type { WsServerMessage } from "@/lib/types";

type Listener = (msg: WsServerMessage) => void;
type ConnectListener = () => void;

interface WsContextValue {
  subscribe: (channels: string[], marketId?: string) => void;
  addListener: (fn: Listener) => () => void;
  /** Register a handler fired when the WebSocket *reconnects*. Use this to
   *  resync cached state that may have drifted while offline. */
  addConnectListener: (fn: ConnectListener) => () => void;
}

const WsContext = createContext<WsContextValue>({
  subscribe: () => {},
  addListener: () => () => {},
  addConnectListener: () => () => {},
});

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const { account } = useAccount();
  const connectedRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const client = getWsClient();
    if (!connectedRef.current) {
      client.connect();
      connectedRef.current = true;
    }
    if (account) {
      // Send the 0x-prefixed address as the account_id
      client.auth(account.address);
      client.subscribe(["account"]);
    }
  }, [account]);

  const subscribe = useCallback((channels: string[], marketId?: string) => {
    getWsClient().subscribe(channels, marketId);
  }, []);

  const addListener = useCallback((fn: Listener) => {
    return getWsClient().addListener(fn);
  }, []);

  const addConnectListener = useCallback((fn: ConnectListener) => {
    return getWsClient().addConnectListener(fn);
  }, []);

  return (
    <WsContext.Provider value={{ subscribe, addListener, addConnectListener }}>
      {children}
    </WsContext.Provider>
  );
}

export const useWs = () => useContext(WsContext);
