import type { Citation, QueryTelemetry } from "@/components/terminal/types";

type InsightsPanelProps = {
  citations: Citation[];
  telemetry: QueryTelemetry | null;
};

export function InsightsPanel({ citations, telemetry }: InsightsPanelProps) {
  return (
    <>
      {citations.length > 0 && (
        <div className="bg-[#171109]/52 backdrop-blur-sm border border-[#7a5b1b]/70 rounded-xl p-3 space-y-2">
          <div className="text-xs uppercase tracking-widest text-[#c8a55b] font-mono">Citations</div>
          {citations.map((citation, idx) => (
            <div key={`${citation.page_number}-${citation.chunk_index}-${idx}`} className="text-xs text-[#f5deb0] font-mono">
              p.{citation.page_number ?? "?"} c.{citation.chunk_index ?? "?"} | score {citation.score ?? 0} | {citation.snippet}
            </div>
          ))}
        </div>
      )}

      {telemetry && (
        <div className="bg-[#171109]/52 backdrop-blur-sm border border-[#7a5b1b]/70 rounded-xl p-3 text-xs text-[#f5deb0] font-mono">
          total {telemetry.total_ms ?? 0}ms | embed {telemetry.embed_ms ?? 0}ms | retrieve {telemetry.retrieval_ms ?? 0}ms | llm {telemetry.llm_ms ?? 0}ms | tts {telemetry.tts_ms ?? 0}ms
        </div>
      )}
    </>
  );
}
