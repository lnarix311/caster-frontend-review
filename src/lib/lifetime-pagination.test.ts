/**
 * Cursor-pagination unit tests for the lifetime fills endpoint integration.
 *
 * The hook (`useLifetimeFills`) is React-state heavy and expensive to
 * exercise without a DOM, so instead we test the underlying API helper
 * (`getLifetimeFills`) end-to-end with a mocked global `fetch`. This
 * covers the contract that the hook depends on:
 *
 *   - first page: no cursor params in the URL
 *   - subsequent page: all three cursor fields appear with correct values
 *   - end-of-history: response with `next_cursor: null` is surfaced verbatim
 *   - the URL shape matches the backend's keyset-cursor query param names
 *     (before_block, before_taker_order_id, before_maker_order_id)
 *
 * Run from the frontend directory with:
 *
 *   node --test src/lib/lifetime-pagination.test.ts
 */

import { test } from "node:test";
import assert from "node:assert";
import {
  getLifetimeFills,
  getEquityCurve,
  EQUITY_CURVE_PENDING_TAG,
  type LifetimeFillsCursor,
  type LifetimeFillsPage,
} from "./lifetime-api.ts";

const ADDR = "0xabc0000000000000000000000000000000000123";

// ---- Tiny fetch mock ----

type FetchCall = { url: string; init?: RequestInit };

