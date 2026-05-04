import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import App from "../../src/sidepanel/App";
import type { ExtensionResponse } from "../../src/shared/types";

vi.mock("../../src/sidepanel/CitationTreeGraph", () => ({
  CitationTreeGraph: ({ paperText }: { paperText: string }) => <div data-testid="citation-graph">{paperText}</div>,
}));

const sendMessageMock = vi.fn();

describe("extension sidepanel App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("chrome", {
      runtime: {
        lastError: null,
        sendMessage: sendMessageMock,
      },
    });
  });

  it("renders graph payload returned from the extension background flow", async () => {
    sendMessageMock.mockImplementation((_message: unknown, callback: (response: ExtensionResponse) => void) => {
      callback({
        ok: true,
        data: {
          sourceUrl: "https://arxiv.org/abs/1234.5678",
          title: "Attention Is All You Need",
          paperText: "Transformer context",
          nodes: [
            { id: "n1", label: "Attention", summary: "Summary", category: "method", importance: 5 },
            { id: "n2", label: "Encoder", summary: "Summary", category: "component", importance: 4 },
          ],
          edges: [{ source: "n1", target: "n2", label: "uses" }],
          useCases: [{ title: "Translation", description: "Machine translation use case" }],
          extraction: {
            site: "arxiv",
            strategy: "adapter:arxiv",
            confidence: "high",
            usedFallbackGraph: false,
            usedBackendGraph: true,
          },
        },
      });
    });

    render(<App />);

    await waitFor(() => expect(screen.getByText("Attention Is All You Need")).toBeInTheDocument());
    expect(screen.getByText("2 concepts")).toBeInTheDocument();
    expect(screen.getByText("1 links")).toBeInTheDocument();
    expect(screen.getByText("Translation")).toBeInTheDocument();
    expect(screen.getByText(/strategy: adapter:arxiv/i)).toBeInTheDocument();
    expect(screen.getByTestId("citation-graph")).toHaveTextContent("Transformer context");
  });

  it("renders an error state when runtime messaging fails", async () => {
    sendMessageMock.mockImplementation((_message: unknown, callback: (response: ExtensionResponse) => void) => {
      const runtime = (globalThis as unknown as { chrome: { runtime: { lastError: { message: string } | null } } }).chrome.runtime;
      runtime.lastError = { message: "No active tab available." };
      callback({ ok: false, error: "ignored" });
      runtime.lastError = null;
    });

    render(<App />);

    await waitFor(() => expect(screen.getByText("No active tab available.")).toBeInTheDocument());
  });
});
