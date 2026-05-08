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
    <div className="rounded-2xl border border-[#cfb999] bg-[#fffaf2]/80 p-3 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-[#8a6344]">Question Suggestions</div>
          <div className="mt-1 text-xs text-[#6e5a47]">
            {docId ? "Click a prompt to ask about the current paper instantly." : "Upload a paper to unlock paper-aware suggested prompts."}
          </div>
        </div>
        <div className="text-[10px] font-mono text-[#8f7456]">{docId ? "Paper-aware" : "Starter"}</div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {suggestedQuestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => void applySuggestedQuestion(suggestion)}
            disabled={isUploading || isProcessing}
            className="rounded-full border border-[#cfb999] bg-[#fffdf8] px-3 py-2 text-left text-xs font-mono text-[#5f4734] transition hover:border-[#8a6344] hover:text-[#2c2119] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}