function installFetchMock(handler: (url: string) => { status: number; body: string }): {
  calls: FetchCall[];
  uninstall: () => void;
} {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.url;
    calls.push({ url, init });
    const { status, body } = handler(url);
    return new Response(body, {
      status,
      headers: { "Content-Type": "application/json" },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
  return {
    calls,
    uninstall: () => {
      globalThis.fetch = original;
    },
  };
}

// ---- getLifetimeFills cursor URL contract ----

test("first page: no cursor params in URL", async () => {
  const mock = installFetchMock(() => ({
    status: 200,
    body: JSON.stringify({
      address: ADDR,
      fills: [],
      next_cursor: null,
    } satisfies LifetimeFillsPage),
  }));
  try {
    await getLifetimeFills(ADDR);
    assert.strictEqual(mock.calls.length, 1);
    const url = new URL(mock.calls[0].url, "http://test.local");
    assert.strictEqual(url.searchParams.get("before_block"), null);
    assert.strictEqual(url.searchParams.get("before_taker_order_id"), null);
    assert.strictEqual(url.searchParams.get("before_maker_order_id"), null);
    assert.match(url.pathname, new RegExp(`/account/${ADDR}/fills$`));
  } finally {
    mock.uninstall();
  }
});

test("subsequent page: all three cursor fields encoded", async () => {
  const cursor: LifetimeFillsCursor = {
    block_height: 12345,
    taker_order_id: 678,
    maker_order_id: 901,
  };
  const mock = installFetchMock(() => ({
    status: 200,
    body: JSON.stringify({
      address: ADDR,
      fills: [],
      next_cursor: null,
    } satisfies LifetimeFillsPage),
  }));
  try {
    await getLifetimeFills(ADDR, { cursor, limit: 25 });
    assert.strictEqual(mock.calls.length, 1);
    const url = new URL(mock.calls[0].url, "http://test.local");
    assert.strictEqual(url.searchParams.get("before_block"), "12345");
    assert.strictEqual(url.searchParams.get("before_taker_order_id"), "678");
    assert.strictEqual(url.searchParams.get("before_maker_order_id"), "901");
    assert.strictEqual(url.searchParams.get("limit"), "25");
  } finally {
    mock.uninstall();
  }
});

test("limit is forwarded as a query param when supplied alone", async () => {
  const mock = installFetchMock(() => ({
    status: 200,
    body: JSON.stringify({
      address: ADDR,
      fills: [],
      next_cursor: null,
    } satisfies LifetimeFillsPage),
  }));
  try {
    await getLifetimeFills(ADDR, { limit: 100 });
    const url = new URL(mock.calls[0].url, "http://test.local");
    assert.strictEqual(url.searchParams.get("limit"), "100");
    assert.strictEqual(url.searchParams.get("before_block"), null);
  } finally {
    mock.uninstall();
  }
});

test("end-of-history: next_cursor=null surfaced verbatim", async () => {
  const mock = installFetchMock(() => ({
    status: 200,
    body: JSON.stringify({
      address: ADDR,
      fills: [],
      next_cursor: null,
    } satisfies LifetimeFillsPage),
  }));
  try {
    const page = await getLifetimeFills(ADDR);
    assert.strictEqual(page.next_cursor, null);
  } finally {
    mock.uninstall();
  }
});

test("non-end page: next_cursor passed through as-is for chaining", async () => {
  const next: LifetimeFillsCursor = {
    block_height: 5000,
    taker_order_id: 42,
    maker_order_id: 17,
  };
  const mock = installFetchMock(() => ({
    status: 200,
    body: JSON.stringify({
      address: ADDR,
      fills: [],
      next_cursor: next,
    } satisfies LifetimeFillsPage),
  }));
  try {
    const page = await getLifetimeFills(ADDR);
    assert.deepStrictEqual(page.next_cursor, next);
  } finally {
    mock.uninstall();
  }
});

test("simulated multi-page walk: cursor advances each iteration", async () => {
  // Backend simulation: 3 pages of 2 fills each, with the cursor on each
  // page pointing to (decreasing) block heights. Page 4 returns
  // next_cursor=null to terminate.
  const pages = [
    {
      fills: [{ block_height: 100 }, { block_height: 99 }],
      next_cursor: { block_height: 99, taker_order_id: 0, maker_order_id: 0 },
    },
    {
      fills: [{ block_height: 98 }, { block_height: 97 }],
      next_cursor: { block_height: 97, taker_order_id: 0, maker_order_id: 0 },
    },
    {
      fills: [{ block_height: 96 }, { block_height: 95 }],
      next_cursor: null,
    },
  ];
  let pageIdx = 0;

  const mock = installFetchMock(() => {
    const p = pages[pageIdx++];
    return {
      status: 200,
      body: JSON.stringify({
        address: ADDR,
        // Mock fills are minimal -- only fields needed to assert ordering
        fills: p.fills.map((f) => ({
          market_id: 1,
          maker_order_id: 0,
          taker_order_id: 0,
          block_height: f.block_height,
          timestamp_ms: 0,
          price: 500,
          quantity: 1,
          taker_side: "Buy",
          taker_fee_ticks: 0,
          taker_fee_usd: 0,
          maker_rebate_ticks: 0,
          maker_rebate_usd: 0,
          notional_ticks: 0,
          notional_usd: 0,
          buyer: "0x",
          seller: "0x",
          your_role: "buyer",
        })),
        next_cursor: p.next_cursor,
      }),
    };
  });

  try {
    let cursor: LifetimeFillsCursor | null = null;
    const accumulated: number[] = [];
    let safety = 0;
    while (safety++ < 10) {
      const page: LifetimeFillsPage = await getLifetimeFills(ADDR, { cursor });
      accumulated.push(...page.fills.map((f) => f.block_height));
      cursor = page.next_cursor;
      if (cursor === null) break;
    }
    assert.deepStrictEqual(accumulated, [100, 99, 98, 97, 96, 95]);
    assert.strictEqual(mock.calls.length, 3);
    // Page 1 had no cursor params; pages 2 and 3 did.
    const url1 = new URL(mock.calls[0].url, "http://test.local");
    const url2 = new URL(mock.calls[1].url, "http://test.local");
    const url3 = new URL(mock.calls[2].url, "http://test.local");
    assert.strictEqual(url1.searchParams.get("before_block"), null);
    assert.strictEqual(url2.searchParams.get("before_block"), "99");
    assert.strictEqual(url3.searchParams.get("before_block"), "97");
  } finally {
    mock.uninstall();
  }
});

// ---- equity-curve sentinel detection ----

test("equity curve: 200 ready response surfaced", async () => {
  const snapshots = [
    { timestamp_ms: 1, equity_ticks: 1000, equity_usd: 1.0 },
    { timestamp_ms: 2, equity_ticks: 1500, equity_usd: 1.5 },
  ];
  const mock = installFetchMock(() => ({
    status: 200,
    body: JSON.stringify({ address: ADDR, snapshots }),
  }));
  try {
    const res = await getEquityCurve(ADDR);
    assert.strictEqual(res.kind, "ready");
    if (res.kind === "ready") {
      assert.deepStrictEqual(res.snapshots, snapshots);
    }
  } finally {
    mock.uninstall();
  }
});

test("equity curve: 501 stub with sentinel -> pending", async () => {
  const mock = installFetchMock(() => ({
    status: 501,
    body: JSON.stringify({
      error: EQUITY_CURVE_PENDING_TAG,
      message: "endpoint will activate when chain task #19 ships",
    }),
  }));
  try {
    const res = await getEquityCurve(ADDR);
    assert.strictEqual(res.kind, "pending");
  } finally {
    mock.uninstall();
  }
});

test("equity curve: 500 transport error -> error", async () => {
  const mock = installFetchMock(() => ({
    status: 500,
    body: "internal server error",
  }));
  try {
    const res = await getEquityCurve(ADDR);
    assert.strictEqual(res.kind, "error");
    if (res.kind === "error") {
      assert.match(res.message, /500/);
    }
  } finally {
    mock.uninstall();
  }
});

test("equity curve: 501 with non-sentinel body -> error (not pending)", async () => {
  // Forward-compat: if a future deployment reuses 501 for something
  // unrelated, we should NOT silently render the "Coming soon" placeholder
  // -- that would mask a real outage.
  const mock = installFetchMock(() => ({
    status: 501,
    body: JSON.stringify({ error: "MAINTENANCE_MODE" }),
  }));
  try {
    const res = await getEquityCurve(ADDR);
    assert.strictEqual(res.kind, "error");
  } finally {
    mock.uninstall();
  }
});

test("equity curve: since/until query params encoded when supplied", async () => {
  const mock = installFetchMock(() => ({
    status: 200,
    body: JSON.stringify({ address: ADDR, snapshots: [] }),
  }));
  try {
    await getEquityCurve(ADDR, { sinceMs: 1000, untilMs: 2000 });
    const url = new URL(mock.calls[0].url, "http://test.local");
    assert.strictEqual(url.searchParams.get("since_ms"), "1000");
    assert.strictEqual(url.searchParams.get("until_ms"), "2000");
  } finally {
    mock.uninstall();
  }
});
