"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { SavantTerminal } from "@/components/SavantTerminal";
import { PaperGraphExplorer } from "@/components/PaperGraphExplorer";
import { FloatingNodesBackground } from "@/components/FloatingNodesBackground";
import { savantFetch } from "@/lib/api";

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
    workspace: {
      sessionId: string;
      bookmarks: string[];
      savedInsights: string[];
      nodeNotes: Record<string, string>;
      selectedNodeId: string | null;
    } | null;
  }
>;

type JobPayload = {
  status?: "queued" | "processing" | "completed" | "failed";
  result?: {
    graph_data?: GraphPayload;
    paper_text?: string;
  };
  error?: string | null;
};

async function pollGraphJob(jobId: string, attempts = 40): Promise<{ graphData: GraphPayload; paperText: string }> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await savantFetch(`/jobs/${jobId}`);
    const payload = (await response.json()) as JobPayload & { detail?: string };
    if (!response.ok) {
      throw new Error(payload.detail || "Failed to load graph job status");
    }
    if (payload.status === "completed" && payload.result?.graph_data && payload.result?.paper_text) {
      return {
        graphData: payload.result.graph_data,
        paperText: payload.result.paper_text,
      };
    }
    if (payload.status === "failed") {
      throw new Error(payload.error || "Graph generation failed");
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1200));
  }
  throw new Error("Graph generation timed out");
}

export default function Home() {
  const [mode, setMode] = useState<Mode>("assistant");
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [graphByConversation, setGraphByConversation] = useState<GraphStateByConversation>({});
  const inFlightGraphKeyRef = useRef<string | null>(null);

  const ensureGraphWorkspace = useCallback(async (docId: string) => {
    const existingRes = await savantFetch(`/graph/workspaces/by-document/${docId}`);
    if (existingRes.ok) {
      const existingPayload = (await existingRes.json()) as {
        workspace: {
          session_id: string;
          bookmarks?: string[];
          saved_insights?: string[];
          node_notes?: Record<string, string>;
          selected_node_id?: string | null;
        };
      };
      return {
        sessionId: existingPayload.workspace.session_id,
        bookmarks: existingPayload.workspace.bookmarks ?? [],
        savedInsights: existingPayload.workspace.saved_insights ?? [],
        nodeNotes: existingPayload.workspace.node_notes ?? {},
        selectedNodeId: existingPayload.workspace.selected_node_id ?? null,
      };
    }

    const createRes = await savantFetch("/graph/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doc_id: docId, title: "Paper Graph Workspace" }),
    });
    const createPayload = (await createRes.json()) as {
      session_id?: string;
      bookmarks?: string[];
      saved_insights?: string[];
      node_notes?: Record<string, string>;
      selected_node_id?: string | null;
      detail?: string;
    };
    if (!createRes.ok || !createPayload.session_id) {
      throw new Error(createPayload.detail || "Failed to create graph workspace");
    }
    return {
      sessionId: createPayload.session_id,
      bookmarks: createPayload.bookmarks ?? [],
      savedInsights: createPayload.saved_insights ?? [],
      nodeNotes: createPayload.node_notes ?? {},
      selectedNodeId: createPayload.selected_node_id ?? null,
    };
  }, []);

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
          workspace: prev[conversationId]?.workspace ?? null,
        },
      }));

      const queueRes = await savantFetch(`/documents/${docId}/graph`, {
        method: "POST",
      });
      const queuePayload = (await queueRes.json()) as {
        status?: string;
        job_id?: string | null;
        detail?: string;
      };
      if (!queueRes.ok) {
        throw new Error(queuePayload.detail || "Failed to queue graph generation");
      }

      let prefetched: { graphData: GraphPayload; paperText: string };
      if (queuePayload.status === "completed") {
        const cachedRes = await savantFetch(`/documents/${docId}/graph`);
        const cachedPayload = (await cachedRes.json()) as {
          graph_cache?: { graph_data?: GraphPayload; paper_text?: string };
          detail?: string;
        };
        if (!cachedRes.ok || !cachedPayload.graph_cache?.graph_data || !cachedPayload.graph_cache?.paper_text) {
          throw new Error(cachedPayload.detail || "Failed to load cached graph data");
        }
        prefetched = {
          graphData: cachedPayload.graph_cache.graph_data,
          paperText: cachedPayload.graph_cache.paper_text,
        };
      } else if (queuePayload.job_id) {
        prefetched = await pollGraphJob(queuePayload.job_id);
      } else {
        throw new Error("Graph job did not return a job id");
      }

      const workspace = await ensureGraphWorkspace(docId);

      setGraphByConversation((prev) => ({
        ...prev,
        [conversationId]: {
          docId,
          status: "ready",
          error: null,
          prefetched,
          workspace,
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
          workspace: prev[conversationId]?.workspace ?? null,
        },
      }));
    } finally {
      if (inFlightGraphKeyRef.current === graphKey) {
        inFlightGraphKeyRef.current = null;
      }
    }
  }, [ensureGraphWorkspace]);

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
              workspace: null,
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
            workspace: existing?.workspace ?? null,
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
              workspace={activeGraphState?.workspace ?? null}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
