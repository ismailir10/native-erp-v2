import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg", "exceljs"],
  // Our CLAUDE.md/AGENTS.md are hand-maintained; stop `next dev` from rewriting them.
  agentRules: false,
  // Keep the dev badge from covering the sidebar footer during demos run from `npm run dev`.
  devIndicators: false,
  // Statements up to 5 MB go through a server action (default limit is 1 MB).
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
};

export default nextConfig;
