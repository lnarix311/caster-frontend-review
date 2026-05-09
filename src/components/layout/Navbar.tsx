"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useDisconnect } from "wagmi";
import { useAccount } from "@/providers/AccountProvider";
import { useTheme } from "@/providers/ThemeProvider";
import { DepositModal } from "@/components/bridge/DepositModal";
import { WithdrawModal } from "@/components/bridge/WithdrawModal";
import { useSessionKey, SessionKeyModal } from "@/components/SessionKeyManager";
import {
  fonts,
  lightTheme,
  darkTheme,
  type as typePresets,
  motion,
  radii,
  space,
  type OracleTheme,
} from "@/lib/oracle-theme";
import { usePortfolioValue } from "@/hooks/usePortfolioValue";

// ---------------------------------------------------------------------------
// Portfolio Dropdown
// ---------------------------------------------------------------------------

function PortfolioDropdown({
  th,
  account,
  totalPortfolioValue,
  positionsValue,
  onDeposit,
  onWithdraw,
  onFaucet,
  claiming,
  onManageSession,
  onClose,
}: {
  th: OracleTheme;
  account: { balance: number; address: string };
  totalPortfolioValue: number;
  positionsValue: number;
  onDeposit: () => void;
  onWithdraw: () => void;
  onFaucet: () => void;
  claiming: boolean;
  onManageSession: () => void;
  onClose: () => void;
}) {
  const { sessionKey, isActive } = useSessionKey();
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const hoursLeft = isActive && sessionKey
    ? Math.max(0, Math.floor((sessionKey.expiresAt - Date.now()) / (1000 * 60 * 60)))
    : 0;

  const portfolioValueStr = `$${(totalPortfolioValue / 1000).toFixed(2)}`;

  return (
    <div
      ref={dropdownRef}
      style={{
        position: "absolute",
        top: "100%",
        right: 0,
        marginTop: 6,
        width: 280,
        background: th.elevated,
        border: `0.8px solid ${th.border}`,
        borderRadius: radii.lg,
        boxShadow: th.isDark
          ? "0 4px 16px rgba(0,0,0,0.30)"
          : "0 4px 16px rgba(0,0,0,0.08)",
        padding: space[4],
        zIndex: 100,
      }}
    >
      {/* 1. Portfolio value section */}
      <div>
        <span style={{ ...typePresets.metaLabel, color: th.textTertiary }}>
          Portfolio Value
        </span>
        <div
          style={{
            fontFamily: fonts.mono,
            fontSize: 24,
            fontWeight: 400,
            letterSpacing: "-0.02em",
            color: th.textPrimary,
            marginTop: space[1],
          }}
        >
          {portfolioValueStr}
        </div>
        {/* Breakdown: cash + positions */}
        <div style={{ marginTop: space[2], display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontFamily: fonts.sans, fontSize: 11, color: th.textTertiary }}>
              Cash
            </span>
            <span style={{ fontFamily: fonts.mono, fontSize: 11, color: th.textSecondary }}>
              ${(account.balance / 1000).toFixed(2)}
            </span>
          </div>
          {positionsValue > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontFamily: fonts.sans, fontSize: 11, color: th.textTertiary }}>
                Positions
              </span>
              <span style={{ fontFamily: fonts.mono, fontSize: 11, color: th.textSecondary }}>
                ${(positionsValue / 1000).toFixed(2)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Divider */}
      <div
        style={{
          borderTop: `1px solid ${th.divider}`,
          margin: `${space[3]}px 0`,
        }}
      />

      {/* 3. Action buttons row */}
      <div style={{ display: "flex", gap: space[2] }}>
        <button
          onClick={onDeposit}
          aria-label="Deposit USDC"
          style={{
            flex: 1,
            height: 30,
            ...typePresets.metaLabel,
            background: "transparent",
            color: th.accentFrom,
            border: `0.8px solid ${th.isDark ? "rgba(255,107,53,0.25)" : "rgba(226,90,71,0.55)"}`,
            borderRadius: radii.md,
            textAlign: "center",
            cursor: "pointer",
            transition: motion.buttonTransition,
          }}
        >
          Deposit
        </button>
        <button
          onClick={onWithdraw}
          aria-label="Withdraw USDC"
          style={{
            flex: 1,
            height: 30,
            ...typePresets.metaLabel,
            background: "transparent",
            color: th.textSecondary,
            border: `0.8px solid ${th.border}`,
            borderRadius: radii.md,
            textAlign: "center",
            cursor: "pointer",
            transition: motion.buttonTransition,
          }}
        >
          Withdraw
        </button>
        <button
          onClick={onFaucet}
          disabled={claiming}
          aria-label="Claim faucet tokens"
          style={{
            flex: 1,
            height: 30,
            ...typePresets.metaLabel,
            background: "transparent",
            color: th.yes,
            border: `0.8px solid ${th.isDark ? "rgba(34,197,94,0.20)" : "rgba(22,163,74,0.20)"}`,
            borderRadius: radii.md,
            textAlign: "center",
            cursor: claiming ? "not-allowed" : "pointer",
            opacity: claiming ? 0.5 : 1,
            transition: motion.buttonTransition,
          }}
        >
          {claiming ? "..." : "Faucet"}
        </button>
      </div>

      {/* Divider */}
      <div
        style={{
          borderTop: `1px solid ${th.divider}`,
          margin: `${space[3]}px 0`,
        }}
      />

      {/* 5. Session key status */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {isActive && (
              <span
                style={{
                  display: "inline-block",
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "#22C55E",
                  boxShadow: "0 0 4px rgba(34,197,94,0.5)",
                  flexShrink: 0,
                }}
              />
            )}
            <span
              style={{
                fontFamily: fonts.sans,
                fontSize: 13,
                fontWeight: 400,
                color: th.textPrimary,
              }}
            >
              Instant Signing
            </span>
          </div>
          <span
            style={{
              fontFamily: fonts.sans,
              fontSize: 11,
              fontWeight: 400,
              color: th.textTertiary,
            }}
          >
            {isActive ? `Active \u2014 ${hoursLeft}h remaining` : "Not enabled"}
          </span>
        </div>
        <button
          onClick={onManageSession}
          style={{
            ...typePresets.metaLabel,
            color: th.accentFrom,
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: 0,
          }}
        >
          Manage
        </button>
      </div>

      {/* Divider */}
      <div
        style={{
          borderTop: `1px solid ${th.divider}`,
          margin: `${space[3]}px 0`,
        }}
      />

      {/* 7. Portfolio link */}
      <Link
        href="/portfolio"
        onClick={onClose}
        style={{
          fontFamily: fonts.sans,
          fontSize: 13,
          fontWeight: 400,
          color: th.accentFrom,
          textDecoration: "none",
        }}
      >
        {"View Portfolio \u2192"}
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Wallet Dropdown
// ---------------------------------------------------------------------------

function WalletDropdown({
  th,
  address,
  onDisconnect,
  onClose,
}: {
  th: OracleTheme;
  address: string;
  onDisconnect: () => void;
  onClose: () => void;
}) {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [address]);

  const handleDisconnect = useCallback(() => {
    onDisconnect();
    onClose();
  }, [onDisconnect, onClose]);

  return (
    <div
      ref={dropdownRef}
      style={{
        position: "absolute",
        top: "100%",
        right: 0,
        marginTop: 6,
        width: 280,
        background: th.elevated,
        border: `0.8px solid ${th.border}`,
        borderRadius: radii.lg,
        boxShadow: th.isDark
          ? "0 4px 16px rgba(0,0,0,0.30)"
          : "0 4px 16px rgba(0,0,0,0.08)",
        padding: space[4],
        zIndex: 100,
      }}
    >
      {/* Address section */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: space[2],
        }}
      >
        <span
          style={{
            fontFamily: fonts.mono,
            fontSize: 13,
            fontWeight: 400,
            color: th.textPrimary,
            wordBreak: "break-all",
            flex: 1,
            lineHeight: 1.4,
          }}
        >
          {address}
        </span>
        <button
          onClick={handleCopy}
          aria-label="Copy address"
          style={{
            fontFamily: fonts.sans,
            fontSize: 11,
            fontWeight: 500,
            color: copied ? th.yes : th.accentFrom,
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: 0,
            flexShrink: 0,
            transition: motion.hoverTransition,
          }}
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>

      {/* Divider */}
      <div
        style={{
          borderTop: `1px solid ${th.divider}`,
          margin: `${space[3]}px 0`,
        }}
      />

      {/* Disconnect button */}
      <button
        onClick={handleDisconnect}
        aria-label="Disconnect wallet"
        style={{
          fontFamily: fonts.sans,
          fontSize: 13,
          fontWeight: 400,
          color: th.no,
          background: "transparent",
          border: "none",
          cursor: "pointer",
          padding: 0,
        }}
      >
        Disconnect
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Nav Dropdown
// ---------------------------------------------------------------------------

const isTestnet = process.env.NEXT_PUBLIC_TESTNET_MODE === "true";

const NAV_ROUTES: { href: string; label: string; requiresAuth?: boolean }[] = [
  { href: "/", label: "Markets" },
  { href: "/portfolio", label: "Portfolio", requiresAuth: true },
  ...(isTestnet ? [] : [
    { href: "/analytics", label: "Analytics" },
  ]),
  { href: "/explorer", label: "Explorer" },
];

function pathToPageLabel(pathname: string): string {
  if (pathname === "/") return "MARKETS";
  if (pathname === "/portfolio") return "PORTFOLIO";
  if (pathname === "/analytics") return "ANALYTICS";
  if (pathname === "/explorer") return "EXPLORER";
  if (pathname.startsWith("/market/")) return "MARKETS";
  return "MARKETS";
}

function NavDropdown({
  th,
  pathname,
  isConnected,
  onClose,
}: {
  th: OracleTheme;
  pathname: string;
  isConnected: boolean;
  onClose: () => void;
}) {
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const visibleRoutes = NAV_ROUTES.filter(
    (r) => !r.requiresAuth || isConnected,
  );

  return (
    <div
      ref={dropdownRef}
      style={{
        position: "absolute",
        top: "100%",
        left: 0,
        marginTop: 6,
        width: 180,
        background: th.elevated,
        border: `0.8px solid ${th.border}`,
        borderRadius: radii.lg,
        boxShadow: th.isDark
          ? "0 4px 16px rgba(0,0,0,0.30)"
          : "0 4px 16px rgba(0,0,0,0.08)",
        padding: `${space[2]}px 0`,
        zIndex: 100,
      }}
    >
      {visibleRoutes.map((route) => {
        const isActive =
          route.href === "/"
            ? pathname === "/" || pathname.startsWith("/market/")
            : pathname === route.href;
        return (
          <Link
            key={route.href}
            href={route.href}
            onClick={onClose}
            style={{
              display: "block",
              padding: "8px 16px",
              fontFamily: fonts.sans,
              fontSize: 13,
              fontWeight: isActive ? 500 : 400,
              color: isActive ? th.textPrimary : th.textSecondary,
              textDecoration: "none",
              transition: motion.hoverTransition,
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = th.surface;
              (e.currentTarget as HTMLElement).style.color = th.textPrimary;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "transparent";
              (e.currentTarget as HTMLElement).style.color = isActive
                ? th.textPrimary
                : th.textSecondary;
            }}
          >
            {route.label}
          </Link>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Navbar
// ---------------------------------------------------------------------------

export function Navbar() {
  const { account, claimFaucet } = useAccount();
  const { theme, toggleTheme } = useTheme();
  const { disconnect } = useDisconnect();
  const isDark = theme === "dark";
  const th: OracleTheme = isDark ? darkTheme : lightTheme;

  const [claiming, setClaiming] = useState(false);
  const [showDeposit, setShowDeposit] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [showSessionKey, setShowSessionKey] = useState(false);
  const [portfolioDropdownOpen, setPortfolioDropdownOpen] = useState(false);
  const [walletDropdownOpen, setWalletDropdownOpen] = useState(false);
  const [navDropdownOpen, setNavDropdownOpen] = useState(false);
  const pathname = usePathname();
  const pillRef = useRef<HTMLDivElement>(null);
  const walletPillRef = useRef<HTMLDivElement>(null);
  const navTriggerRef = useRef<HTMLDivElement>(null);
  const navLeaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const { totalValue: totalPortfolioValue, positionsValue } = usePortfolioValue(
    account?.address ?? null,
    account?.balance ?? 0,
  );

  const portfolioValue = account
    ? `$${(totalPortfolioValue / 1000).toFixed(2)}`
    : "$0.00";

  const currentPageLabel = pathToPageLabel(pathname);

  // --- Portfolio dropdown handlers ---

  const togglePortfolioDropdown = useCallback(() => {
    setPortfolioDropdownOpen((prev) => !prev);
  }, []);

  const closePortfolioDropdown = useCallback(() => {
    setPortfolioDropdownOpen(false);
  }, []);

  const handleDeposit = useCallback(() => {
    setPortfolioDropdownOpen(false);
    setShowDeposit(true);
  }, []);

  const handleWithdraw = useCallback(() => {
    setPortfolioDropdownOpen(false);
    setShowWithdraw(true);
  }, []);

  const handleFaucet = useCallback(async () => {
    setPortfolioDropdownOpen(false);
    setClaiming(true);
    try {
      await claimFaucet();
    } finally {
      setClaiming(false);
    }
  }, [claimFaucet]);

  const handleManageSession = useCallback(() => {
    setPortfolioDropdownOpen(false);
    setShowSessionKey(true);
  }, []);

  // --- Nav dropdown handlers (hover-driven) ---

  const handleNavMouseEnter = useCallback(() => {
    if (navLeaveTimeoutRef.current) {
      clearTimeout(navLeaveTimeoutRef.current);
      navLeaveTimeoutRef.current = null;
    }
    setNavDropdownOpen(true);
  }, []);

  const handleNavMouseLeave = useCallback(() => {
    navLeaveTimeoutRef.current = setTimeout(() => {
      setNavDropdownOpen(false);
    }, 150);
  }, []);

  const closeNavDropdown = useCallback(() => {
    setNavDropdownOpen(false);
  }, []);

  // --- Wallet dropdown handlers ---

  const toggleWalletDropdown = useCallback(() => {
    setWalletDropdownOpen((prev) => !prev);
  }, []);

  const closeWalletDropdown = useCallback(() => {
    setWalletDropdownOpen(false);
  }, []);

  const handleDisconnect = useCallback(() => {
    disconnect();
  }, [disconnect]);

  // --- Truncate address helper ---
  const truncateAddress = (addr: string): string => {
    if (addr.length <= 10) return addr;
    return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
  };

  return (
    <>
      <nav
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "20px 24px",
          backgroundColor: th.bg,
          transition: motion.themeTransition,
          position: "relative",
        }}
      >
        {/* ---- LEFT ZONE: Nav Dropdown ---- */}
        <div
          ref={navTriggerRef}
          style={{ position: "relative", flexShrink: 0 }}
          onMouseEnter={handleNavMouseEnter}
          onMouseLeave={handleNavMouseLeave}
        >
          <button
            aria-label="Navigation menu"
            aria-expanded={navDropdownOpen}
            style={{
              fontFamily: fonts.sans,
              fontSize: 11,
              fontWeight: 500,
              textTransform: "uppercase",
              letterSpacing: "0.12em",
              color: th.textSecondary,
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: 0,
              display: "flex",
              alignItems: "center",
              transition: motion.hoverTransition,
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.color = th.textPrimary;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.color = th.textSecondary;
            }}
          >
            {"\u2192 " + currentPageLabel + " \u25BE"}
          </button>

          {navDropdownOpen && (
            <NavDropdown
              th={th}
              pathname={pathname}
              isConnected={!!account}
              onClose={closeNavDropdown}
            />
          )}
        </div>

        {/* ---- CENTER ZONE: Logo (truly centered) ---- */}
        <Link
          href="/"
          style={{
            position: "absolute",
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            alignItems: "center",
            gap: 10,
            textDecoration: "none",
          }}
        >
          <svg
            viewBox="0 0 200 200"
            xmlns="http://www.w3.org/2000/svg"
            style={{ width: 28, height: 28, overflow: "visible" }}
          >
            <path
              d="M 160 40 A 85 85 0 1 0 160 160"
              style={{ fill: "none", stroke: th.textPrimary, strokeLinecap: "square", strokeWidth: "8px" }}
            />
            <path
              d="M 140 60 A 55 55 0 1 0 140 140"
              style={{ fill: "none", stroke: th.textPrimary, strokeLinecap: "square", strokeWidth: "2px" }}
            />
            <line
              x1="40" y1="160" x2="180" y2="20"
              style={{ fill: "none", stroke: th.textPrimary, strokeLinecap: "square", strokeWidth: "2px" }}
            />
            <circle cx="40" cy="160" r="4" style={{ fill: th.textPrimary }} />
            <circle cx="110" cy="90" r="6" style={{ fill: th.textPrimary }} />
            <circle cx="180" cy="20" r="4" style={{ fill: th.textPrimary }} />
            <path
              d="M 20 80 Q 60 40 100 80 T 180 80"
              style={{ fill: "none", stroke: th.textPrimary, strokeLinecap: "square", strokeWidth: "2px", opacity: 0.5 }}
            />
          </svg>
          <span
            style={{
              fontFamily: fonts.serif,
              fontSize: 32,
              fontWeight: 400,
              letterSpacing: "-0.02em",
              color: th.textPrimary,
              lineHeight: 1,
            }}
          >
            Caster
          </span>
        </Link>

        {/* ---- RIGHT ZONE: Balance Pill + Theme Icon + Wallet Pill ---- */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexShrink: 0,
          }}
        >
          {/* Balance Pill (only when connected) */}
          {account && (
            <>
              {account.balance === 0 ? (
                <button
                  onClick={() => setShowDeposit(true)}
                  aria-label="Deposit USDC"
                  style={{
                    height: 32,
                    fontFamily: fonts.sans,
                    fontSize: 10,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.15em",
                    padding: "4px 14px",
                    borderRadius: radii.xl,
                    background: "transparent",
                    color: th.accentFrom,
                    border: `0.8px solid ${th.isDark ? "rgba(255,107,53,0.25)" : "rgba(226,90,71,0.55)"}`,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  Deposit
                </button>
              ) : (
                <div ref={pillRef} style={{ position: "relative" }}>
                  <button
                    onClick={togglePortfolioDropdown}
                    aria-label="Toggle portfolio dropdown"
                    aria-expanded={portfolioDropdownOpen}
                    style={{
                      height: 32,
                      padding: "4px 12px",
                      border: `0.8px solid ${portfolioDropdownOpen ? th.accentFrom : th.border}`,
                      borderRadius: radii.xl,
                      background: portfolioDropdownOpen
                        ? th.surface
                        : "transparent",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 0,
                      transition: "background 150ms, border-color 150ms",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: fonts.mono,
                        fontSize: 13,
                        fontWeight: 500,
                        color: th.textPrimary,
                      }}
                    >
                      {portfolioValue}
                    </span>
                    <span
                      style={{
                        color: th.textTertiary,
                        marginLeft: 4,
                        fontSize: 13,
                      }}
                    >
                      {"\u25BE"}
                    </span>
                  </button>

                  {portfolioDropdownOpen && (
                    <PortfolioDropdown
                      th={th}
                      account={account}
                      totalPortfolioValue={totalPortfolioValue}
                      positionsValue={positionsValue}
                      onDeposit={handleDeposit}
                      onWithdraw={handleWithdraw}
                      onFaucet={handleFaucet}
                      claiming={claiming}
                      onManageSession={handleManageSession}
                      onClose={closePortfolioDropdown}
                    />
                  )}
                </div>
              )}
            </>
          )}

          {/* Theme Toggle — icon only */}
          <button
            onClick={toggleTheme}
            aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
            style={{
              height: 32,
              width: 32,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "transparent",
              border: `0.8px solid ${th.border}`,
              borderRadius: radii.xl,
              cursor: "pointer",
              fontSize: 14,
              color: th.textSecondary,
              transition: "background 150ms ease",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = th.surface;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "transparent";
            }}
          >
            {isDark ? "\u2600" : "\u263E"}
          </button>

          {/* Wallet Pill — custom RainbowKit UI */}
          <ConnectButton.Custom>
            {({
              account: rbAccount,
              chain,
              openConnectModal,
              mounted,
            }) => {
              const connected = mounted && rbAccount && chain;

              if (!connected) {
                return (
                  <button
                    onClick={openConnectModal}
                    aria-label="Log in"
                    style={{
                      height: 32,
                      padding: "4px 14px",
                      fontFamily: fonts.sans,
                      fontSize: 11,
                      fontWeight: 500,
                      textTransform: "uppercase" as const,
                      letterSpacing: "0.12em",
                      color: th.textPrimary,
                      background: "transparent",
                      border: `0.8px solid ${th.border}`,
                      borderRadius: radii.md,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      transition: "background 150ms ease",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.background =
                        th.surface;
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background =
                        "transparent";
                    }}
                  >
                    LOG IN
                  </button>
                );
              }

              return (
                <div ref={walletPillRef} style={{ position: "relative" }}>
                  <button
                    onClick={toggleWalletDropdown}
                    aria-label="Toggle wallet dropdown"
                    aria-expanded={walletDropdownOpen}
                    style={{
                      height: 32,
                      padding: "4px 12px",
                      fontFamily: fonts.mono,
                      fontSize: 11,
                      fontWeight: 400,
                      color: th.textSecondary,
                      background: walletDropdownOpen
                        ? th.surface
                        : "transparent",
                      border: `0.8px solid ${walletDropdownOpen ? th.accentFrom : th.border}`,
                      borderRadius: radii.xl,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      transition: "background 150ms, border-color 150ms",
                    }}
                    onMouseEnter={(e) => {
                      if (!walletDropdownOpen) {
                        (e.currentTarget as HTMLElement).style.background =
                          th.surface;
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!walletDropdownOpen) {
                        (e.currentTarget as HTMLElement).style.background =
                          "transparent";
                      }
                    }}
                  >
                    {`${truncateAddress(rbAccount.address)} \u25BE`}
                  </button>

                  {walletDropdownOpen && (
                    <WalletDropdown
                      th={th}
                      address={rbAccount.address}
                      onDisconnect={handleDisconnect}
                      onClose={closeWalletDropdown}
                    />
                  )}
                </div>
              );
            }}
          </ConnectButton.Custom>
        </div>
      </nav>

      {/* Inset divider line (matches content padding) */}
      <div
        style={{
          margin: "0 24px",
          borderBottom: `0.8px solid ${th.border}`,
        }}
      />

      {/* Bridge & session key modals */}
      {showDeposit && <DepositModal onClose={() => setShowDeposit(false)} />}
      {showWithdraw && (
        <WithdrawModal onClose={() => setShowWithdraw(false)} />
      )}
      {showSessionKey && (
        <SessionKeyModal onClose={() => setShowSessionKey(false)} />
      )}
    </>
  );
}
