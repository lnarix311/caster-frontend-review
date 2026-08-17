# Caster — Frontend (Trading App)

Trading-app frontend for **Caster**, a custom Layer-1 prediction exchange I designed, built and deployed solo. Live at `app.caster.trade` (testnet) — the public landing page at `caster.trade` is a separate codebase.

This repo is a **clean, separated copy** of the trading app, extracted from the Caster monorepo so the frontend can be read on its own. No backend, contracts, or strategy code is included.

Roughly **24,500 lines across 65 TypeScript/React files** — 7 routes, 23 components, 11 custom hooks, and a 252-token CSS design system.

## Stack

- **Next.js 15** (App Router)
- **React 19**, TypeScript
- **Tailwind CSS 4** (configured via `postcss.config.mjs`; tokens in `src/app/globals.css`)
- **Zustand** for client state
- **wagmi** + **viem** for wallet integration
- **lightweight-charts** for trading charts
- Fonts: Playfair Display (serif, brand), Satoshi + General Sans (body, via Fontshare CDN)

## How this was built

Built solo with AI coding tools (Claude Code, Codex), using a structured agent workflow rather than ad-hoc prompting:

- **Plan first** — a written spec before implementation on anything non-trivial, instead of prompting into an empty file.
- **Delegate** — research, exploration and parallel analysis handed to subagents, one scoped task each, to keep the main context clean.
- **Tool-calling** — agents connected to external data and services over MCP, so they work against real state rather than assumptions.
- **Verify before done** — nothing marked complete without proof: tests run, output checked, behaviour compared against the previous state.
- **Capture corrections** — corrections written to a lessons file that is re-read at the start of the next session, so the same mistake doesn't recur twice.

The hard part was never generation — it was **verification**. Most of the workflow above exists to catch plausible-looking output before it reaches the running app.

## Project structure

```
src/
├── app/              # Next.js App Router pages + layout + globals.css
├── components/       # All UI components (trading, layout, bridge, modals, etc.)
├── hooks/            # Custom React hooks
├── lib/              # Utilities, API clients, wallet config
├── providers/        # React context providers (wagmi, theme, etc.)
└── types/            # Shared TypeScript types
```

Other top-level files:
- `glow-test.html`, `gradient-test.html`, `theme-test.html`, `ui-ideas-test.html` — design exploration sandboxes (open directly in browser)
- `next.config.ts`, `tsconfig.json`, `postcss.config.mjs` — build configs
- `.env.example` — environment variable names (no values)

## Design system

There is **no separate design-token package** — the de facto design system lives entirely in `src/app/globals.css` (252 CSS custom properties covering colors, fonts, spacing, and dark/light themes). Components use Tailwind utilities + inline styles referencing these CSS vars.

Brand color: **`#E0885A`** (amber/coral). Brand serif: **Playfair Display**. Body sans: **Satoshi** / **General Sans** / system fallback.

The Caster logo is implemented inline as SVG in `src/components/layout/Navbar.tsx` (5-element mark: outer C-arc, inner arc, diagonal line, 3 dots, sine wave overlay).

## Running locally

```sh
npm install
cp .env.example .env.local   # fill in BACKEND_URL pointing at a Caster chain endpoint
npm run dev
```

Without a backend, most pages will render but show empty data / error states. The trading UI is the most useful surface for visual review even without live data.

## What to look at

The trading app's full visual and interaction surface — orderbook, charts, market list, position management, deposit/withdrawal modals, market detail pages, simple mode vs pro mode (toggleable in settings), and light/dark themes.

The `*-test.html` files at the repo root are design-exploration scratch pads, useful as a record of how the visual direction was arrived at.

## What is NOT in this repo

- Marketing landing page (`caster.trade`) — separate codebase
- Backend / chain code (Rust)
- Bridge contracts (Solidity)
- CLP / market-making algorithms
- Internal docs, launch plans, quant memos

## License

Source-available for review. All rights reserved — not licensed for reuse or redistribution.
