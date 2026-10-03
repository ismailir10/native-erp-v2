import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg", "exceljs", "pdfkit"],
  // AGENTS.md (and its CLAUDE.md symlink) is hand-maintained; stop `next dev` from rewriting it.
  agentRules: false,
  // Keep the dev badge from covering the sidebar footer during demos run from `npm run dev`.
  devIndicators: false,
  // Dev logs print server-action arguments verbatim. Those include the AI key, the admin passcode and PDF passwords.
  logging: { serverFunctions: false },
  // Statements up to 5 MB go through a server action (default limit is 1 MB).
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
};

export default nextConfig;
