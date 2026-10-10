// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render as renderInteractive, waitFor } from "@testing-library/react";
import { SignupForm } from "@/app/daftar/signup-form";
import { submitSignupAction } from "@/app/daftar/actions";

vi.mock("@/app/daftar/actions", () => ({ submitSignupAction: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const render = () => {
  const dom = document.implementation.createHTMLDocument();
  dom.body.innerHTML = renderToStaticMarkup(createElement(SignupForm));
  return dom;
};

describe("public trial request form", () => {
  it("allows retry and preserves inputs after a transport failure", async () => {
    vi.mocked(submitSignupAction).mockRejectedValueOnce(new Error("private transport details"));
    const view = renderInteractive(createElement(SignupForm));
    fireEvent.change(view.getByLabelText("Nama Anda"), { target: { value: "Akuntan demo" } });
    fireEvent.change(view.getByLabelText("Email kerja"), { target: { value: "demo@example.test" } });
    fireEvent.change(view.getByLabelText("Nama kantor"), { target: { value: "KJA Uji" } });
    fireEvent.submit(view.getByTestId("signup-form"));
    await waitFor(() => expect(view.getByRole("alert").textContent).toBe("Permintaan belum berhasil dikirim. Coba lagi."));
    expect(view.getByRole("button", { name: "Minta akses uji coba" })).toHaveProperty("disabled", false);
    expect(view.getByLabelText("Nama Anda")).toHaveProperty("value", "Akuntan demo");
    expect(document.activeElement).toBe(view.getByRole("alert"));
    expect(view.container.textContent).not.toContain("private transport details");
  });
  it("places the linked processing consent immediately after submit", () => {
    const dom = render();
    const consent = dom.getElementById("signup-consent")!;
    expect(consent).not.toBeNull();
    expect(consent.previousElementSibling?.getAttribute("type")).toBe("submit");
    expect(consent.querySelector("a[href='/syarat']")?.textContent).toBe("Syarat");
    expect(consent.querySelector("a[href='/kebijakan-privasi']")?.textContent).toBe("Privasi");
    expect(consent.textContent).toMatch(/menyetujui.*memproses data.*permintaan uji coba/);
    expect(consent.textContent).not.toMatch(/persetujuan.*disimpan|otomatis.*akun/i);
  });

  it("labels required and optional fields and keeps bots outside the keyboard order", () => {
    const dom = render();
    for (const id of ["signup-name", "signup-email", "signup-org"]) {
      expect(dom.querySelector(`label[for='${id}']`)?.textContent).toBeTruthy();
      expect(dom.getElementById(id)?.hasAttribute("required")).toBe(true);
    }
    for (const id of ["signup-phone", "signup-note"]) expect(dom.querySelector(`label[for='${id}']`)?.textContent).toContain("opsional");
    expect(dom.getElementById("signup-email")?.getAttribute("type")).toBe("email");
    expect(dom.getElementById("signup-website")?.getAttribute("tabindex")).toBe("-1");
    expect(dom.getElementById("signup-website")?.parentElement?.hasAttribute("aria-hidden")).toBe(true);
    expect(dom.querySelector("form")?.getAttribute("aria-busy")).toBe("false");
  });
});
