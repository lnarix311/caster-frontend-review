# Caster — Frontend (Trading App)

This is the trading-app frontend for **Caster**, a custom Layer-1 prediction exchange. Live at `app.caster.trade` (testnet) — public landing at `caster.trade` is a separate codebase.

This repo is a **clean, separated copy** of the trading app frontend, extracted from the Caster monorepo for design / UX review. No backend, contracts, or strategy code is included.

## Stack

- **Next.js 15** (App Router)
- **React 19**, TypeScript
- **Tailwind CSS 4** (configured via `postcss.config.mjs`; tokens in `src/app/globals.css`)
- **Zustand** for client state
- **wagmi** + **viem** for wallet integration
- **lightweight-charts** for trading charts
- Fonts: Playfair Display (serif, brand), Satoshi + General Sans (body, via Fontshare CDN)

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

There is **no separate design-token package** — the de facto design system lives entirely in `src/app/globals.css` (CSS custom properties for colors, fonts, spacing, dark/light themes). Components use Tailwind utilities + inline styles referencing these CSS vars.

Brand color: **`#E0885A`** (amber/coral). Brand serif: **Playfair Display**. Body sans: **Satoshi** / **General Sans** / system fallback.

The Caster logo is implemented inline as SVG in `src/components/layout/Navbar.tsx` (5-element mark: outer C-arc, inner arc, diagonal line, 3 dots, sine wave overlay).

## Running locally

```sh
npm install
cp .env.example .env.local   # fill in BACKEND_URL pointing at a Caster chain endpoint
npm run dev
```

Without a backend, most pages will render but show empty data / error states. The trading UI is the most useful surface for visual review even without live data.

## What to review

This is the trading app's full visual/interaction surface — orderbook, charts, market list, position management, deposit/withdrawal modals, market detail pages, simple mode vs pro mode (toggleable in settings), light/dark themes.

The `*-test.html` files at the repo root are design-exploration scratch pads — feel free to use them as reference for visual direction.

## What is NOT in this repo

- Marketing landing page (`caster.trade`) — separate codebase
- Backend / chain code (Rust)
- Bridge contracts (Solidity)
- CLP / market-making algorithms
- Internal docs, launch plans, quant memos

## License

Proprietary. Do not redistribute. This copy is shared for design review purposes only.
