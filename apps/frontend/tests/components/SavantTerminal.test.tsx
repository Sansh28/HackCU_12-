import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SavantTerminal } from "@/components/SavantTerminal";
import { savantFetch } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  savantFetch: vi.fn(),
}));

vi.mock("@/components/terminal/ConversationSidebar", () => ({
  ConversationSidebar: ({
    conversations,
    activeConversationId,
    onCreateConversation,
    onSelectConversation,
  }: {
    conversations: Array<{ id: string; title: string; fileName?: string | null }>;
    activeConversationId: string | null;
    onCreateConversation: () => void;
    onSelectConversation: (conversationId: string) => void;
  }) => (
    <div>
      <div data-testid="active-conversation">{activeConversationId ?? "none"}</div>
      <button onClick={onCreateConversation}>create-conversation</button>
      {conversations.map((conversation) => (
        <button key={conversation.id} onClick={() => onSelectConversation(conversation.id)}>
          select-{conversation.title}-{conversation.id}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("@/components/terminal/TimelinePanel", () => ({
  TimelinePanel: ({
    timelineItems,
    uploadedFileName,
  }: {
    timelineItems: Array<{ id: string; raw: string }>;
    uploadedFileName: string | null;
  }) => (
    <div>
      <div data-testid="uploaded-file">{uploadedFileName ?? "none"}</div>
      {timelineItems.map((item) => (
        <div key={item.id}>{item.raw}</div>
      ))}
    </div>
  ),
}));

vi.mock("@/components/terminal/InsightsPanel", () => ({
  InsightsPanel: ({
    citations,
    telemetry,
  }: {
    citations: Array<unknown>;
    telemetry: { retrieval_mode?: string } | null;
  }) => (
    <div>
      <div data-testid="citations-count">{citations.length}</div>
      <div data-testid="retrieval-mode">{telemetry?.retrieval_mode ?? "none"}</div>
    </div>
  ),
}));

vi.mock("@/components/terminal/SuggestionsPanel", () => ({
  SuggestionsPanel: ({
    suggestedQuestions,
    applySuggestedQuestion,
  }: {
    suggestedQuestions: string[];
    applySuggestedQuestion: (suggestion: string) => Promise<void>;
  }) => (
    <div>
      <div data-testid="suggestions-count">{suggestedQuestions.length}</div>
      <button onClick={() => void applySuggestedQuestion(suggestedQuestions[0])}>apply-suggestion</button>
    </div>
  ),
}));

vi.mock("@/components/terminal/VoicePlaybackPanel", () => ({
  VoicePlaybackPanel: () => <div>voice-playback</div>,
}));

vi.mock("@/components/terminal/QueryComposer", () => ({
  QueryComposer: ({
    docId,
    query,
    shareUrl,
    uploadedFileName,
    isProcessing,
    onFileUpload,
    onQueryChange,
    onSubmit,
  }: {
    docId: string | null;
    query: string;
    shareUrl: string | null;
    uploadedFileName: string | null;
    isProcessing: boolean;
    onFileUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
    onQueryChange: (value: string) => void;
    onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  }) => (
    <div>
      <div data-testid="composer-doc">{docId ?? "none"}</div>
      <div data-testid="composer-file">{uploadedFileName ?? "none"}</div>
      <div data-testid="composer-share">{shareUrl ?? "none"}</div>
      <div data-testid="composer-processing">{String(isProcessing)}</div>
      <button
        onClick={() =>
          onFileUpload(({
            target: {
              files: [new File(["pdf"], "paper.pdf", { type: "application/pdf" })],
            },
          } as unknown) as React.ChangeEvent<HTMLInputElement>)
        }
      >
        trigger-upload
      </button>
      <button onClick={() => onQueryChange("What is the contribution?")}>set-query</button>
      <button onClick={() => onSubmit({ preventDefault() {} } as React.FormEvent<HTMLFormElement>)}>submit-query</button>
      <div data-testid="composer-query">{query}</div>
    </div>
  ),
}));

describe("SavantTerminal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("handles upload, query submission, and conversation switching", async () => {
    const fetchMock = vi.mocked(savantFetch);
    fetchMock.mockRejectedValueOnce(new Error("no backend hydrate"));
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          job_id: "job-1",
          doc_id: "doc-1",
          status: "queued",
        }),
        { status: 202, headers: { "Content-Type": "application/json" } }
      )
    );
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: "completed",
          result: {
            doc_id: "doc-1",
            chunk_count: 4,
            page_count: 2,
            retrieval_mode: "hybrid",
            ingest_ms: 14.2,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          session_id: "session-1",
          share_url: "/share/session-1",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          answer: "The paper introduces a new transformer approach.",
          audio_base64: null,
          context_used: [0, 1],
          citations: [{ page_number: 1, chunk_index: 0, snippet: "Evidence" }],
          telemetry: { retrieval_mode: "hybrid", total_ms: 33.1 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    render(<SavantTerminal />);

    await waitFor(() => expect(screen.getByTestId("composer-doc")).toHaveTextContent("none"));
    const originalConversationId = screen.getByTestId("active-conversation").textContent as string;

    fireEvent.click(screen.getByText("trigger-upload"));

    await waitFor(() => expect(screen.getByTestId("composer-doc")).toHaveTextContent("doc-1"));
    expect(screen.getByTestId("composer-share")).toHaveTextContent("http://127.0.0.1:8000/share/session-1");
    expect(screen.getByText("Ingestion complete! Extracted and stored 4 chunks.")).toBeInTheDocument();

    fireEvent.click(screen.getByText("set-query"));
    expect(screen.getByTestId("composer-query")).toHaveTextContent("What is the contribution?");

    fireEvent.click(screen.getByText("submit-query"));

    await waitFor(() => expect(screen.getByText(/The paper introduces a new transformer approach\./)).toBeInTheDocument());
    expect(screen.getByTestId("citations-count")).toHaveTextContent("1");
    expect(screen.getByTestId("retrieval-mode")).toHaveTextContent("hybrid");

    fireEvent.click(screen.getByText("create-conversation"));
    await waitFor(() => expect(screen.getByTestId("composer-doc")).toHaveTextContent("none"));
    expect(screen.getByTestId("composer-file")).toHaveTextContent("none");

    const originalConversationButton = await screen.findByText((content) => content.endsWith(`-${originalConversationId}`));
    fireEvent.click(originalConversationButton);
    await waitFor(() => expect(screen.getByTestId("composer-doc")).toHaveTextContent("doc-1"));
    expect(screen.getByText(/The paper introduces a new transformer approach\./)).toBeInTheDocument();
  });
});
