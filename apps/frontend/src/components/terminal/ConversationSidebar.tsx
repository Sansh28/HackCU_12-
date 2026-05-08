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
    return <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-amber-700/40 bg-amber-100/70 text-amber-800">Building</span>;
  }
  if (status === "ready") {
    return <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-[#b78d60] bg-[#f3e2c9] text-[#6f462f]">Ready</span>;
  }
  if (status === "error") {
    return <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-red-500/40 bg-red-100/80 text-red-700">Error</span>;
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
    <aside className="bg-[#fffaf1]/70 backdrop-blur-md border border-[#cfb999] rounded-2xl p-3 flex flex-col min-h-[520px] min-h-0 shadow-[0_10px_28px_rgba(66,46,20,0.12)]">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[11px] font-mono uppercase tracking-[0.2em] text-[#8a6344]">Conversations</div>
        <button
          type="button"
          onClick={onCreateConversation}
          className="text-xs font-mono px-2 py-1 rounded-lg border border-[#c19a6b] bg-[#f5e8d5] text-[#5a3a26] hover:text-[#2f2017] hover:border-[#8a6344]"
        >
          + New
        </button>
      </div>

      <input
        value={searchTerm}
        onChange={(e) => onSearchTermChange(e.target.value)}
        placeholder="Search chats..."
        className="mb-3 w-full bg-[#fffdf8] border border-[#cfb999] rounded-lg px-2.5 py-2 text-xs text-[#4a392c] font-mono focus:outline-none focus:border-[#8a6344]"
      />

      <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
        {conversations.map((conv) => (
          <div
            key={conv.id}
            className={`w-full text-left rounded border px-3 py-2 transition ${
              conv.id === activeConversationId
                ? "bg-[#f7ecdc] border-[#b78d60] text-[#241a15]"
                : "bg-[#fffdf8] border-[#d5c1a0] text-[#7a6148] hover:text-[#33261e] hover:border-[#b78d60]"
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
                  className="flex-1 bg-[#fffcf6] border border-[#c19a6b] rounded px-2 py-1 text-xs text-[#3f2f25] font-mono"
                />
                <button
                  type="button"
                  onClick={() => onRenameConversation(conv.id, renameDraft)}
                  className="text-[10px] font-mono px-2 py-1 rounded border border-[#9e7f61] text-[#4e3928]"
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
                  <div className="text-[10px] font-mono mt-1 text-[#896d51] truncate">
                    {conv.fileName ? conv.fileName : "No document"} · {new Date(conv.updatedAt).toLocaleString()}
                  </div>
                </button>
                <div className="flex items-center gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => onRenameStart(conv.id, conv.title)}
                    className="text-[10px] font-mono px-2 py-1 rounded border border-[#c19a6b] text-[#6d4f36] hover:text-[#2f231c]"
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteConversation(conv.id)}
                    className="text-[10px] font-mono px-2 py-1 rounded border border-red-600/60 text-red-600 hover:bg-red-500/10"
                  >
                    Delete
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
        {!conversations.length && <div className="text-[11px] font-mono text-[#896d51] p-2">No conversations found.</div>}
      </div>
    </aside>
  );
}

