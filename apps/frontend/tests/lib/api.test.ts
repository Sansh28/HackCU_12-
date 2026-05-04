import { beforeEach, describe, expect, it, vi } from "vitest";

import { savantFetch, withOwnerHeaders } from "@/lib/api";

vi.mock("@/lib/owner", () => ({
  getClientAuthSession: vi.fn().mockResolvedValue({
    accessToken: "test-token",
    ownerId: "owner_test",
    expiresAt: 9_999_999_999,
  }),
}));

describe("frontend api helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("adds the bearer auth header while preserving existing headers", async () => {
    const headers = await withOwnerHeaders({ "Content-Type": "application/json" });

    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Authorization")).toBe("Bearer test-token");
  });

  it("calls fetch with the API base url and auth header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await savantFetch("/healthz", { method: "GET" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8000/healthz");

    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer test-token");
  });
});
