import type { Citation, QueryTelemetry } from "@/components/terminal/types";

type InsightsPanelProps = {
  citations: Citation[];
  telemetry: QueryTelemetry | null;
};

function fallbackSummary(telemetry: QueryTelemetry | null): string | null {
  if (!telemetry) return null;
  if (telemetry.retrieval_mode === "lexical_only" && telemetry.llm_fallback) {
    return "The answer used lexical retrieval and local synthesis fallback, so it is grounded in chunk text but not from the primary model path.";
  }
  if (telemetry.retrieval_mode === "lexical_only") {
    return "The answer came from lexical-only retrieval because vector retrieval was unavailable or rate-limited.";
  }
  if (telemetry.llm_fallback) {
    return "The answer used local synthesis fallback after retrieval completed, so wording is more conservative than the primary generation path.";
  }
  return "The answer came from the normal retrieval and synthesis pipeline.";
}

export function InsightsPanel({ citations, telemetry }: InsightsPanelProps) {
  const summary = fallbackSummary(telemetry);

  return (
    <>
      {summary && (
        <div className="bg-[#171109]/58 backdrop-blur-sm border border-[#7a5b1b]/70 rounded-xl p-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-widest text-[#c8a55b] font-mono">Answer Path</div>
              <div className="mt-1 text-sm text-[#f5deb0] leading-relaxed">{summary}</div>
            </div>
            <div
              className={`rounded-full px-3 py-1 text-[10px] font-mono uppercase tracking-[0.16em] ${
                telemetry?.retrieval_mode === "lexical_only" || telemetry?.llm_fallback
                  ? "border border-orange-500/40 bg-orange-500/10 text-orange-200"
                  : "border border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
              }`}
            >
              {telemetry?.retrieval_mode === "lexical_only" || telemetry?.llm_fallback ? "Degraded Path" : "Primary Path"}
            </div>
          </div>
        </div>
      )}

      {citations.length > 0 && (
        <div className="bg-[#171109]/52 backdrop-blur-sm border border-[#7a5b1b]/70 rounded-xl p-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-widest text-[#c8a55b] font-mono">Evidence</div>
              <div className="mt-1 text-xs text-[#d9c087]">Inspect the exact chunk, page reference, and why it was surfaced for this answer.</div>
            </div>
            <div className="text-[10px] font-mono text-[#9db2d8]">{citations.length} cited chunks</div>
          </div>
          <div className="space-y-2">
            {citations.map((citation, idx) => (
              <details
                key={`${citation.page_number}-${citation.chunk_index}-${idx}`}
                className="rounded-lg border border-[#7a5b1b]/60 bg-[#0f0b06]/60 px-3 py-2"
              >
                <summary className="cursor-pointer list-none flex flex-col gap-2 text-xs font-mono text-[#f7e1b1]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-md bg-[#12233a] border border-[#425f89] px-2 py-1">p.{citation.page_number ?? "?"}</span>
                    <span className="rounded-md bg-[#1a150d] border border-[#7a5b1b] px-2 py-1">chunk {citation.chunk_index ?? "?"}</span>
                    <span className="rounded-md bg-[#112416] border border-emerald-600/40 px-2 py-1">score {citation.score ?? 0}</span>
                    {citation.filename ? <span className="truncate text-[#b9c8e1]">{citation.filename}</span> : null}
                  </div>
                  <div className="text-[11px] leading-relaxed text-[#d8c089]">
                    {citation.selection_reason || "Used as supporting evidence for the generated answer."}
                  </div>
                </summary>
                <div className="mt-3 space-y-3">
                  {citation.match_terms?.length ? (
                    <div className="flex flex-wrap gap-2">
                      {citation.match_terms.map((term) => (
                        <span key={term} className="rounded-full border border-[#425f89] bg-[#12233a]/70 px-2 py-1 text-[10px] font-mono text-[#b9c8e1]">
                          {term}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="rounded-lg border border-[#3a2d18] bg-[#0b0906] px-3 py-3 text-sm leading-relaxed text-[#f5deb0]">
                    {citation.snippet || "No snippet available."}
                  </div>
                </div>
              </details>
            ))}
          </div>
        </div>
      )}

      {telemetry && (
        <div className="bg-[#171109]/52 backdrop-blur-sm border border-[#7a5b1b]/70 rounded-xl p-3 text-xs text-[#f5deb0] font-mono">
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            <span>total {telemetry.total_ms ?? 0}ms</span>
            <span>embed {telemetry.embed_ms ?? 0}ms</span>
            <span>retrieve {telemetry.retrieval_ms ?? 0}ms</span>
            <span>llm {telemetry.llm_ms ?? 0}ms</span>
            <span>tts {telemetry.tts_ms ?? 0}ms</span>
            {telemetry.retrieval_mode ? <span>mode {telemetry.retrieval_mode}</span> : null}
          </div>
        </div>
      )}
    </>
  );
}
