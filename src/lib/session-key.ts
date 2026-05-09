/**
 * Session Key management for signless trading.
 *
 * A session key is a browser-generated secp256k1 keypair that the user approves
 * once via their wallet (MetaMask/Rabby). After approval, all PlaceOrder,
 * CancelOrder, and MergeRedeem transactions are signed locally without wallet
 * popups.
 *
 * The session key can only trade -- it cannot withdraw funds or perform
 * admin operations. It expires after a configurable duration (default 3 days).
 *
 * Storage: localStorage (persist across tabs) or sessionStorage (current tab only).
 * Both are checked on load; localStorage takes priority.
 */

import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak256, hashTypedData, serializeSignature, type Hex } from "viem";
import { CASTER_DOMAIN } from "./signing";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StoredSessionKey {
  /** Hex-encoded private key without 0x prefix */
  privateKey: string;
  /** 0x-prefixed Ethereum address of the session key */
  address: `0x${string}`;
  /** 0x-prefixed address of the wallet that approved this key */
  owner: `0x${string}`;
  /** Expiry timestamp in milliseconds since epoch */
  expiresAt: number;
  /** Human-readable label for this key */
  label: string;
  /** true = localStorage (persists), false = sessionStorage (tab only) */
  persist: boolean;
}

export interface SessionKeyInfo {
  address: string;
  owner: string;
  label: string;
  expires_at: number;
  created_at: number;
  is_expired: boolean;
}

/** Default session key duration: 3 days in milliseconds */
export const SESSION_KEY_DURATION_MS = 3 * 24 * 60 * 60 * 1000;

const STORAGE_KEY = "caster_session_key";

// ---------------------------------------------------------------------------
// Key generation
// ---------------------------------------------------------------------------

/**
 * Generate a new random secp256k1 keypair.
 *
 * Returns the hex-encoded private key (no 0x prefix) and the derived
 * Ethereum address (0x-prefixed, checksummed is not required since the
 * chain lowercases on comparison).
 */
export function generateSessionKey(): { privateKey: string; address: `0x${string}` } {
  const privBytes = crypto.getRandomValues(new Uint8Array(32));
  const privateKey = bytesToHex(privBytes);

  // Uncompressed public key (65 bytes: 0x04 prefix + 32 bytes X + 32 bytes Y)
  const pubKeyFull = secp256k1.getPublicKey(privBytes, false);
  // Address = last 20 bytes of keccak256(pubkey_without_04_prefix)
  const pubKeyNoPrefix = pubKeyFull.slice(1);
  const hash = keccak256(
    `0x${bytesToHex(pubKeyNoPrefix)}` as Hex,
  );
  const address = `0x${hash.slice(hash.length - 40)}` as `0x${string}`;

  return { privateKey, address };
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/** Store a session key in the browser. */
export function storeSessionKey(key: StoredSessionKey): void {
  const storage = key.persist ? localStorage : sessionStorage;
  storage.setItem(STORAGE_KEY, JSON.stringify(key));
}

/**
 * Load the active session key from storage.
 * Checks localStorage first, then sessionStorage.
 * Returns null if no key is stored or if the key is expired.
 */
export function loadSessionKey(): StoredSessionKey | null {
  const data =
    localStorage.getItem(STORAGE_KEY) || sessionStorage.getItem(STORAGE_KEY);
  if (!data) return null;
  try {
    const key: StoredSessionKey = JSON.parse(data);
    if (key.expiresAt <= Date.now()) {
      clearSessionKey();
      return null;
    }
    return key;
  } catch {
    clearSessionKey();
    return null;
  }
}

/** Remove the session key from both storage locations. */
export function clearSessionKey(): void {
  localStorage.removeItem(STORAGE_KEY);
  sessionStorage.removeItem(STORAGE_KEY);
}

/** Check whether a non-expired session key exists. */
export function hasActiveSessionKey(): boolean {
  return loadSessionKey() !== null;
}

/**
 * Get the active session key for a specific owner address.
 * Returns null if the stored key belongs to a different wallet.
 */
export function getSessionKeyForOwner(
  owner: `0x${string}`,
): StoredSessionKey | null {
  const key = loadSessionKey();
  if (!key) return null;
  if (key.owner.toLowerCase() !== owner.toLowerCase()) return null;
  return key;
}

// ---------------------------------------------------------------------------
// EIP-712 local signing with session key
// ---------------------------------------------------------------------------

/**
 * Compute the EIP-712 typed data hash and sign it locally with the session key.
 *
 * This produces the exact same signature format that walletClient.signTypedData
 * would produce, but without triggering any wallet popup. The chain recovers
 * the signer (session key address) from the signature and checks if it is
 * approved for the `from` account.
 *
 * @param types      EIP-712 type definitions (e.g., PlaceOrderTypes)
 * @param primaryType Primary type name (e.g., "PlaceOrder")
 * @param message    The typed data message values
 * @returns          0x-prefixed hex signature (65 bytes: r + s + v)
 */
export function signTypedDataWithSessionKey(
  types: Record<string, readonly { name: string; type: string }[]>,
  primaryType: string,
  message: Record<string, unknown>,
): `0x${string}` {
  const key = loadSessionKey();
  if (!key) throw new Error("No active session key");

  // Compute the EIP-712 hash using viem's utility
  const hash = hashTypedData({
    domain: CASTER_DOMAIN,
    types,
    primaryType,
    message,
  });

  // Sign the hash with the session key's private key.
  // lowS: true ensures canonical low-S form (EIP-2).
  // prehash: false because we already have the final 32-byte hash.
  const hashBytes = hexToBytes(hash.slice(2));
  const sig = secp256k1.sign(hashBytes, key.privateKey, { lowS: true });

  // recovery is always defined when using secp256k1.sign (not verify)
  const recovery = sig.recovery ?? 0;

  // Serialize to 0x-prefixed hex: r (32 bytes) + s (32 bytes) + v (1 byte)
  return serializeSignature({
    r: `0x${sig.r.toString(16).padStart(64, "0")}` as Hex,
    s: `0x${sig.s.toString(16).padStart(64, "0")}` as Hex,
    v: BigInt(recovery + 27),
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
