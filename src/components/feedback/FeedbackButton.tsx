"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useAccount } from "@/providers/AccountProvider";

/**
 * FeedbackButton -- bottom-right floating pill that opens a small modal
 * with a textarea + optional email field, posting to /api/feedback.
 *
 * Design constraints (from launch spec):
 *   - 24px from bottom-right edge, sits above any other FAB on the page
 *   - Pill shape, "Feedback" label + chat-bubble icon, matches the
 *     warm-cream / dark-mode chrome via design tokens
 *   - Modal contains: textarea (max 2000 chars), optional email field
 *     (defaulted to user's wallet address as anonymous identifier when
 *     logged in), submit -> POST /api/feedback
 *   - Success: "Thanks -- we read every one." auto-dismiss after 2s
 *   - Error: shown inline, doesn't lose user's text
 *   - Don't block UI while POST is in flight (optimistic close fine)
 *   - Capture window.location.pathname + navigator.userAgent automatically
 */

const MAX_BODY = 2000;

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success" }
  | { kind: "error"; message: string };

export function FeedbackButton() {
  const { account } = useAccount();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [email, setEmail] = useState("");
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: "idle" });
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Default the email field to the connected wallet address when the modal
  // opens. We only set it once per open so the user can clear/edit freely.
  const openModal = useCallback(() => {
    setOpen(true);
    setSubmitState({ kind: "idle" });
    if (email === "" && account?.address) {
      setEmail(account.address);
    }
  }, [email, account?.address]);

  const closeModal = useCallback(() => {
    setOpen(false);
    if (successTimerRef.current) {
      clearTimeout(successTimerRef.current);
      successTimerRef.current = null;
    }
  }, []);

  // Reset body + state when modal closes after a successful send so the
  // next open starts fresh. On error we keep the body so the user doesn't
  // lose their text.
  useEffect(() => {
    if (!open && submitState.kind === "success") {
      setBody("");
      setEmail("");
      setSubmitState({ kind: "idle" });
    }
  }, [open, submitState.kind]);

  // Focus the textarea on open for fast typing.
  useEffect(() => {
    if (open && textareaRef.current) {
      // small delay so the modal mount paints first
      const t = setTimeout(() => textareaRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Escape closes the modal.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, closeModal]);

  const handleSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const trimmed = body.trim();
      if (trimmed.length === 0) {
        setSubmitState({ kind: "error", message: "Please enter feedback." });
        return;
      }
      if (trimmed.length > MAX_BODY) {
        setSubmitState({
          kind: "error",
          message: `Too long (${trimmed.length}/${MAX_BODY}).`,
        });
        return;
      }

      // We deliberately don't block the UI for this. We mark submitting,
      // fire the POST, and on success set the success state which renders
      // the thank-you and schedules an auto-dismiss. On error we keep the
      // user's text so they can retry.
      setSubmitState({ kind: "submitting" });

      const pageUrl =
        typeof window !== "undefined" ? window.location.pathname : null;
      const userAgent =
        typeof navigator !== "undefined" ? navigator.userAgent : null;

      // The address field is informational; if the email field LOOKS like a
      // wallet address (default behaviour for connected users), we copy it
      // into the address field too so the operator querying SQLite can
      // join feedback to user activity easily. Otherwise we send the
      // connected address (if any) separately and treat the email as text.
      const emailTrimmed = email.trim();
      const looksLikeAddress = /^0x[0-9a-fA-F]{40}$/.test(emailTrimmed);
      const payload = {
        body: trimmed,
        email: looksLikeAddress ? null : emailTrimmed || null,
        address: looksLikeAddress
          ? emailTrimmed.toLowerCase()
          : account?.address ?? null,
        pageUrl,
        userAgent,
      };

      try {
        const res = await fetch("/api/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          let msg = `Submit failed (${res.status}).`;
          try {
            const data = (await res.json()) as { error?: string };
            if (data.error) msg = data.error;
          } catch {
            /* ignore parse error */
          }
          setSubmitState({ kind: "error", message: msg });
          return;
        }
        setSubmitState({ kind: "success" });
        // Auto-dismiss after 2s as per spec.
        if (successTimerRef.current) clearTimeout(successTimerRef.current);
        successTimerRef.current = setTimeout(() => {
          closeModal();
        }, 2000);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Network error.";
        setSubmitState({ kind: "error", message: msg });
      }
    },
    [body, email, account?.address, closeModal]
  );

  const handleTextareaKey = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Cmd/Ctrl+Enter submits.
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        const form = (e.target as HTMLTextAreaElement).form;
        form?.requestSubmit();
      }
    },
    []
  );

  return (
    <>
      {/* Floating action button. Always rendered (not env-gated); we want a
          feedback channel on every environment, including future mainnet. */}
      {!open && (
        <button
          type="button"
          aria-label="Send feedback"
          data-testid="feedback-fab"
          onClick={openModal}
          style={{
            position: "fixed",
            right: 24,
            bottom: 24,
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            height: 38,
            padding: "0 16px",
            borderRadius: 999,
            background: "var(--accent)",
            color: "var(--accent-on)",
            border: "none",
            cursor: "pointer",
            fontFamily:
              '"General Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: "0.02em",
            boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
            // Sit above modals (100) and toasts (9999 is above us).
            zIndex: 9997,
            transition: "transform 120ms ease, box-shadow 120ms ease",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.transform =
              "translateY(-1px)";
            (e.currentTarget as HTMLButtonElement).style.boxShadow =
              "0 6px 18px rgba(0,0,0,0.30)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.transform = "none";
            (e.currentTarget as HTMLButtonElement).style.boxShadow =
              "0 4px 14px rgba(0,0,0,0.25)";
          }}
        >
          <ChatBubbleIcon />
          <span>Feedback</span>
        </button>
      )}

      {open && (
        <FeedbackModal
          body={body}
          email={email}
          submitState={submitState}
          onBodyChange={setBody}
          onEmailChange={setEmail}
          onClose={closeModal}
          onSubmit={handleSubmit}
          onTextareaKeyDown={handleTextareaKey}
          textareaRef={textareaRef}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Modal (kept in this file to keep the surface area tiny)
// ---------------------------------------------------------------------------

interface ModalProps {
  body: string;
  email: string;
  submitState: SubmitState;
  onBodyChange: (v: string) => void;
  onEmailChange: (v: string) => void;
  onClose: () => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  onTextareaKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  textareaRef: React.MutableRefObject<HTMLTextAreaElement | null>;
}

function FeedbackModal({
  body,
  email,
  submitState,
  onBodyChange,
  onEmailChange,
  onClose,
  onSubmit,
  onTextareaKeyDown,
  textareaRef,
}: ModalProps) {
  const charsLeft = MAX_BODY - body.length;
  const overLimit = charsLeft < 0;
  const submitting = submitState.kind === "submitting";
  const success = submitState.kind === "success";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Send feedback"
      data-testid="feedback-modal"
      onClick={(e) => {
        // Backdrop click closes only when clicking the backdrop itself.
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "flex-end",
        padding: 24,
        zIndex: 9998,
      }}
    >
      <form
        onSubmit={onSubmit}
        style={{
          width: "min(420px, 100%)",
          background: "var(--bg-elevated)",
          color: "var(--text-primary)",
          border: "1px solid var(--border-default)",
          borderRadius: 12,
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          boxShadow: "0 12px 40px rgba(0,0,0,0.40)",
          fontFamily:
            '"General Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2
            style={{
              margin: 0,
              fontSize: 16,
              fontWeight: 600,
              letterSpacing: "-0.01em",
            }}
          >
            Send feedback
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close feedback dialog"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--text-secondary)",
              cursor: "pointer",
              fontSize: 18,
              lineHeight: 1,
              padding: 4,
            }}
          >
            {"×"}
          </button>
        </div>

        {/* Success state */}
        {success ? (
          <div
            data-testid="feedback-success"
            style={{
              padding: "16px 4px",
              fontSize: 14,
              color: "var(--text-primary)",
              textAlign: "center",
            }}
          >
            {"Thanks — we read every one."}
          </div>
        ) : (
          <>
            {/* Textarea */}
            <textarea
              ref={textareaRef}
              value={body}
              onChange={(e) => onBodyChange(e.target.value)}
              onKeyDown={onTextareaKeyDown}
              placeholder="What's working? What's broken? Anything we should fix before mainnet?"
              maxLength={MAX_BODY + 200 /* allow paste then warn, server clamps */}
              rows={6}
              aria-label="Feedback message"
              style={{
                width: "100%",
                resize: "vertical",
                minHeight: 120,
                padding: 10,
                fontFamily: "inherit",
                fontSize: 13,
                lineHeight: 1.5,
                color: "var(--text-primary)",
                background: "var(--bg-surface)",
                border: `1px solid ${overLimit ? "var(--no)" : "var(--border-default)"}`,
                borderRadius: 8,
                outline: "none",
                boxSizing: "border-box",
              }}
            />

            {/* Email row */}
            <input
              type="text"
              value={email}
              onChange={(e) => onEmailChange(e.target.value)}
              placeholder="Email or wallet (optional)"
              aria-label="Email or wallet address (optional)"
              style={{
                width: "100%",
                padding: "8px 10px",
                fontFamily:
                  '"IBM Plex Mono", "JetBrains Mono", monospace',
                fontSize: 12,
                color: "var(--text-primary)",
                background: "var(--bg-surface)",
                border: "1px solid var(--border-default)",
                borderRadius: 8,
                outline: "none",
                boxSizing: "border-box",
              }}
            />

            {/* Char count + error */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontSize: 11,
                color: overLimit ? "var(--no)" : "var(--text-tertiary)",
                minHeight: 16,
              }}
            >
              <span data-testid="feedback-error" role="alert">
                {submitState.kind === "error" ? submitState.message : ""}
              </span>
              <span>
                {charsLeft}/{MAX_BODY}
              </span>
            </div>

            {/* Submit row */}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={onClose}
                style={{
                  height: 32,
                  padding: "0 14px",
                  background: "transparent",
                  border: "1px solid var(--border-default)",
                  borderRadius: 8,
                  color: "var(--text-secondary)",
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || body.trim().length === 0 || overLimit}
                style={{
                  height: 32,
                  padding: "0 16px",
                  background: "var(--accent)",
                  border: "none",
                  borderRadius: 8,
                  color: "var(--accent-on)",
                  fontSize: 12,
                  fontWeight: 600,
                  letterSpacing: "0.02em",
                  cursor:
                    submitting || body.trim().length === 0 || overLimit
                      ? "not-allowed"
                      : "pointer",
                  opacity:
                    submitting || body.trim().length === 0 || overLimit
                      ? 0.55
                      : 1,
                }}
              >
                {submitting ? "Sending…" : "Send"}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline SVG icon (no extra deps)
// ---------------------------------------------------------------------------

function ChatBubbleIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M2 3.5C2 2.67 2.67 2 3.5 2h9c.83 0 1.5.67 1.5 1.5v6c0 .83-.67 1.5-1.5 1.5H7.5l-3.2 2.4c-.33.25-.8.01-.8-.4V11h-.5C2.67 11 2 10.33 2 9.5v-6Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}
