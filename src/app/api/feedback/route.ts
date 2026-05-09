/**
 * POST /api/feedback -- accept a single feedback submission from the in-app
 * Feedback button (see src/components/feedback/FeedbackButton.tsx).
 *
 * Payload (JSON):
 *   {
 *     body:      string      // 1..2000 chars after trim, REQUIRED
 *     email?:    string      // optional, ASCII printable, <=320 chars
 *     address?:  string      // optional, 0x... wallet address as identifier
 *     pageUrl?:  string      // captured client-side via window.location.pathname
 *     userAgent?: string     // captured client-side via navigator.userAgent
 *   }
 *
 * Response:
 *   201 { ok: true, id: <rowid> }
 *   400 { ok: false, error: "..." } on validation failure
 *   500 { ok: false, error: "..." } on persistence failure
 *
 * Validation rules (kept defensive; we'd rather drop a bad payload than let
 * arbitrary garbage land in SQLite):
 *   - body must be present, non-empty after trim, <=2000 chars
 *   - email if present must be string, <=320 chars, contain at least one '@'
 *     (we don't run a full RFC validator -- the field is informational)
 *   - address if present must match /^0x[0-9a-fA-F]{40}$/
 *   - pageUrl: <=2000 chars (defense against giant URLs / open redirects in
 *     log files)
 *   - userAgent: <=512 chars
 *
 * The route is force-dynamic -- we never want this cached.
 */
import { NextRequest, NextResponse } from "next/server";
import { insertFeedback } from "@/lib/feedback-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY = 2000;
const MAX_EMAIL = 320;
const MAX_URL = 2000;
const MAX_UA = 512;
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

function clampString(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, max);
}

export async function POST(req: NextRequest) {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return bad("invalid JSON");
  }

  if (!payload || typeof payload !== "object") {
    return bad("payload must be an object");
  }

  const p = payload as Record<string, unknown>;

  // body -- required
  const body = clampString(p.body, MAX_BODY);
  if (!body) return bad("body is required");

  // email -- optional but if present must look like an address
  let email: string | null = null;
  if (p.email !== undefined && p.email !== null && p.email !== "") {
    const e = clampString(p.email, MAX_EMAIL);
    if (!e || !e.includes("@")) return bad("email is malformed");
    email = e;
  }

  // address -- optional, strict 0x-prefixed 40-hex
  let address: string | null = null;
  if (p.address !== undefined && p.address !== null && p.address !== "") {
    if (typeof p.address !== "string" || !ADDR_RE.test(p.address)) {
      return bad("address must be a 0x-prefixed 40-hex string");
    }
    address = p.address.toLowerCase();
  }

  const pageUrl = clampString(p.pageUrl, MAX_URL);
  const userAgent = clampString(p.userAgent, MAX_UA);

  try {
    const id = insertFeedback({ address, email, body, pageUrl, userAgent });
    // Lightweight server log so an operator tailing journalctl sees the
    // arrival without needing to crack open the SQLite file. Don't echo
    // the body itself -- we want feedback content discoverable only via
    // the DB so it isn't accidentally piped to log shipping.
    console.log(
      `[feedback] id=${id} addr=${address ?? "-"} url=${pageUrl ?? "-"} bytes=${body.length}`
    );
    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    console.error(`[feedback] persistence failed: ${msg}`);
    return bad("could not persist feedback", 500);
  }
}
