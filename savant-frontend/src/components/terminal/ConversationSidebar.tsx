import type { ConversationRecord, GraphStatus } from "@/components/terminal/types";

type ConversationSidebarProps = {
  activeConversationId: string | null;
  conversations: ConversationRecord[];
  graphStatusByConversation?: Record<string, GraphStatus>;
  renameConversationId: string | null;
  renameDraft: string;
  searchTerm: string;
  onCreateConversation: () => void;
  onDeleteConversation: (conversationId: string) => void;
  onRenameConversation: (conversationId: string, title: string) => void;
  onRenameDraftChange: (value: string) => void;
  onRenameStart: (conversationId: string, title: string) => void;
  onRenameCancel: () => void;
  onSearchTermChange: (value: string) => void;
  onSelectConversation: (conversationId: string) => void;
};

function GraphStatusPill({ status }: { status: GraphStatus | undefined }) {
  if (status === "loading") {
    return <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-amber-500/40 bg-amber-400/10 text-amber-300">Building</span>;
  }
  if (status === "ready") {
    return <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-[#b58a2c]/50 bg-[#f2c14e]/10 text-[#f2c14e]">Ready</span>;
  }
  if (status === "error") {
    return <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-red-500/40 bg-red-400/10 text-red-300">Error</span>;
  }
  return null;
}

export function ConversationSidebar({
  activeConversationId,
  conversations,
  graphStatusByConversation,
  renameConversationId,
  renameDraft,
  searchTerm,
  onCreateConversation,
  onDeleteConversation,
  onRenameConversation,
  onRenameDraftChange,
  onRenameStart,
  onRenameCancel,
  onSearchTermChange,
  onSelectConversation,
}: ConversationSidebarProps) {
  return (
    <aside className="bg-[#0e1728]/45 backdrop-blur-md border border-[#7a5b1b]/70 rounded-xl p-3 flex flex-col min-h-[520px] min-h-0 shadow-[0_10px_28px_rgba(0,0,0,0.35)]">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[11px] font-mono uppercase tracking-[0.2em] text-[#c9a65c]">Conversations</div>
        <button
          type="button"
          onClick={onCreateConversation}
          className="text-xs font-mono px-2 py-1 rounded-lg border border-[#8d6a20] bg-[#111e35] text-[#c8d9f4] hover:text-white hover:border-[#4e74aa]"
        >
          + New
        </button>
      </div>

      <input
        value={searchTerm}
        onChange={(e) => onSearchTermChange(e.target.value)}
        placeholder="Search chats..."
        className="mb-3 w-full bg-[#110d07]/55 border border-[#7a5b1b]/70 rounded-lg px-2.5 py-2 text-xs text-[#f8e6bc] font-mono focus:outline-none focus:border-[#f2c14e]"
      />

      <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
        {conversations.map((conv) => (
          <div
            key={conv.id}
            className={`w-full text-left rounded border px-3 py-2 transition ${
              conv.id === activeConversationId
                ? "bg-[#1b150a]/60 border-[#c19435] text-[#f2f7ff]"
                : "bg-[#151008]/45 border-[#7a5b1b]/65 text-[#ddb974] hover:text-[#e7f0ff] hover:border-[#b58a2c]"
            }`}
          >
            {renameConversationId === conv.id ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={renameDraft}
                  onChange={(e) => onRenameDraftChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onRenameConversation(conv.id, renameDraft);
                    if (e.key === "Escape") onRenameCancel();
                  }}
                  className="flex-1 bg-[#110d07]/60 border border-[#8d6a20] rounded px-2 py-1 text-xs text-[#fbeece] font-mono"
                />
                <button
                  type="button"
                  onClick={() => onRenameConversation(conv.id, renameDraft)}
                  className="text-[10px] font-mono px-2 py-1 rounded border border-[#466896] text-[#e0ecff]"
                >
                  Save
                </button>
              </div>
            ) : (
              <>
                <button type="button" onClick={() => onSelectConversation(conv.id)} className="w-full text-left">
                  <div className="flex items-center gap-2">
                    <div className="text-xs font-medium truncate">{conv.title}</div>
                    <GraphStatusPill status={graphStatusByConversation?.[conv.id]} />
                  </div>
                  <div className="text-[10px] font-mono mt-1 text-[#7f95ba] truncate">
                    {conv.fileName ? conv.fileName : "No document"} · {new Date(conv.updatedAt).toLocaleString()}
                  </div>
                </button>
                <div className="flex items-center gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => onRenameStart(conv.id, conv.title)}
                    className="text-[10px] font-mono px-2 py-1 rounded border border-[#8d6a20] text-[#f2d18b] hover:text-white"
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteConversation(conv.id)}
                    className="text-[10px] font-mono px-2 py-1 rounded border border-red-600/60 text-red-300 hover:bg-red-500/10"
                  >
                    Delete
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
        {!conversations.length && <div className="text-[11px] font-mono text-[#7f95ba] p-2">No conversations found.</div>}
      </div>
    </aside>
  );
}
