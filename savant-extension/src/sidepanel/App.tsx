import { useCallback, useEffect, useMemo, useState } from "react";
import type { ContextTreePayload, ExtensionResponse } from "../shared/types";
import { CitationTreeGraph } from "./CitationTreeGraph";

function useTreeLoader() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<ContextTreePayload | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    chrome.runtime.sendMessage({ type: "FETCH_CONTEXT_TREE" }, (response: ExtensionResponse) => {
      if (chrome.runtime.lastError) {
        setError(chrome.runtime.lastError.message || "Side panel runtime error.");
        setLoading(false);
        return;
      }
      if (!response || !response.ok) {
        setError(response?.error || "Unable to load context graph.");
        setLoading(false);
        return;
      }
      setPayload(response.data);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { loading, error, payload, refresh };
}

export default function App() {
  const { loading, error, payload, refresh } = useTreeLoader();

  const stats = useMemo(() => {
    if (!payload) return null;
    const categories = new Set(payload.nodes.map((node) => node.category)).size;
    const concepts = payload.nodes.length;
    const links = payload.edges.length;
    return { concepts, links, categories };
  }, [payload]);

  return (
    <div className="shell">
      <div className="mesh" />
      <header className="top">
        <div>
          <div className="kicker">Savant Side Panel</div>
          <h1>Context Tree</h1>
          <p>Codex-style concept graph generated from paper context.</p>
        </div>
        <button onClick={refresh} disabled={loading}>
          {loading ? "Scanning..." : "Refresh"}
        </button>
      </header>

      {stats && (
        <section className="stats">
          <div className="chip">{stats.concepts} concepts</div>
          <div className="chip">{stats.links} links</div>
          <div className="chip">{stats.categories} categories</div>
        </section>
      )}

      <main className="panel">
        {!loading && error && <div className="error">{error}</div>}
        {!loading && !error && payload && (
          <>
            <div className="meta">
              <div className="title">{payload.title}</div>
              <a href={payload.sourceUrl} target="_blank" rel="noreferrer">
                Open source page
              </a>
            </div>
            <CitationTreeGraph nodes={payload.nodes} edges={payload.edges} paperText={payload.paperText} />
            {payload.useCases.length > 0 && (
              <section className="use-cases">
                <div className="use-cases-title">Paper Use Cases</div>
                <div className="use-cases-subtitle">Specific practical applications derived from this paper.</div>
                <div className="use-cases-list">
                  {payload.useCases.map((item, idx) => (
                    <article key={`${item.title}-${idx}`} className="use-case-item">
                      <h3>{item.title}</h3>
                      <p>{item.description}</p>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
        {loading && <div className="loading">Reading paper context and building concept tree...</div>}
      </main>
    </div>
  );
}
