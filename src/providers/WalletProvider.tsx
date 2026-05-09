"use client";

import dynamic from "next/dynamic";

// Dynamically import the actual provider to avoid SSR issues with wagmi/RainbowKit
// localStorage and other browser APIs are not available during SSR
const WalletProviderInner = dynamic(
  () => import("./WalletProviderInner").then((m) => m.WalletProviderInner),
  { ssr: false },
);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  return <WalletProviderInner>{children}</WalletProviderInner>;
}
