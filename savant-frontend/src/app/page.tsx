"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { SavantTerminal } from "@/components/SavantTerminal";
import { PaperGraphExplorer } from "@/components/PaperGraphExplorer";
import { FloatingNodesBackground } from "@/components/FloatingNodesBackground";

type Mode = "assistant" | "graph";
type GraphPayload = {
  title: string;
  nodes: Array<{
    id: string;
    label: string;
    summary: string;
    category: "foundation" | "method" | "result" | "component" | "concept";
    importance: number;
  }>;
  edges: Array<{ source: string | { id: string }; target: string | { id: string }; label: string }>;
};
type GraphStateByConversation = Record<
  string,
  {
    docId: string | null;
    status: "idle" | "loading" | "ready" | "error";
    error: string | null;
    prefetched: { graphData: GraphPayload; paperText: string } | null;
  }
>;

export default function Home() {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";
  const [mode, setMode] = useState<Mode>("assistant");
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [graphByConversation, setGraphByConversation] = useState<GraphStateByConversation>({});
  const inFlightGraphKeyRef = useRef<string | null>(null);

  const buildGraphInBackground = useCallback(async (conversationId: string, docId: string) => {
    const graphKey = `${conversationId}:${docId}`;
    if (inFlightGraphKeyRef.current === graphKey) return;
    inFlightGraphKeyRef.current = graphKey;
    try {
      setGraphByConversation((prev) => ({
        ...prev,
        [conversationId]: {
          ...(prev[conversationId] || { docId }),
          docId,
          status: "loading",
          error: null,
          prefetched: null,
        },
      }));

      const contextRes = await fetch(`${apiBase}/documents/${docId}/context`);
      const contextData = await contextRes.json();
      if (!contextRes.ok) {
        throw new Error(contextData.detail || "Failed to load uploaded document context");
      }

      const paperText = String(contextData.paper_text || "");
      if (!paperText.trim()) {
        throw new Error("Uploaded document has no extractable text for graph generation");
      }

      const graphRes = await fetch(`${apiBase}/graph/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paper_text: paperText }),
      });
      const graphPayload = await graphRes.json();
      if (!graphRes.ok) {
        throw new Error(graphPayload.detail || "Failed to generate graph");
      }

      setGraphByConversation((prev) => ({
        ...prev,
        [conversationId]: {
          docId,
          status: "ready",
          error: null,
          prefetched: { graphData: graphPayload, paperText },
        },
      }));
    } catch (err) {
      setGraphByConversation((prev) => ({
        ...prev,
        [conversationId]: {
          ...(prev[conversationId] || { docId }),
          docId,
          status: "error",
          error: err instanceof Error ? err.message : "Background graph generation failed",
          prefetched: null,
        },
      }));
    } finally {
      if (inFlightGraphKeyRef.current === graphKey) {
        inFlightGraphKeyRef.current = null;
      }
    }
  }, [apiBase]);

  const handleConversationChange = useCallback(
    ({ conversationId, docId }: { conversationId: string; docId: string | null }) => {
      setActiveConversationId(conversationId);
      if (!docId) {
        setGraphByConversation((prev) => {
          const existing = prev[conversationId];
          if (
            existing &&
            existing.docId === null &&
            existing.status === "idle" &&
            existing.error === null &&
            existing.prefetched === null
          ) {
            return prev;
          }
          return {
            ...prev,
            [conversationId]: {
              docId: null,
              status: "idle",
              error: null,
              prefetched: null,
            },
          };
        });
        return;
      }

      let shouldBuild = false;
      setGraphByConversation((prev) => {
        const existing = prev[conversationId];
        if (existing?.docId === docId) return prev;
        shouldBuild = true;
        return {
          ...prev,
          [conversationId]: {
            docId,
            status: "idle",
            error: null,
            prefetched: null,
          },
        };
      });
      if (shouldBuild) {
        void buildGraphInBackground(conversationId, docId);
      }
    },
    [buildGraphInBackground]
  );

  const handleUploadComplete = useCallback(
    ({ docId, conversationId }: { docId: string; conversationId: string }) => {
      setActiveConversationId(conversationId);
      void buildGraphInBackground(conversationId, docId);
    },
    [buildGraphInBackground]
  );

  const activeGraphState = activeConversationId ? graphByConversation[activeConversationId] : undefined;
  const graphStatusByConversation = useMemo(
    () => Object.fromEntries(Object.entries(graphByConversation).map(([id, state]) => [id, state.status])),
    [graphByConversation]
  );

  return (
    <div className="relative h-screen w-screen text-[#f6e7c1] p-3 sm:p-5 overflow-hidden">
      <FloatingNodesBackground />
      <main className="relative z-10 flex flex-col gap-4 h-full w-full max-w-[1720px] mx-auto">
        <header className="rounded-2xl border border-[#7a5b1b] bg-[#0e0a05]/88 backdrop-blur-xl px-5 py-4 shadow-[0_18px_60px_rgba(0,0,0,0.55)]">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-[#8d6a20] bg-[#171109] px-3 py-1 text-[10px] font-mono uppercase tracking-[0.22em] text-[#f2c14e]">
                Research Cockpit
              </div>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mt-2">Savant</h1>
              <p className="text-sm text-[#d1b26a] mt-1">Analyze papers with chat, voice, and concept graphs in one workspace.</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden sm:flex items-center gap-2 rounded-xl border border-[#7a5b1b] bg-[#171109] px-3 py-2 text-xs font-mono text-[#e0c27c]">
                <span className="h-2 w-2 rounded-full bg-[#f2c14e] shadow-[0_0_12px_rgba(242,193,78,0.8)]" />
                Live Session
              </div>
            </div>
          </div>
        </header>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 rounded-xl border border-[#7a5b1b] bg-[#140f08]/90 p-1">
            <button
              onClick={() => setMode("assistant")}
              className={`px-4 py-2 text-xs sm:text-sm rounded-lg font-mono transition ${
                mode === "assistant"
                  ? "bg-[#f2c14e] text-[#1a1205]"
                  : "bg-transparent text-[#d8b66a] hover:text-[#f7deaa]"
              }`}
            >
              Savant Assistant
            </button>
            <button
              onClick={() => setMode("graph")}
              className={`px-4 py-2 text-xs sm:text-sm rounded-lg font-mono transition ${
                mode === "graph"
                  ? "bg-[#d4a33a] text-[#1a1205]"
                  : "bg-transparent text-[#d8b66a] hover:text-[#f7deaa]"
              }`}
            >
              Paper Graph Explorer
            </button>
          </div>

          <div className="rounded-xl border border-[#7a5b1b] bg-[#140f08]/90 px-3 py-2 text-[11px] font-mono text-[#d8b66a]">
            Graph:
            {activeGraphState?.status === "loading" && <span className="ml-2 text-amber-300">Building</span>}
            {activeGraphState?.status === "ready" && <span className="ml-2 text-[#f2c14e]">Ready</span>}
            {activeGraphState?.status === "error" && <span className="ml-2 text-red-300">Error</span>}
            {!activeGraphState?.status || activeGraphState.status === "idle" ? <span className="ml-2 text-[#b99953]">Idle</span> : null}
          </div>
        </div>

        <div className="flex-1 min-h-0 flex flex-col gap-4 rounded-2xl border border-[#7a5b1b] bg-[#0d0905]/88 backdrop-blur-xl p-3 sm:p-4 overflow-hidden shadow-[0_22px_70px_rgba(0,0,0,0.5)]">
          <div className={mode === "assistant" ? "block" : "hidden"} aria-hidden={mode !== "assistant"}>
            <SavantTerminal
              onConversationChange={handleConversationChange}
              onUploadComplete={handleUploadComplete}
              graphStatusByConversation={graphStatusByConversation}
            />
          </div>

          <div className={mode === "graph" ? "block" : "hidden"} aria-hidden={mode !== "graph"}>
            <PaperGraphExplorer
              embedded
              autoDocId={activeGraphState?.status === "idle" ? activeGraphState?.docId ?? null : null}
              prefetchedGraph={activeGraphState?.prefetched ?? null}
              backgroundStatus={activeGraphState?.status ?? "idle"}
              backgroundError={activeGraphState?.error ?? null}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
