import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  downloadDriveFile, DRIVE_FILE_LIMIT, exchangeCode, getDriveFile, listDriveChildren,
  oauthAuthorizationUrl, oauthConfigured, parseDriveFolderUrl, refreshAccessToken, revokeToken,
} from "@/lib/evidence/drive";

const file = { id: "file_1", name: "statement.pdf", mimeType: "application/pdf" };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  vi.stubEnv("GOOGLE_CLIENT_ID", "client-id");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "client-secret");
  vi.stubEnv("GOOGLE_REDIRECT_URI", "http://localhost:3000/api/google/callback");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Drive links and OAuth boundaries", () => {
  it("accepts shared folder URLs and preserves resource keys", () => {
    expect(parseDriveFolderUrl("https://drive.google.com/drive/u/0/folders/folder_1?resourcekey=key-2&usp=sharing")).toEqual({ id: "folder_1", resourceKey: "key-2" });
  });
  it.each([
    "http://drive.google.com/drive/folders/folder_1", "https://drive.google.com.evil.test/drive/folders/folder_1",
    "https://evil.test@drive.google.com/drive/folders/folder_1", "https://drive.google.com:8000/drive/folders/folder_1",
    "https://drive.google.com/file/d/file_1/view", "https://drive.google.com/drive/folders/id/../../secret",
    "https://drive.google.com/drive/folders/id?resourcekey=bad%0Aheader", "file:///etc/passwd",
  ])("rejects URL outside the folder contract: %s", (url) => {
    expect(() => parseDriveFolderUrl(url)).toThrow();
  });
  it("requests only read scope, offline consent and a fixed callback", () => {
    const url = new URL(oauthAuthorizationUrl("a".repeat(32)));
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/drive.readonly");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/google/callback");
    expect(url.toString()).not.toContain("client-secret");
    expect(() => oauthAuthorizationUrl("weak")).toThrow(/Status/);
  });
  it.each(["http://public.example/api/google/callback", "https://public.example/other", "https://public.example/api/google/callback?next=evil", "https://name:password@public.example/api/google/callback"])("rejects unsafe callback %s", (uri) => {
    vi.stubEnv("GOOGLE_REDIRECT_URI", uri);
    expect(oauthConfigured()).toBe(false);
  });
  it("exchanges code and refreshes without retry or query-string secrets", async () => {
    const fetcher = vi.fn().mockImplementation(async () => response({ access_token: "access", refresh_token: "refresh", expires_in: 3600 }));
    vi.stubGlobal("fetch", fetcher);
    expect(await exchangeCode("one-time-code")).toEqual({ accessToken: "access", refreshToken: "refresh", expiresIn: 3600 });
    await refreshAccessToken("refresh");
    expect(fetcher).toHaveBeenCalledTimes(2);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(init.redirect).toBe("error");
    expect(init.body.get("code")).toBe("one-time-code");
    expect(init.body.get("redirect_uri")).toBe("http://localhost:3000/api/google/callback");
    expect(fetcher.mock.calls[1][1].body.get("refresh_token")).toBe("refresh");
  });
  it("handles revoked grants without revealing provider text", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ error: "invalid_grant", error_description: "secret-token" }, 400));
    vi.stubGlobal("fetch", fetcher);
    await expect(refreshAccessToken("refresh")).rejects.toMatchObject({ code: "RECONNECT" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects missing read scope", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ access_token: "a", expires_in: 3600, scope: "openid" })));
    await expect(exchangeCode("c")).rejects.toMatchObject({ code: "RECONNECT" });
  });
  it("revokes with a form body", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(""));
    vi.stubGlobal("fetch", fetcher);
    await revokeToken("token");
    expect(fetcher.mock.calls[0][0]).toBe("https://oauth2.googleapis.com/revoke");
    expect(fetcher.mock.calls[0][1].body.get("token")).toBe("token");
  });
});

