import type { ChangeEvent, FormEvent } from "react";

import type { WorkflowStage } from "@/components/terminal/types";

type QueryComposerProps = {
  canUseSpeech: boolean;
  docId: string | null;
  isListening: boolean;
  isProcessing: boolean;
  isUploading: boolean;
  pageNumber: string;
  query: string;
  shareUrl: string | null;
  uploadedFileName: string | null;
  workflowStages: WorkflowStage[];
  onCopyShareLink: () => void;
  onFileUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onPageNumberChange: (value: string) => void;
  onQueryChange: (value: string) => void;
  onStartVoiceInput: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function QueryComposer({
  canUseSpeech,
  docId,
  isListening,
  isProcessing,
  isUploading,
  pageNumber,
  query,
  shareUrl,
  uploadedFileName,
  workflowStages,
  onCopyShareLink,
  onFileUpload,
  onPageNumberChange,
  onQueryChange,
  onStartVoiceInput,
  onSubmit,
}: QueryComposerProps) {
  const activeStage = workflowStages.find((stage) => stage.status === "active");
  const degradedStages = workflowStages.filter((stage) => stage.status === "degraded");

  return (
    <>
      <div className="flex items-center gap-4 flex-wrap">
        <label className="cursor-pointer bg-[#7f4c31] hover:bg-[#6b3f28] text-[#fff9f0] font-mono text-sm px-4 py-2 rounded-xl transition border border-[#7f4c31]">
          {isUploading ? "Uploading..." : uploadedFileName ? "Replace Document (PDF)" : "Upload Document (PDF)"}
          <input type="file" accept=".pdf" className="hidden" onChange={onFileUpload} disabled={isUploading || isProcessing} />
        </label>
        {uploadedFileName && <span className="text-[#6d5742] text-sm truncate max-w-[280px]">{uploadedFileName}</span>}
        {shareUrl && (
          <button
            type="button"
            className="bg-[#f8efe0] border border-[#c19a6b] text-[#5a3a26] px-3 py-2 rounded-lg text-xs font-mono"
            onClick={onCopyShareLink}
          >
            Copy Share Link
          </button>
        )}
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
          {activeStage ? (
            <span className="rounded-full border border-amber-700/40 bg-amber-100/70 px-3 py-1 text-amber-900">
              Active: {activeStage.label} · {activeStage.detail}
            </span>
          ) : (
            <span className="rounded-full border border-emerald-700/30 bg-emerald-100/70 px-3 py-1 text-emerald-800">
              System ready for the next step
            </span>
          )}
          {degradedStages.map((stage) => (
            <span key={stage.id} className="rounded-full border border-orange-700/30 bg-orange-100/70 px-3 py-1 text-orange-800">
              Degraded: {stage.label} · {stage.detail}
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Ask Savant to analyze the document..."
            className="flex-1 bg-[#fffdf8] border border-[#cfb999] rounded-xl px-4 py-2 font-mono text-sm text-[#261d17] focus:outline-none focus:border-[#8a6344]"
            disabled={!docId || isUploading || isProcessing}
          />
          <input
            type="number"
            min={1}
            value={pageNumber}
            onChange={(e) => onPageNumberChange(e.target.value)}
            placeholder="Page"
            className="w-24 bg-[#fffdf8] border border-[#cfb999] rounded-xl px-2 py-2 font-mono text-sm text-[#261d17] focus:outline-none focus:border-[#8a6344]"
            disabled={!docId || isUploading || isProcessing}
          />
          <button
            type="button"
            onClick={onStartVoiceInput}
            disabled={!docId || isUploading || isProcessing || !canUseSpeech}
            className="bg-[#f8efe0] text-[#5a3a26] px-3 py-2 rounded-xl border border-[#c19a6b] font-mono text-xs"
          >
            {isListening ? "Stop Mic" : "Voice"}
          </button>
          <button
            type="submit"
            disabled={!docId || isUploading || isProcessing || !query.trim()}
            className="bg-[#7f4c31] text-[#fff9f0] px-6 py-2 rounded-xl font-semibold text-sm hover:bg-[#6b3f28] disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {isProcessing ? "Processing..." : "Ask"}
          </button>
        </div>
        <div className="text-xs text-[#7f6751] font-mono">
          Direct query mode active. Upload, retrieval, synthesis, and audio state are surfaced above in real time.
        </div>
      </form>
    </>
  );
}
