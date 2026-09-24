import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // Optional here so `prisma generate` works without a database; migrate/deploy still need it.
  datasource: { url: process.env.DATABASE_URL ?? "" },
});
