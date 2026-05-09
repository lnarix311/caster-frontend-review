import type { NextConfig } from "next";

const backendUrl = process.env.BACKEND_URL || "http://localhost:9000";

// Rewrite rules
//
// We proxy every /api/* path to the predx-chain Axum server EXCEPT paths
// that have an own Next.js route handler under src/app/api/* (currently
// just /api/feedback).
//
// We achieve this by putting the proxy wildcard in `fallback` rather than
// the default afterFiles position. Per Next.js docs the matching order is:
//   1. headers / redirects
//   2. beforeFiles rewrites
//   3. file system (static assets, non-dynamic pages)
//   4. afterFiles rewrites
//   5. dynamic routes (THIS is where /app/api/feedback/route.ts lives)
//   6. fallback rewrites
//
// So a `fallback` wildcard naturally yields to local /api/feedback before
// proxying everything else to the chain. No negative-lookahead needed.
const nextConfig: NextConfig = {
  output: "standalone",
  // better-sqlite3 is a native module used by /api/feedback only.
  // Mark it external so Next's bundler doesn't trace the .node binary.
  serverExternalPackages: ["better-sqlite3"],
  async rewrites() {
    return {
      beforeFiles: [],
      afterFiles: [],
      fallback: [
        {
          source: "/api/:path*",
          destination: `${backendUrl}/:path*`,
        },
        {
          source: "/ws",
          destination: `${backendUrl}/ws`,
        },
      ],
    };
  },
};

export default nextConfig;
