import { useMemo, useState } from "react";
import type { ContextEdge, ContextNode, GraphCategory } from "../shared/types";

type Props = {
  nodes: ContextNode[];
  edges: ContextEdge[];
  paperText: string;
};

type PositionedNode = ContextNode & {
  x: number;
  y: number;
  depth: number;
};

const CATEGORY_STYLE: Record<GraphCategory, { fill: string; stroke: string; text: string; glow: string }> = {
  foundation: { fill: "rgba(99,102,241,0.2)", stroke: "#818cf8", text: "#e0e7ff", glow: "rgba(129,140,248,0.35)" },
  method: { fill: "rgba(6,182,212,0.2)", stroke: "#22d3ee", text: "#d2f8ff", glow: "rgba(34,211,238,0.35)" },
  result: { fill: "rgba(16,185,129,0.2)", stroke: "#34d399", text: "#d1fae5", glow: "rgba(52,211,153,0.35)" },
  component: { fill: "rgba(245,158,11,0.2)", stroke: "#fbbf24", text: "#fef3c7", glow: "rgba(251,191,36,0.35)" },
  concept: { fill: "rgba(236,72,153,0.2)", stroke: "#f472b6", text: "#fce7f3", glow: "rgba(244,114,182,0.35)" },
};

function computeDepths(nodes: ContextNode[], edges: ContextEdge[]): Map<string, number> {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const outgoing = new Map<string, string[]>();
  const incomingCount = new Map<string, number>();

  nodes.forEach((node) => {
    outgoing.set(node.id, []);
    incomingCount.set(node.id, 0);
  });

  edges.forEach((edge) => {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) return;
    outgoing.get(edge.source)!.push(edge.target);
    incomingCount.set(edge.target, (incomingCount.get(edge.target) || 0) + 1);
  });

  const root =
    nodes.find((node) => node.importance === 5 && (incomingCount.get(node.id) || 0) === 0) ||
    nodes.find((node) => (incomingCount.get(node.id) || 0) === 0) ||
    [...nodes].sort((a, b) => b.importance - a.importance)[0];

  const depth = new Map<string, number>();
  const queue: string[] = [];
  if (root) {
    depth.set(root.id, 0);
    queue.push(root.id);
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentDepth = depth.get(current) || 0;
    const targets = outgoing.get(current) || [];
    targets.forEach((target) => {
      const nextDepth = currentDepth + 1;
      const existing = depth.get(target);
      if (existing === undefined || nextDepth < existing) {
        depth.set(target, nextDepth);
        queue.push(target);
      }
    });
  }

  const maxDepth = depth.size ? Math.max(...depth.values()) : 0;
  nodes.forEach((node, idx) => {
    if (!depth.has(node.id)) {
      depth.set(node.id, maxDepth + 1 + idx);
    }
  });

  return depth;
}

function layoutNodes(nodes: ContextNode[], edges: ContextEdge[], width: number, height: number): PositionedNode[] {
  const depthMap = computeDepths(nodes, edges);
  const byDepth = new Map<number, ContextNode[]>();
  nodes.forEach((node) => {
    const depth = depthMap.get(node.id) || 0;
    const layer = byDepth.get(depth) || [];
    layer.push(node);
    byDepth.set(depth, layer);
  });

  const maxDepth = Math.max(...Array.from(byDepth.keys()));
  // Force a vertical DAG: depth controls Y, peers spread on X.
  const startY = 44;
  const endY = height - 40;
  const layerHeight = Math.max(80, (endY - startY) / Math.max(1, maxDepth || 1));
  const left = 30;
  const right = 30;
  const usableW = Math.max(200, width - left - right);

  const positioned: PositionedNode[] = [];
  Array.from(byDepth.entries())
    .sort((a, b) => a[0] - b[0])
    .forEach(([depth, layer]) => {
      const y = startY + depth * layerHeight;
      const gap = usableW / (layer.length + 1);
      layer
        .slice()
        .sort((a, b) => b.importance - a.importance)
        .forEach((node, idx) => {
          positioned.push({
            ...node,
            depth,
            x: left + gap * (idx + 1),
            y,
          });
        });
    });

  return positioned;
}

function truncate(value: string, len = 26): string {
  return value.length > len ? `${value.slice(0, len - 1)}…` : value;
}

