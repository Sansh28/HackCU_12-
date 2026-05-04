import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Home from "@/app/page";
import { savantFetch } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  savantFetch: vi.fn(),
}));

vi.mock("@/components/FloatingNodesBackground", () => ({
  FloatingNodesBackground: () => <div data-testid="floating-background" />,
}));

vi.mock("@/components/SavantTerminal", () => ({
  SavantTerminal: ({
    onConversationChange,
    onUploadComplete,
    graphStatusByConversation,
  }: {
    onConversationChange?: (payload: { conversationId: string; docId: string | null; fileName?: string | null }) => void;
    onUploadComplete?: (payload: { docId: string; filename: string; conversationId: string }) => void;
    graphStatusByConversation?: Record<string, string>;
  }) => (
    <div>
      <div data-testid="graph-status">{JSON.stringify(graphStatusByConversation ?? {})}</div>
      <button onClick={() => onConversationChange?.({ conversationId: "conv-1", docId: "doc-1", fileName: "paper.pdf" })}>
        select-conversation
      </button>
      <button onClick={() => onConversationChange?.({ conversationId: "conv-2", docId: null, fileName: null })}>clear-conversation</button>
      <button onClick={() => onUploadComplete?.({ conversationId: "conv-1", docId: "doc-1", filename: "paper.pdf" })}>upload-complete</button>
    </div>
  ),
}));

vi.mock("@/components/PaperGraphExplorer", () => ({
  PaperGraphExplorer: ({
    embedded,
    autoDocId,
    backgroundStatus,
    backgroundError,
    prefetchedGraph,
    workspace,
  }: {
    embedded: boolean;
    autoDocId: string | null;
    backgroundStatus: string;
    backgroundError: string | null;
    prefetchedGraph: { graphData: { title: string } } | null;
    workspace: { sessionId: string; bookmarks: string[] } | null;
  }) => (
    <div data-testid="graph-explorer">
      <div>embedded:{String(embedded)}</div>
      <div>autoDocId:{autoDocId ?? "null"}</div>
      <div>backgroundStatus:{backgroundStatus}</div>
      <div>backgroundError:{backgroundError ?? "null"}</div>
      <div>prefetched:{prefetchedGraph?.graphData.title ?? "none"}</div>
      <div>workspace:{workspace?.sessionId ?? "none"}</div>
    </div>
  ),
}));

describe("Home page graph orchestration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds a graph in the background after upload and exposes it in graph mode", async () => {
    const fetchMock = vi.mocked(savantFetch);
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "queued", job_id: "job-1" }), {
          status: 202,
          headers: { "Content-Type": "application/json" },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: "completed",
            result: {
              graph_data: { title: "Paper Graph", nodes: [], edges: [] },
              paper_text: "Transformers are useful.",
            },
          }),
          {
          status: 200,
          headers: { "Content-Type": "application/json" },
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: "missing" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            session_id: "graph-session-1",
            bookmarks: [],
            saved_insights: [],
            node_notes: {},
            selected_node_id: null,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        )
      );

    render(<Home />);

    fireEvent.click(screen.getByText("upload-complete"));

    await waitFor(() => expect(screen.getByText("Ready")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Paper Graph Explorer"));

    expect(screen.getByText("backgroundStatus:ready")).toBeInTheDocument();
    expect(screen.getByText("prefetched:Paper Graph")).toBeInTheDocument();
    expect(screen.getByText("workspace:graph-session-1")).toBeInTheDocument();
  });

  it("shows an error state when graph generation fails", async () => {
    const fetchMock = vi.mocked(savantFetch);
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "queued", job_id: "job-2" }), {
          status: 202,
          headers: { "Content-Type": "application/json" },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "failed", error: "Graph service unavailable" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

    render(<Home />);

    fireEvent.click(screen.getByText("upload-complete"));

    await waitFor(() => expect(screen.getByText("Error")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Paper Graph Explorer"));

    expect(screen.getByText("backgroundStatus:error")).toBeInTheDocument();
    expect(screen.getByText("backgroundError:Graph service unavailable")).toBeInTheDocument();
  });
});