describe("Drive reads", () => {
  it("requests shared drive children and passes pagination plus resource key", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ files: [file], nextPageToken: "page-2" }));
    vi.stubGlobal("fetch", fetcher);
    expect(await listDriveChildren("access", "folder", "page-1", "key")).toEqual({ files: [file], nextPageToken: "page-2" });
    const [url, init] = fetcher.mock.calls[0];
    expect(url.searchParams.get("q")).toBe("'folder' in parents and trashed = false");
    expect(url.searchParams.get("supportsAllDrives")).toBe("true");
    expect(url.searchParams.get("includeItemsFromAllDrives")).toBe("true");
    expect(url.searchParams.get("pageToken")).toBe("page-1");
    expect(init.headers["X-Goog-Drive-Resource-Keys"]).toBe("folder/key");
    expect(init.headers.authorization).toBe("Bearer access");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.redirect).toBe("error");
  });
  it("never interpolates a malicious ID into a query or URL", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(listDriveChildren("access", "x' or '1'='1")).rejects.toMatchObject({ code: "INVALID_ID" });
    await expect(getDriveFile("access", "https://evil.example")).rejects.toMatchObject({ code: "INVALID_ID" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not mark incomplete inventories complete", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ files: [], incompleteSearch: true })));
    await expect(listDriveChildren("a", "f")).rejects.toMatchObject({ code: "INCOMPLETE_SEARCH" });
  });
  it.each([[403, "FORBIDDEN"], [404, "NOT_FOUND"], [429, "RATE_LIMIT"], [401, "RECONNECT"]])("maps status %i to actionable %s", async (status, code) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({}, status as number)));
    await expect(getDriveFile("a", "f")).rejects.toMatchObject({ code });
  });
  it("distinguishes a 403 rate limit from denied permissions", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ error: { errors: [{ reason: "userRateLimitExceeded" }] } }, 403)));
    await expect(getDriveFile("a", "f")).rejects.toMatchObject({ code: "RATE_LIMIT" });
  });
  it("returns shortcut targets for inventory approval without following them", async () => {
    const shortcut = { ...file, mimeType: "application/vnd.google-apps.shortcut", shortcutDetails: { targetId: "external", targetMimeType: "application/vnd.google-apps.folder", targetResourceKey: "key" } };
    const fetcher = vi.fn().mockResolvedValue(response(shortcut)); vi.stubGlobal("fetch", fetcher);
    expect(await getDriveFile("a", "file_1")).toEqual(shortcut);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("Bounded Drive downloads", () => {
  it.each([
    ["application/vnd.google-apps.document", "profile", "profile.txt", "text/plain"],
    ["application/vnd.google-apps.spreadsheet", "books.xlsx", "books.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ])("exports %s through a fixed API URL", async (mimeType, name, expectedName, exportMime) => {
    const fetcher = vi.fn().mockResolvedValue(new Response("content")); vi.stubGlobal("fetch", fetcher);
    const result = await downloadDriveFile("token", { ...file, mimeType, name, webViewLink: "https://evil.example/steal" });
    expect(result).toEqual({ name: expectedName, data: Buffer.from("content") });
    const url = fetcher.mock.calls[0][0];
    expect(url.origin).toBe("https://www.googleapis.com");
    expect(url.pathname).toBe("/drive/v3/files/file_1/export");
    expect(url.searchParams.get("mimeType")).toBe(exportMime);
  });
  it("refuses declared oversized files before fetching", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(downloadDriveFile("a", { ...file, size: String(DRIVE_FILE_LIMIT + 1) })).rejects.toMatchObject({ code: "TOO_LARGE" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("cancels oversized streams even without Content-Length", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(DRIVE_FILE_LIMIT)); controller.enqueue(new Uint8Array(1)); }, cancel });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream)));
    await expect(downloadDriveFile("a", file)).rejects.toMatchObject({ code: "TOO_LARGE" });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it("allows exactly 10 MiB and returns original bytes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array(DRIVE_FILE_LIMIT))));
    expect((await downloadDriveFile("a", file)).data.byteLength).toBe(DRIVE_FILE_LIMIT);
  });
  it.each(["archive.xls", "letter.docx", "scan.png", "slides.pptx"])("rejects unsupported %s before fetching", async (name) => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(downloadDriveFile("a", { ...file, name })).rejects.toMatchObject({ code: "UNSUPPORTED" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("exposes Google export size failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ error: { errors: [{ reason: "exportSizeLimitExceeded" }] } }, 403)));
    await expect(downloadDriveFile("a", { ...file, mimeType: "application/vnd.google-apps.document" })).rejects.toMatchObject({ code: "TOO_LARGE" });
  });
});
