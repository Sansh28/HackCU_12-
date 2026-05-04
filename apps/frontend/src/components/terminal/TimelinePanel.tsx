import type { RefObject } from "react";

import type { DocMeta, TimelineItem, WorkflowStage } from "@/components/terminal/types";

type TimelinePanelProps = {
  docMeta: DocMeta | null;
  logScrollPercent: number;
  logsContainerRef: RefObject<HTMLDivElement | null>;
  pipelineStatus: string;
  timelineItems: TimelineItem[];
  uploadedFileName: string | null;
  workflowStages: WorkflowStage[];
  onLogScroll: () => void;
  onLogSliderChange: (value: number) => void;
};

export function TimelinePanel({
  docMeta,
  logScrollPercent,
  logsContainerRef,
  pipelineStatus,
  timelineItems,
  uploadedFileName,
  workflowStages,
  onLogScroll,
  onLogSliderChange,
}: TimelinePanelProps) {
  const statusStyles: Record<WorkflowStage["status"], string> = {
    idle: "border-[#5d4930] bg-[#120d08] text-[#b99953]",
    active: "border-amber-500/50 bg-amber-400/10 text-amber-200",
    done: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
    error: "border-red-500/40 bg-red-500/10 text-red-200",
    degraded: "border-orange-500/40 bg-orange-500/10 text-orange-200",
  };

  return (
    <div className="flex gap-2 min-h-0">
      <div
        ref={logsContainerRef}
        onScroll={onLogScroll}
        className="flex-1 bg-[#0a0704]/45 backdrop-blur-md border border-[#37547e]/70 rounded-xl p-4 overflow-y-auto space-y-2 h-[300px] max-h-[420px] min-h-0 shadow-[inset_0_0_0_1px_rgba(120,160,220,0.12)]"
      >
        <div className="mb-3 p-3 rounded-xl border border-[#8d6a20] bg-[#161007]/60 backdrop-blur-sm">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] font-mono uppercase tracking-[0.16em] text-[#f2c14e]">Paper Session</div>
            <div className="text-[11px] font-mono text-[#f7e6bf]">{pipelineStatus}</div>
          </div>
          <div className="mt-1 text-sm text-[#f8e6bf] truncate">{uploadedFileName || "No document uploaded"}</div>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-mono text-[#cfb06f]">
            {docMeta?.pageCount ? <span className="px-2 py-1 rounded-md bg-[#12233a] border border-[#6a4f18]">{docMeta.pageCount} pages</span> : null}
            {docMeta?.chunksProcessed ? <span className="px-2 py-1 rounded-md bg-[#12233a] border border-[#6a4f18]">{docMeta.chunksProcessed} chunks</span> : null}
            {docMeta?.ingestMs ? <span className="px-2 py-1 rounded-md bg-[#12233a] border border-[#6a4f18]">{docMeta.ingestMs} ms ingest</span> : null}
          </div>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
            {workflowStages.map((stage) => (
              <div key={stage.id} className={`rounded-lg border px-3 py-2 ${statusStyles[stage.status]}`}>
                <div className="text-[10px] font-mono uppercase tracking-[0.16em]">{stage.label}</div>
                <div className="mt-1 text-sm font-semibold capitalize">{stage.status}</div>
                <div className="mt-1 text-[11px] leading-relaxed opacity-90">{stage.detail}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2 text-[11px]">
            <div className="rounded-lg border border-[#3b2b15] bg-[#0f0b06] px-3 py-2 text-[#e7d29d]">
              <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-[#c8a55b]">What Happened</div>
              <div className="mt-1 leading-relaxed">
                {pipelineStatus === "Degraded"
                  ? "The system completed the request, but one of the retrieval or synthesis fallbacks was used."
                  : pipelineStatus === "Attention Needed"
                    ? "At least one stage failed and needs another attempt or a backend check."
                    : "The pipeline is moving through upload, retrieval, synthesis, and audio as expected."}
              </div>
            </div>
            <div className="rounded-lg border border-[#3b2b15] bg-[#0f0b06] px-3 py-2 text-[#e7d29d]">
              <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-[#c8a55b]">How To Read Evidence</div>
              <div className="mt-1 leading-relaxed">
                Evidence cards explain why each chunk was selected, which page it came from, and which query terms it matched.
              </div>
            </div>
            <div className="rounded-lg border border-[#3b2b15] bg-[#0f0b06] px-3 py-2 text-[#e7d29d]">
              <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-[#c8a55b]">Graph Readiness</div>
              <div className="mt-1 leading-relaxed">
                Once a paper is ready, its graph workspace can be revisited without re-running the full generation path each time.
              </div>
            </div>
          </div>
        </div>
        {timelineItems.map((item) => (
          <div
            key={item.id}
            className="rounded-lg border px-3 py-2 transition-all duration-200"
            style={{
              borderColor:
                item.tone === "error"
                  ? "rgba(248,113,113,0.45)"
                  : item.tone === "success"
                    ? "rgba(52,211,153,0.35)"
                    : item.tone === "warn"
                      ? "rgba(251,191,36,0.35)"
                      : "rgba(71,101,145,0.4)",
              background:
                item.tone === "error"
                  ? "rgba(127,29,29,0.18)"
                  : item.tone === "success"
                    ? "rgba(6,78,59,0.16)"
                    : item.tone === "warn"
                      ? "rgba(120,53,15,0.16)"
                      : "rgba(18,35,58,0.18)",
            }}
          >
            <div className="flex items-start gap-2">
              <span
                className="mt-1.5 h-1.5 w-1.5 rounded-full"
                style={{
                  backgroundColor:
                    item.tone === "error"
                      ? "#f87171"
                      : item.tone === "success"
                        ? "#34d399"
                        : item.tone === "warn"
                          ? "#fbbf24"
                          : "#f2c14e",
                }}
              />
              <div className="text-[#efd39a] font-mono text-xs sm:text-sm leading-relaxed">{item.raw}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="w-7 bg-[#171109]/50 backdrop-blur-sm border border-[#7a5b1b]/70 rounded-xl flex items-center justify-center px-1">
        <input
          aria-label="Scroll logs"
          type="range"
          min={0}
          max={100}
          value={logScrollPercent}
          onChange={(e) => onLogSliderChange(Number(e.target.value))}
          className="w-24 h-1 -rotate-90 accent-[#f2c14e] cursor-pointer"
        />
      </div>
    </div>
  );
}
