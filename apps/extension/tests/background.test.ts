import { beforeEach, describe, expect, it, vi } from "vitest";

import { fallbackContextGraph, fetchContextTreeFromActiveTab, isSupportedUrl } from "../src/background";

describe("extension background helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts supported paper hosts and rejects unsupported hosts", () => {
    expect(isSupportedUrl("https://arxiv.org/abs/1234.5678")).toBe(true);
    expect(isSupportedUrl("https://example.com/paper")).toBe(false);
  });

  it("returns an unsupported-page response before attempting extraction", async () => {
    const chromeApi = {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 1, url: "https://example.com/paper" }]),
      },
    } as unknown as typeof chrome;

    const response = await fetchContextTreeFromActiveTab({ chromeApi, fetchImpl: vi.fn() as unknown as typeof fetch });

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error).toMatch(/Unsupported page/);
    }
  });

  it("falls back to a local graph when backend graph generation fails", async () => {
    const chromeApi = {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 7, url: "https://arxiv.org/abs/1706.03762" }]),
      },
      scripting: {
        executeScript: vi.fn().mockResolvedValue([
          {
            result: {
              title: "Attention Is All You Need",
              paperText:
                "Transformers replace recurrence with attention. They improve translation quality and training efficiency. "
                + "This enables practical sequence modeling for multiple language tasks. ".repeat(8),
            },
          },
        ]),
      },
    } as unknown as typeof chrome;

    const fetchImpl = vi.fn().mockRejectedValue(new Error("backend unavailable")) as unknown as typeof fetch;

    const response = await fetchContextTreeFromActiveTab({ chromeApi, fetchImpl });

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.data.title).toBe("Attention Is All You Need");
      expect(response.data.nodes.length).toBeGreaterThanOrEqual(2);
      expect(response.data.useCases.length).toBeGreaterThan(0);
      expect(response.data.extraction.usedFallbackGraph).toBe(true);
    }
  });

  it("builds a stable fallback graph payload", () => {
    const payload = fallbackContextGraph(
      "Test Paper",
      "Sentence one. Sentence two about evaluation. Sentence three about deployment. Sentence four about limitations. ".repeat(6),
      "https://arxiv.org/abs/1234.5678"
    );

    expect(payload.title).toBe("Test Paper");
    expect(payload.nodes.length).toBe(8);
    expect(payload.edges.length).toBeGreaterThan(0);
    expect(payload.extraction.strategy).toBe("local-fallback-graph");
  });
});
