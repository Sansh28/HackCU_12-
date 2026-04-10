type SuggestionsPanelProps = {
  docId: string | null;
  isProcessing: boolean;
  isUploading: boolean;
  suggestedQuestions: string[];
  applySuggestedQuestion: (suggestion: string) => Promise<void>;
};

export function SuggestionsPanel({
  applySuggestedQuestion,
  docId,
  isProcessing,
  isUploading,
  suggestedQuestions,
}: SuggestionsPanelProps) {
  return (
    <div className="rounded-xl border border-[#7a5b1b]/70 bg-[#171109]/45 p-3 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-[#c8a55b]">Question Suggestions</div>
          <div className="mt-1 text-xs text-[#d9c087]">
            {docId ? "Click a prompt to ask about the current paper instantly." : "Upload a paper to unlock paper-aware suggested prompts."}
          </div>
        </div>
        <div className="text-[10px] font-mono text-[#8ea3c7]">{docId ? "Paper-aware" : "Starter"}</div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {suggestedQuestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => void applySuggestedQuestion(suggestion)}
            disabled={isUploading || isProcessing}
            className="rounded-full border border-[#8d6a20] bg-[#111922]/80 px-3 py-2 text-left text-xs font-mono text-[#f2e1b7] transition hover:border-[#f2c14e] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}
