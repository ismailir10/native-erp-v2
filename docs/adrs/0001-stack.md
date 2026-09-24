# 0001 — Stack: Next.js 16, Prisma 7, Postgres/Neon, local-first (2026-09-24)

**Context.** Investor MVP built in one session in a sandbox where Neon and `ui.shadcn.com` are unreachable but npm and a local Postgres 16 are available. Target hosting is Vercel + Neon.

**Decision.** Next.js 16 App Router (RSC + server actions), Tailwind v4, shadcn base-nova components vendored from annisaa-erp-v3, Prisma 7 with `@prisma/adapter-pg` (works with a Neon pooled URL unchanged). Develop and test on local Postgres; Neon is a deploy-time `DATABASE_URL`.

**Consequences.** No vendor lock in code; `prisma migrate` engine download worked through the proxy (spiked first — fallback was Drizzle). Server actions are the only write path, which is also where auth will attach.
