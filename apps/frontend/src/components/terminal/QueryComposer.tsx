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
        <label className="cursor-pointer bg-[#2a1f0d]/65 hover:bg-[#3a2b10]/75 text-white font-mono text-sm px-4 py-2 rounded-lg transition border border-[#a67c1c]">
          {isUploading ? "Uploading..." : uploadedFileName ? "Replace Document (PDF)" : "Upload Document (PDF)"}
          <input type="file" accept=".pdf" className="hidden" onChange={onFileUpload} disabled={isUploading || isProcessing} />
        </label>
        {uploadedFileName && <span className="text-[#cfb06f] text-sm truncate max-w-[280px]">{uploadedFileName}</span>}
        {shareUrl && (
          <button
            type="button"
            className="bg-[#171109]/60 border border-[#a67c1c] text-[#f8e6bc] px-3 py-2 rounded-lg text-xs font-mono backdrop-blur-sm"
            onClick={onCopyShareLink}
          >
            Copy Share Link
          </button>
        )}
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
          {activeStage ? (
            <span className="rounded-full border border-amber-500/50 bg-amber-400/10 px-3 py-1 text-amber-200">
              Active: {activeStage.label} - {activeStage.detail}
            </span>
          ) : (
            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-emerald-200">
              System ready for the next step
            </span>
          )}
          {degradedStages.map((stage) => (
            <span key={stage.id} className="rounded-full border border-orange-500/40 bg-orange-500/10 px-3 py-1 text-orange-200">
              Degraded: {stage.label} - {stage.detail}
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Ask Savant to analyze the document..."
            className="flex-1 bg-[#171109]/58 border border-[#7a5b1b]/70 rounded-lg px-4 py-2 font-mono text-sm text-white focus:outline-none focus:border-[#f2c14e] backdrop-blur-sm"
            disabled={!docId || isUploading || isProcessing}
          />
          <input
            type="number"
            min={1}
            value={pageNumber}
            onChange={(e) => onPageNumberChange(e.target.value)}
            placeholder="Page"
            className="w-24 bg-[#171109]/58 border border-[#7a5b1b]/70 rounded-lg px-2 py-2 font-mono text-sm text-white focus:outline-none focus:border-[#f2c14e] backdrop-blur-sm"
            disabled={!docId || isUploading || isProcessing}
          />
          <button
            type="button"
            onClick={onStartVoiceInput}
            disabled={!docId || isUploading || isProcessing || !canUseSpeech}
            className="bg-[#171109]/60 text-[#f8e6bc] px-3 py-2 rounded-lg border border-[#a67c1c] font-mono text-xs backdrop-blur-sm"
          >
            {isListening ? "Stop Mic" : "Voice"}
          </button>
          <button
            type="submit"
            disabled={!docId || isUploading || isProcessing || !query.trim()}
            className="bg-[#f2c14e] text-[#1a1205] px-6 py-2 rounded-lg font-semibold text-sm hover:bg-[#f2c14e] disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {isProcessing ? "Processing..." : "Ask"}
          </button>
        </div>
        <div className="text-xs text-[#b99953] font-mono">
          Direct query mode active. Upload, retrieval, synthesis, and audio state are surfaced above in real time.
        </div>
      </form>
    </>
  );
}
