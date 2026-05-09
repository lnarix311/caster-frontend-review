/**
 * feedback-store -- SQLite-backed persistence for /api/feedback submissions.
 *
 * Lives in a single file at FEEDBACK_DB_PATH (default: ./data/feedback.db
 * relative to the Next.js working directory; override via env var on prod).
 *
 * We open the DB lazily on first request and keep one connection alive for
 * the lifetime of the Node server process. better-sqlite3 is fully
 * synchronous; with WAL journaling on, concurrent inserts from the route
 * handler are fine for the volumes we expect (single-digit submissions/min
 * during the testnet beta).
 *
 * Schema is created on init via CREATE TABLE IF NOT EXISTS so the first
 * deploy auto-bootstraps the DB file -- no migration plumbing needed.
 *
 * This module is server-only (uses fs + native binding) and must NEVER be
 * imported into a client component. The "server-only" import below makes
 * Next.js error at build time if anyone tries.
 */
import "server-only";

import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";

let db: Database.Database | null = null;
let insertStmt: Database.Statement | null = null;

function resolveDbPath(): string {
  const fromEnv = process.env.FEEDBACK_DB_PATH;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  // Default: <cwd>/data/feedback.db. Compatible with Next standalone output;
  // the operator can mount a volume at ./data on the VPS.
  return path.join(process.cwd(), "data", "feedback.db");
}

function getDb(): Database.Database {
  if (db) return db;

  const dbPath = resolveDbPath();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);
  // WAL mode -- better concurrency, smaller fsync cost on writes.
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_feedback (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      address     TEXT,
      email       TEXT,
      body        TEXT NOT NULL,
      page_url    TEXT,
      user_agent  TEXT,
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_user_feedback_created
      ON user_feedback(created_at DESC);
  `);

  insertStmt = db.prepare(
    "INSERT INTO user_feedback (address, email, body, page_url, user_agent, created_at)" +
      " VALUES (@address, @email, @body, @page_url, @user_agent, @created_at)"
  );

  return db;
}

export interface FeedbackRow {
  address: string | null;
  email: string | null;
  body: string;
  pageUrl: string | null;
  userAgent: string | null;
}

/**
 * Persist a single feedback submission. Returns the autoincrement id
 * assigned by SQLite, useful for log correlation.
 *
 * Throws on DB failure -- the route handler maps to a 500.
 */
export function insertFeedback(row: FeedbackRow): number {
  getDb(); // ensure prepared statement exists
  if (!insertStmt) {
    throw new Error("feedback store not initialised");
  }
  const result = insertStmt.run({
    address: row.address,
    email: row.email,
    body: row.body,
    page_url: row.pageUrl,
    user_agent: row.userAgent,
    created_at: Date.now(),
  });
  return Number(result.lastInsertRowid);
}
