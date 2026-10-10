// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import HomePage, { generateMetadata } from "@/app/page";
import { publicSupportEmail } from "@/lib/public-contact";
import { PublicSiteFrame } from "@/components/app/public-site-frame";
import { PublicContact } from "@/components/app/public-contact";

const mocks = vi.hoisted(() => ({ session: vi.fn(), admin: vi.fn(), redirect: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getWorkspaceSession: mocks.session }));
vi.mock("@/lib/auth/platform", () => ({ getPlatformAdmin: mocks.admin }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/components/app/workspace-home", () => ({ default: () => null }));
vi.mock("@/app/(app)/layout", () => ({ default: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue(null);
  mocks.admin.mockResolvedValue(null);
  mocks.redirect.mockImplementation((url: string) => { throw new Error(`redirect:${url}`); });
});

describe("public home dispatch", () => {
  it("serves the public page without workspace or login configuration", async () => {
    const page = await HomePage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(page);
    expect(html).toContain("Dari rekening koran ke laporan keuangan");
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(await generateMetadata()).toMatchObject({ alternates: { canonical: "/" } });
  });

  it.each(["KANTOR", "PERUSAHAAN"])("keeps %s members in the guarded workspace", async (kind) => {
    mocks.session.mockResolvedValue({ firm: { kind }, support: null });
    const page = await HomePage({ searchParams: Promise.resolve({ period: "2026-08" }) });
    const child = (page as ReactElement<{ children: ReactElement<{ children: ReactElement<{ searchParams: Promise<unknown> }> }> }>).props.children.props.children;
    expect(await child.props.searchParams).toEqual({ period: "2026-08" });
    expect(await generateMetadata()).toEqual({ title: { absolute: "Beranda · Buku" } });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("takes an admin to Backoffice outside support", async () => {
    mocks.admin.mockResolvedValue({ id: "admin" });
    await expect(HomePage({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/backoffice");
  });

  it("preserves a live support workspace before admin routing", async () => {
    mocks.session.mockResolvedValue({ support: { id: "verified-support" } });
    await HomePage({ searchParams: Promise.resolve({}) });
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

describe("shared public frame and contact", () => {
  it("provides reading landmarks, skip navigation and the public destinations", () => {
    const dom = document.implementation.createHTMLDocument();
    dom.body.innerHTML = renderToStaticMarkup(createElement(PublicSiteFrame, null, createElement("h1", null, "Buku")));
    expect(dom.querySelectorAll("main")).toHaveLength(1);
    expect(dom.querySelector("a[href='#public-main']")?.textContent).toBe("Lewati navigasi");
    for (const href of ["/", "/login", "/daftar", "/syarat", "/kebijakan-privasi"]) expect(dom.querySelector(`a[href='${href}']`)).not.toBeNull();
    expect(dom.querySelector("footer")?.textContent).toContain("Hubungi pengelola Buku");
  });

  it("accepts a mailbox and rejects headers, query strings and malformed addresses", () => {
    expect(publicSupportEmail(" support@example.test ")).toBe("support@example.test");
    for (const value of [undefined, "", "bad", "support@example.test?subject=x", "a@example.test\nBcc:other@example.test", "a@example.test,b@example.test"]) expect(publicSupportEmail(value)).toBeNull();
  });

  it("renders a configured mailbox with URI-safe special characters", () => {
    vi.stubEnv("BUKU_SUPPORT_EMAIL", "tag#x@example.test");
    expect(renderToStaticMarkup(createElement(PublicContact))).toContain("mailto:tag%23x%40example.test");
    vi.unstubAllEnvs();
  });
});
