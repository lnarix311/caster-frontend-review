"use client";

/**
 * Repo-wide convention: any tx-hash rendered in the UI is shown as a
 * truncated middle-ellipsis monospace string with a copy button, and
 * (when `link` is true) clicks navigate to /explorer/tx/<hash>.
 *
 * This component is the single source of truth for hash display so we
 * stay consistent across the explorer, market trades tab, portfolio
 * trade history, and any future place a hash needs to be shown.
 */

import { useCallback, useState } from "react";
import Link from "next/link";

interface HashLinkProps {
  hash: string;
  /** When true (default), wrap the hash in a Link to /explorer/tx/<hash>. */
  link?: boolean;
  /** Show inline copy-to-clipboard button. Defaults to true. */
  copy?: boolean;
  /** Override the truncation -- defaults to 6+4. */
  prefix?: number;
  suffix?: number;
  /** Inline color override (defaults to currentColor). */
  color?: string;
  /** Compact = smaller font, no copy button. Useful for trade rows. */
  compact?: boolean;
  /** Optional explicit href override (for non-tx hashes). */
  href?: string;
  className?: string;
  /** Optional title attribute (defaults to full hash). */
  title?: string;
}

export function truncateHashMiddle(hash: string, prefix = 6, suffix = 4): string {
  if (!hash) return "";
  if (hash.length <= prefix + suffix + 3) return hash;
  return `${hash.slice(0, prefix)}...${hash.slice(-suffix)}`;
}

export function HashLink({
  hash,
  link = true,
  copy = true,
  prefix,
  suffix,
  color,
  compact = false,
  href,
  className,
  title,
}: HashLinkProps) {
  const display = truncateHashMiddle(
    hash,
    prefix ?? (compact ? 4 : 6),
    suffix ?? (compact ? 4 : 4),
  );
  const fontSize = compact ? 10 : 12;
  const showCopy = copy && !compact;

  const linkHref = href ?? (link ? `/explorer/tx/${hash}` : undefined);

  const text = (
    <span
      className={className}
      style={{
        fontFamily: "var(--font-mono)",
        fontSize,
        color: color ?? "currentColor",
        letterSpacing: "0.01em",
      }}
      title={title ?? hash}
    >
      {display}
    </span>
  );

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        whiteSpace: "nowrap",
      }}
    >
      {linkHref ? (
        <Link
          href={linkHref}
          onClick={(e) => e.stopPropagation()}
          style={{
            textDecoration: "none",
            color: "inherit",
            borderBottom: "1px dotted transparent",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLAnchorElement).style.borderBottomColor = "currentColor";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLAnchorElement).style.borderBottomColor = "transparent";
          }}
        >
          {text}
        </Link>
      ) : (
        text
      )}
      {showCopy && <CopyButton text={hash} />}
    </span>
  );
}

interface CopyButtonProps {
  text: string;
  size?: number;
}

export function CopyButton({ text, size = 12 }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      });
    },
    [text],
  );

  return (
    <button
      onClick={handleCopy}
      aria-label={`Copy ${text}`}
      type="button"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size + 6,
        height: size + 6,
        padding: 0,
        background: "transparent",
        border: "none",
        cursor: "pointer",
        color: copied ? "var(--yes, #22c55e)" : "var(--text-tertiary, currentColor)",
        opacity: copied ? 1 : 0.6,
        transition: "opacity 150ms, color 150ms",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.opacity = "1";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.opacity = copied ? "1" : "0.6";
      }}
    >
      {copied ? (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
          <path
            d="M3 8l3 3 7-7"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
          <rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M4 11H3.5A1.5 1.5 0 012 9.5v-7A1.5 1.5 0 013.5 1h7A1.5 1.5 0 0112 2.5V3"
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </svg>
      )}
    </button>
  );
}
