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
        <div className="bg-[#fffaf2]/80 backdrop-blur-sm border border-[#cfb999] rounded-2xl p-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-widest text-[#8a6344] font-mono">Answer Path</div>
              <div className="mt-1 text-sm text-[#4b392d] leading-relaxed">{summary}</div>
            </div>
            <div
              className={`rounded-full px-3 py-1 text-[10px] font-mono uppercase tracking-[0.16em] ${
                telemetry?.retrieval_mode === "lexical_only" || telemetry?.llm_fallback
                  ? "border border-orange-700/20 bg-orange-100/70 text-orange-800"
                  : "border border-emerald-700/20 bg-emerald-100/70 text-emerald-800"
              }`}
            >
              {telemetry?.retrieval_mode === "lexical_only" || telemetry?.llm_fallback ? "Degraded Path" : "Primary Path"}
            </div>
          </div>
        </div>
      )}

      {citations.length > 0 && (
        <div className="bg-[#fffaf2]/80 backdrop-blur-sm border border-[#cfb999] rounded-2xl p-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-widest text-[#8a6344] font-mono">Evidence</div>
              <div className="mt-1 text-xs text-[#6e5a47]">Inspect the exact chunk, page reference, and why it was surfaced for this answer.</div>
            </div>
            <div className="text-[10px] font-mono text-[#7d6348]">{citations.length} cited chunks</div>
          </div>
          <div className="space-y-2">
            {citations.map((citation, idx) => (
              <details
                key={`${citation.page_number}-${citation.chunk_index}-${idx}`}
                className="rounded-lg border border-[#cfb999] bg-[#fffdf8] px-3 py-2"
              >
                <summary className="cursor-pointer list-none flex flex-col gap-2 text-xs font-mono text-[#4d3a2c]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-md bg-[#f4ead9] border border-[#ccb794] px-2 py-1">p.{citation.page_number ?? "?"}</span>
                    <span className="rounded-md bg-[#f4ead9] border border-[#ccb794] px-2 py-1">chunk {citation.chunk_index ?? "?"}</span>
                    <span className="rounded-md bg-[#e7f2e8] border border-emerald-700/20 px-2 py-1">score {citation.score ?? 0}</span>
                    {citation.filename ? <span className="truncate text-[#6d5742]">{citation.filename}</span> : null}
                  </div>
                  <div className="text-[11px] leading-relaxed text-[#7d6348]">
                    {citation.selection_reason || "Used as supporting evidence for the generated answer."}
                  </div>
                </summary>
                <div className="mt-3 space-y-3">
                  {citation.match_terms?.length ? (
                    <div className="flex flex-wrap gap-2">
                      {citation.match_terms.map((term) => (
                        <span key={term} className="rounded-full border border-[#ccb794] bg-[#f4ead9] px-2 py-1 text-[10px] font-mono text-[#6d5742]">
                          {term}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="rounded-lg border border-[#cfb999] bg-[#fff9f0] px-3 py-3 text-sm leading-relaxed text-[#443327]">
                    {citation.snippet || "No snippet available."}
                  </div>
                </div>
              </details>
            ))}
          </div>
        </div>
      )}

      {telemetry && (
        <div className="bg-[#fffaf2]/80 backdrop-blur-sm border border-[#cfb999] rounded-xl p-3 text-xs text-[#5c4735] font-mono">
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
