import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg", "exceljs"],
  // Our CLAUDE.md/AGENTS.md are hand-maintained; stop `next dev` from rewriting them.
  agentRules: false,
};

export default nextConfig;
