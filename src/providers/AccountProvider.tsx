"use client";

import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { useAccount as useWagmiAccount, useWalletClient } from "wagmi";
import type { WalletClient } from "viem";
import * as api from "@/lib/api";
import { getWsClient } from "@/lib/ws";

interface AccountContextValue {
  /** Connected account info, or null if not connected */
  account: { address: `0x${string}`; balance: number; nonce: number } | null;
  /** The viem WalletClient for signing (null if not connected) */
  walletClient: WalletClient | null;
  /** Whether account data is loading */
  loading: boolean;
  /** Refresh balance and nonce from chain */
  refresh: () => Promise<void>;
  /** Claim testnet faucet tokens */
  claimFaucet: () => Promise<void>;
  /** Update balance directly from a WebSocket event (no API call) */
  updateBalance: (balance: number) => void;
}

const AccountContext = createContext<AccountContextValue>({
  account: null,
  walletClient: null,
  loading: false,
  refresh: async () => {},
  claimFaucet: async () => {},
  updateBalance: () => {},
});

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const { address, isConnected } = useWagmiAccount();
  const { data: walletClient } = useWalletClient();
  const [balance, setBalance] = useState(0);
  const [nonce, setNonce] = useState(0);
  const [loading, setLoading] = useState(false);

  // Track whether we have already called the faucet for this address
  const faucetedRef = useRef<Set<string>>(new Set());

  // Fetch balance/nonce whenever address changes
  useEffect(() => {
    if (!address) {
      setBalance(0);
      setNonce(0);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const init = async () => {
      try {
        const { balance: b, nonce: n } = await api.getAccount(address);
        if (!cancelled) {
          setBalance(b);
          setNonce(n);
        }
      } catch {
        // Account doesn't exist on chain yet -- auto-faucet for new users
        if (!cancelled && !faucetedRef.current.has(address)) {
          faucetedRef.current.add(address);
          try {
            await api.claimFaucet(address);
            const { balance: b, nonce: n } = await api.getAccount(address);
            if (!cancelled) {
              setBalance(b);
              setNonce(n);
            }
          } catch {
            // Failed to faucet, user can try manually
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    init();
    return () => { cancelled = true; };
  }, [address]);

  const refresh = useCallback(async () => {
    if (!address) return;
    try {
      const { balance: b, nonce: n } = await api.getAccount(address);
      setBalance(b);
      setNonce(n);
    } catch {
      // Account may not exist on chain (restart)
      setBalance(0);
      setNonce(0);
    }
  }, [address]);

  // Keep a live ref to `refresh` so the reconnect subscription (below) always
  // calls the current closure, without re-subscribing every time `address`
  // changes.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  // Resync balance/nonce when the WebSocket reconnects. While offline we may
  // have missed `balance_update` events, so the cached balance could be stale.
  // Only active when an address is connected — no-op otherwise.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!address) return;
    const unsubscribe = getWsClient().addConnectListener(() => {
      // Fire-and-forget; errors are swallowed inside refresh().
      refreshRef.current();
    });
    return unsubscribe;
  }, [address]);

  const claimFaucet = useCallback(async () => {
    if (!address) return;
    await api.claimFaucet(address);
    // Refresh after claim
    const { balance: b, nonce: n } = await api.getAccount(address);
    setBalance(b);
    setNonce(n);
  }, [address]);

  const updateBalance = useCallback((newBalance: number) => {
    setBalance(newBalance);
  }, []);

  const account = isConnected && address
    ? { address, balance, nonce }
    : null;

  return (
    <AccountContext.Provider
      value={{
        account,
        walletClient: walletClient ?? null,
        loading,
        refresh,
        claimFaucet,
        updateBalance,
      }}
    >
      {children}
    </AccountContext.Provider>
  );
}

export const useAccount = () => useContext(AccountContext);
