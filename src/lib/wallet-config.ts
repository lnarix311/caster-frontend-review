import { arbitrumSepolia } from "viem/chains";
import { getDefaultConfig } from "@rainbow-me/rainbowkit";

export const wagmiConfig = getDefaultConfig({
  appName: "Caster",
  projectId: "caster-dev", // WalletConnect project ID (placeholder for dev)
  chains: [arbitrumSepolia],
  ssr: true,
});

// ---------------------------------------------------------------------------
// Bridge constants
// ---------------------------------------------------------------------------

export const BRIDGE_CONTRACT = (process.env.NEXT_PUBLIC_BRIDGE_CONTRACT ||
  "0x0000000000000000000000000000000000000000") as `0x${string}`;

// Arbitrum Sepolia USDC (Circle testnet)
export const USDC_ADDRESS =
  "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d" as `0x${string}`;

export const USDC_DECIMALS = 6;

/** Minimum deposit: $5 = 5_000_000 USDC units = 5000 ticks */
export const MIN_DEPOSIT_USDC = BigInt(5_000_000);
export const MIN_DEPOSIT_TICKS = 5000;

/** Withdrawal fee: 1 USDC = 1000 ticks */
export const WITHDRAW_FEE_TICKS = 1000;

/** Bridge chain — Arbitrum Sepolia for testnet, switch to arbitrum for mainnet */
export const bridgeChain = arbitrumSepolia;
