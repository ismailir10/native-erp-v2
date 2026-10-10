import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userMessage } from "@/lib/errors/user-message";

const forbidden = /supabase|prisma|postgres|invalid login credentials|database error|failed to fetch|internal server error|unexpected token/i;

/** Inspect rendered literals and thrown/fallback messages, not imports, identifiers, comments or provider-detection regexes. */
function userFacingText(source: string) {
  const file = ts.createSourceFile("source.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  function strings(node: ts.Node) {
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) found.push(node.text);
    ts.forEachChild(node, strings);
  }
  function visit(node: ts.Node) {
    if (ts.isJsxText(node)) found.push(node.text);
    else if (ts.isJsxAttribute(node) && node.initializer && !["className", "href", "src"].includes(node.name.getText(file))) strings(node.initializer);
    else if (ts.isJsxExpression(node) && node.expression) strings(node.expression);
    else if (ts.isThrowStatement(node) && ts.isNewExpression(node.expression) && /Error$/.test(node.expression.expression.getText(file))) {
      const message = node.expression.arguments?.[0];
      if (message) strings(message);
    } else if (ts.isCallExpression(node) && ["fail", "userMessage"].includes(node.expression.getText(file)) && node.arguments[1]) strings(node.arguments[1]);
    ts.forEachChild(node, visit);
  }
  visit(file);
  return found;
}

describe("no provider names or raw provider errors in user-facing copy", () => {
  it("scans app, components and library literals", () => {
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (path === join("lib", "generated")) return [];
      return entry.isDirectory() ? walk(path) : /\.tsx?$/.test(path) ? [path] : [];
    });
    const violations = ["app", "components", "lib"].flatMap(walk).flatMap((path) =>
      userFacingText(readFileSync(path, "utf8")).filter((text) => forbidden.test(text)).map((text) => `${relative(process.cwd(), path)}: ${text}`),
    );
    expect(violations).toEqual([]);
  });
  it("detects visible text, error strings and operator fallbacks while allowing technical code", () => {
    const source = `import { prisma } from "@/lib/generated/prisma/client";
      // Supabase refreshes the session.
      const supabase = {};
      throw new Error("Prisma database error");
      fail(error, "Supabase unavailable");
      const view = <p aria-label="Postgres failed">Supabase <span>{"Invalid login credentials"}</span></p>;`;
    expect(userFacingText(source).filter((text) => forbidden.test(text))).toEqual(expect.arrayContaining([
      "Prisma database error", "Supabase unavailable", "Postgres failed", "Supabase ", "Invalid login credentials",
    ]));
    expect(userFacingText(source)).not.toContain("@/lib/generated/prisma/client");
  });
});

describe("server errors become actionable Bahasa with matching log references", () => {
  afterEach(() => vi.restoreAllMocks());
  it.each([
    [{ code: "P2002", message: "Prisma duplicate key" }, "Data ini sudah digunakan"],
    [{ code: "P2024", message: "Postgres timeout" }, "Layanan sedang sibuk"],
    [{ code: "invalid_credentials", message: "Invalid login credentials" }, "Email atau kata sandi tidak cocok"],
    [{ code: "otp_expired", message: "Token has expired" }, "Tautan sudah kedaluwarsa"],
    [{ status: 429, message: "Too many requests" }, "Terlalu banyak percobaan"],
    [new Error("Supabase is unavailable"), "Ada yang salah di sisi kami"],
    [{ code: "constructor", message: "raw provider detail" }, "Ada yang salah di sisi kami"],
  ])("maps %j without leaking its message", (error, expected) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const message = userMessage(error);
    expect(message).toContain(expected);
    expect(message).not.toMatch(forbidden);
    const reference = message.match(/BKU-[a-f0-9-]{36}/)?.[0];
    expect(reference).toBeTruthy();
    expect(log.mock.calls[0][0]).toContain(reference);
    expect(log.mock.calls[0][1]).toMatchObject({ message: error.message });
  });
  it("keeps a safe operation-specific fallback and generates distinct references", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(userMessage(null, "Undangan belum terkirim.")).toMatch(/^Undangan belum terkirim\. Referensi: BKU-/);
    expect(userMessage(null)).not.toEqual(userMessage(null));
    expect(userMessage(null, "Supabase refused")).not.toMatch(forbidden);
  });
  it("redacts credentials from server diagnostics and ignores nested request configuration", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    userMessage({
      message: "postgresql://buku:private-password@db/buku Bearer private-bearer token_hash=private-token&next=/login api_key=private-key",
      stack: "https://user:private-url@service/path?access_token=private-access",
      request: { headers: { Authorization: "private-header" } },
    });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/private-/);
    expect(JSON.stringify(log.mock.calls)).toContain("[redacted]");
  });
  it("error boundaries use the server digest and never render the original message or stack", () => {
    const boundary = readFileSync("app/error.tsx", "utf8");
    expect(boundary).toContain("error.digest");
    expect(boundary).not.toMatch(/\{\s*error\.(message|stack)\s*\}/);
    expect(readFileSync("app/global-error.tsx", "utf8")).toContain('<html lang="id">');
    expect(readFileSync("app/login/shell.tsx", "utf8")).toContain("<PublicShell {...props} dotGrid />");
  });
});