function splitLabel(value: string): [string, string?] {
  const text = truncate(value, 40);
  if (text.length <= 18) return [text];
  const words = text.split(/\s+/);
  if (words.length <= 1) return [text];

  let line1 = "";
  let line2 = "";
  for (const word of words) {
    if ((line1 + " " + word).trim().length <= 18) {
      line1 = (line1 + " " + word).trim();
    } else {
      line2 = (line2 + " " + word).trim();
    }
  }
  return [line1 || text, line2 || undefined];
}

function maxNodesPerDepth(nodes: ContextNode[], edges: ContextEdge[]): number {
  const depthMap = computeDepths(nodes, edges);
  const counts = new Map<number, number>();
  nodes.forEach((node) => {
    const depth = depthMap.get(node.id) || 0;
    counts.set(depth, (counts.get(depth) || 0) + 1);
  });
  return counts.size ? Math.max(...counts.values()) : 1;
}

export function CitationTreeGraph({ nodes, edges, paperText }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [chatByNode, setChatByNode] = useState<Record<string, Array<{ role: "user" | "assistant"; content: string }>>>({});
  const densestLayer = useMemo(() => maxNodesPerDepth(nodes, edges), [nodes, edges]);
  const width = Math.max(980, densestLayer * 170 + 120);
  const height = 860;
  const positioned = useMemo(() => layoutNodes(nodes, edges, width, height), [edges, nodes]);
  const byId = useMemo(() => new Map(positioned.map((node) => [node.id, node])), [positioned]);
  const selected = selectedId ? byId.get(selectedId) || null : null;
  const activeChat = selected ? chatByNode[selected.id] || [] : [];
  const highlightState = useMemo(() => {
    if (!selectedId) {
      return { nodeIds: new Set<string>(), edgeKeys: new Set<string>() };
    }

    const outgoing = new Map<string, Array<{ target: string; key: string }>>();
    const incoming = new Map<string, Array<{ source: string; key: string }>>();
    edges.forEach((edge, idx) => {
      const key = `${edge.source}->${edge.target}#${idx}`;
      const out = outgoing.get(edge.source) || [];
      out.push({ target: edge.target, key });
      outgoing.set(edge.source, out);

      const inc = incoming.get(edge.target) || [];
      inc.push({ source: edge.source, key });
      incoming.set(edge.target, inc);
    });

    const nodeIds = new Set<string>([selectedId]);
    const edgeKeys = new Set<string>();

    // Traverse ancestors to highlight path from root(s) to selected.
    const upQueue: string[] = [selectedId];
    const seenUp = new Set<string>([selectedId]);
    while (upQueue.length > 0) {
      const current = upQueue.shift()!;
      const inc = incoming.get(current) || [];
      inc.forEach(({ source, key }) => {
        edgeKeys.add(key);
        nodeIds.add(source);
        if (!seenUp.has(source)) {
          seenUp.add(source);
          upQueue.push(source);
        }
      });
    }

    // Traverse descendants to highlight selected branch downward.
    const downQueue: string[] = [selectedId];
    const seenDown = new Set<string>([selectedId]);
    while (downQueue.length > 0) {
      const current = downQueue.shift()!;
      const out = outgoing.get(current) || [];
      out.forEach(({ target, key }) => {
        edgeKeys.add(key);
        nodeIds.add(target);
        if (!seenDown.has(target)) {
          seenDown.add(target);
          downQueue.push(target);
        }
      });
    }

    return { nodeIds, edgeKeys };
  }, [edges, selectedId]);

  const contextSnippet = useMemo(() => {
    if (!selected || !paperText) return "";
    const lines = paperText.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    const query = selected.label.toLowerCase();
    const hit = lines.find((line) => line.toLowerCase().includes(query) && line.length > 50);
    if (hit) return hit.slice(0, 320);
    const sentenceHit = paperText
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .find((sentence) => sentence.toLowerCase().includes(query) && sentence.length > 50);
    return (sentenceHit || "").slice(0, 320);
  }, [paperText, selected]);

  const askConcept = async () => {
    if (!selected || !question.trim() || asking) return;
    const ask = question.trim();
    setQuestion("");
    setAsking(true);

    const currentHistory = activeChat.slice(-8);
    setChatByNode((prev) => ({
      ...prev,
      [selected.id]: [...(prev[selected.id] || []), { role: "user", content: ask }],
    }));

    try {
      const res = await fetch("http://127.0.0.1:8000/graph/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          concept: selected.label,
          question: ask,
          paper_context: paperText,
          history: currentHistory.map((message) => ({ role: message.role, content: message.content })),
          node_id: selected.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || "Unable to answer this concept question.");
      setChatByNode((prev) => ({
        ...prev,
        [selected.id]: [...(prev[selected.id] || []), { role: "assistant", content: String(data.answer || "") }],
      }));
    } catch (error) {
      setChatByNode((prev) => ({
        ...prev,
        [selected.id]: [
          ...(prev[selected.id] || []),
          {
            role: "assistant",
            content: `I could not answer right now: ${error instanceof Error ? error.message : "Request failed"}`,
          },
        ],
      }));
    } finally {
      setAsking(false);
    }
  };

  return (
    <div className="graph-wrap">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Paper context tree graph"
        style={{ width: `${width}px`, height: `${height}px` }}
      >
        <defs>
          <linearGradient id="edgeGradContext" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="rgba(148,163,184,0.22)" />
            <stop offset="100%" stopColor="rgba(148,163,184,0.52)" />
          </linearGradient>
          <marker id="arrowContext" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill="rgba(148,163,184,0.6)" />
          </marker>
        </defs>

        {edges.map((edge, idx) => {
          const source = byId.get(edge.source);
          const target = byId.get(edge.target);
          if (!source || !target) return null;

          // Keep links visually flowing downward from source -> target.
          const sourceRadius = Math.max(4, 3 + source.importance);
          const targetRadius = Math.max(4, 3 + target.importance);
          const dy = Math.max(24, target.y - source.y);
          const cpY = source.y + dy * 0.45;
          const path = `M ${source.x} ${source.y + sourceRadius} C ${source.x} ${cpY}, ${target.x} ${cpY}, ${target.x} ${target.y - targetRadius}`;
          const edgeKey = `${edge.source}->${edge.target}#${idx}`;
          const highlight = highlightState.edgeKeys.has(edgeKey);
          return (
            <g key={`${edge.source}-${edge.target}-${idx}`}>
              <path
                d={path}
                stroke={highlight ? "rgba(148,220,255,0.8)" : "url(#edgeGradContext)"}
                strokeWidth={highlight ? 1.8 : 1.2}
                fill="none"
                markerEnd="url(#arrowContext)"
              />
            </g>
          );
        })}

        {positioned.map((node) => {
          const style = CATEGORY_STYLE[node.category];
          const selectedNode = selectedId === node.id;
          const branchNode = highlightState.nodeIds.has(node.id);
          const radius = Math.max(4, 3 + node.importance);
          const [line1, line2] = splitLabel(node.label);
          return (
            <g key={node.id} onClick={() => setSelectedId(node.id)} style={{ cursor: "pointer" }}>
              <circle cx={node.x} cy={node.y} r={radius + 5} fill="transparent" />
              <circle
                cx={node.x}
                cy={node.y}
                r={radius}
                fill={style.fill}
                stroke={selectedNode ? "#ffffff" : branchNode ? "rgba(148,220,255,0.95)" : style.stroke}
                strokeWidth={selectedNode ? 2.2 : branchNode ? 1.8 : 1.2}
                style={{ filter: `drop-shadow(0 0 8px ${style.glow})` }}
              />
              <text
                x={node.x}
                y={node.y + radius + 14}
                fill={style.text}
                fontSize={10}
                textAnchor="middle"
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              >
                <tspan x={node.x} dy="0">
                  {line1}
                </tspan>
                {line2 && (
                  <tspan x={node.x} dy="12">
                    {line2}
                  </tspan>
                )}
              </text>
            </g>
          );
        })}
      </svg>

      {selected && (
        <div className="node-detail">
          <div className="node-detail-title">{selected.label}</div>
          <div className="node-detail-cat">{selected.category.toUpperCase()}</div>
          <p>{selected.summary || "No summary available for this concept."}</p>
          {contextSnippet && (
            <div className="node-snippet">
              <span>Paper mention:</span> {contextSnippet}
            </div>
          )}

          <div className="node-chat">
            <div className="node-chat-title">Ask about this concept</div>
            <div className="node-chat-log">
              {activeChat.length === 0 ? (
                <div className="node-chat-empty">No questions yet. Ask for clarification, examples, or intuition.</div>
              ) : (
                activeChat.map((message, idx) => (
                  <div key={`${message.role}-${idx}`} className={`node-chat-msg ${message.role}`}>
                    <span>{message.role === "user" ? "You" : "Savant"}:</span> {message.content}
                  </div>
                ))
              )}
            </div>
            <div className="node-chat-input-row">
              <input
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void askConcept();
                  }
                }}
                placeholder={`Ask your doubt about ${selected.label}...`}
              />
              <button type="button" onClick={() => void askConcept()} disabled={asking || !question.trim()}>
                {asking ? "..." : "Ask"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
