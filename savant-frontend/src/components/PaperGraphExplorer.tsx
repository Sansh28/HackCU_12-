"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import * as d3 from "d3";

type GraphNode = {
  id: string;
  label: string;
  summary: string;
  category: "foundation" | "method" | "result" | "component" | "concept";
  importance: number;
  children?: GraphNode[] | null;
};

type GraphEdge = {
  source: string | { id: string };
  target: string | { id: string };
  label: string;
};

type GraphData = {
  title: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
};

type QAItem = { question: string; answer: string };

type PaperGraphExplorerProps = {
  embedded?: boolean;
  autoDocId?: string | null;
  prefetchedGraph?: { graphData: GraphData; paperText: string } | null;
  backgroundStatus?: "idle" | "loading" | "ready" | "error";
  backgroundError?: string | null;
};

const SAMPLE_PAPER = `Abstract: Attention mechanisms have become an integral part of compelling sequence modeling and transduction models in various tasks, allowing modeling of dependencies without regard to their distance in the input or output sequences. We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely. Experiments on two machine translation tasks show these models to be superior in quality while being more parallelizable and requiring significantly less time to train.

The dominant sequence transduction models are based on complex recurrent or convolutional neural networks that include an encoder and a decoder. The best performing models also connect the encoder and decoder through an attention mechanism. We propose a model architecture eschewing recurrence and instead relying entirely on an attention mechanism to draw global dependencies between input and output.

Multi-Head Attention: Instead of performing a single attention function with dkeys-dimensional keys, values and dquery-dimensional queries, we found it beneficial to linearly project the queries, keys and values h times with different, learned linear projections.

Positional Encoding: Since our model contains no recurrence and no convolution, in order for the model to make use of the order of the sequence, we must inject some information about the relative or absolute position of the tokens in the sequence.`;
const LOADING_STEPS = [
  "Reading paper structure…",
  "Extracting key concepts…",
  "Mapping relationships…",
  "Building your graph…",
];

const categoryColors = {
  foundation: { node: "#6366f1", glow: "#818cf8", text: "#e0e7ff", bg: "rgba(99,102,241,0.15)" },
  method: { node: "#06b6d4", glow: "#22d3ee", text: "#cffafe", bg: "rgba(6,182,212,0.15)" },
  result: { node: "#10b981", glow: "#34d399", text: "#d1fae5", bg: "rgba(16,185,129,0.15)" },
  component: { node: "#f59e0b", glow: "#fbbf24", text: "#fef3c7", bg: "rgba(245,158,11,0.15)" },
  concept: { node: "#ec4899", glow: "#f472b6", text: "#fce7f3", bg: "rgba(236,72,153,0.15)" },
};

function GraphCanvas({ graphData, selectedId, onSelectNode }: {
  graphData: GraphData;
  selectedId: string | null;
  onSelectNode: (node: GraphNode | null) => void;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const rootLayoutRef = useRef<d3.HierarchyPointNode<GraphNode> | null>(null);

  useEffect(() => {
    if (!graphData || !svgRef.current) return;
    const el = svgRef.current;
    const W = el.clientWidth || 900;
    const H = el.clientHeight || 620;

    d3.select(el).selectAll("*").remove();

    const svg = d3.select(el)
      .attr("viewBox", `0 0 ${W} ${H}`)
      .style("background", "transparent");

    const defs = svg.append("defs");

    (Object.entries(categoryColors) as Array<[keyof typeof categoryColors, (typeof categoryColors)[keyof typeof categoryColors]]>).forEach(([cat]) => {
      const f = defs.append("filter").attr("id", `glow-${cat}`).attr("x", "-50%").attr("y", "-50%").attr("width", "200%").attr("height", "200%");
      f.append("feGaussianBlur").attr("stdDeviation", "6").attr("result", "blur");
      const merge = f.append("feMerge");
      merge.append("feMergeNode").attr("in", "blur");
      merge.append("feMergeNode").attr("in", "SourceGraphic");
    });

    const g = svg.append("g").attr("class", "graph-container");

    const zoom = d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.2, 3]).on("zoom", (e) => g.attr("transform", String(e.transform)));
    svg.call(zoom);
    zoomRef.current = zoom;

    const nodesData = graphData.nodes;
    const edgesData = graphData.edges;
    const rootNodeObj = nodesData.find((n) => n.importance === 5) || nodesData[0];
    const visited = new Set<string>();

    const buildNode = (nId: string): GraphNode | null => {
      if (visited.has(nId)) return null;
      visited.add(nId);

      const nodeObj = nodesData.find((n) => n.id === nId);
      if (!nodeObj) return null;

      const outEdges = edgesData.filter((e) => {
        const source = typeof e.source === "string" ? e.source : e.source.id;
        return source === nId;
      });
      const children = outEdges
        .map((e) => {
          const target = typeof e.target === "string" ? e.target : e.target.id;
          return buildNode(target);
        })
        .filter((x): x is GraphNode => Boolean(x));

      return { ...nodeObj, children: children.length > 0 ? children : null };
    };

    const treeData = buildNode(rootNodeObj.id) || rootNodeObj;

    nodesData.forEach((n) => {
      if (!visited.has(n.id)) {
        const orphan = buildNode(n.id);
        if (orphan) {
          if (!treeData.children) treeData.children = [];
          treeData.children.push(orphan);
        }
      }
    });

    const verticalSpacing = 90;
    const horizontalSpacing = 280;
    const treeLayout = d3.tree<GraphNode>().nodeSize([verticalSpacing, horizontalSpacing]);
    const root = treeLayout(d3.hierarchy(treeData));

    rootLayoutRef.current = root;

    const linkPath = d3
      .linkHorizontal<d3.HierarchyPointLink<GraphNode>, d3.HierarchyPointNode<GraphNode>>()
      .x((d) => d.y)
      .y((d) => d.x);

    g.append("g")
      .selectAll("path.edge-path")
      .data(root.links())
      .join("path")
      .attr("class", "edge-path")
      .attr("d", linkPath)
      .attr("fill", "none")
      .attr("stroke", "rgba(148,163,184,0.3)")
      .attr("stroke-width", 1.5)
      .style("transition", "all 0.3s ease");

    g.append("g")
      .selectAll("text.edge-label")
      .data(root.links())
      .join("text")
      .attr("class", "edge-label")
      .attr("x", (d) => (d.source.y + d.target.y) / 2)
      .attr("y", (d) => (d.source.x + d.target.x) / 2)
      .attr("dy", "-4")
      .attr("text-anchor", "middle")
      .attr("font-size", "9px")
      .attr("fill", "rgba(148,163,184,0.6)")
      .attr("font-family", "'DM Mono', monospace")
      .style("transition", "fill 0.3s ease")
      .text((d) => {
        const edge = edgesData.find((e) => {
          const s = typeof e.source === "string" ? e.source : e.source.id;
          const t = typeof e.target === "string" ? e.target : e.target.id;
          return s === d.source.data.id && t === d.target.data.id;
        });
        return edge ? edge.label : "";
      });

    const node = g
      .append("g")
      .selectAll("g")
      .data(root.descendants())
      .join("g")
      .attr("class", "node-group")
      .attr("transform", (d) => `translate(${d.y},${d.x})`)
      .attr("cursor", "pointer")
      .on("click", (e, d) => {
        e.stopPropagation();
        onSelectNode(d.data);
      });

    node
      .append("circle")
      .attr("class", "node-circle")
      .attr("r", (d) => 20 + (d.data.importance || 3) * 2)
      .attr("fill", (d) => `${categoryColors[d.data.category]?.node || "#6366f1"}1a`)
      .attr("stroke", (d) => categoryColors[d.data.category]?.node || "#6366f1")
      .attr("stroke-width", (d) => (d.data.importance === 5 ? 3 : 1.5))
      .attr("filter", (d) => `url(#glow-${d.data.category})`)
      .style("transition", "all 0.3s ease");

    node
      .append("circle")
      .attr("r", (d) => 4 + (d.data.importance || 3))
      .attr("fill", (d) => categoryColors[d.data.category]?.node || "#6366f1")
      .attr("opacity", 0.9);

    node
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dy", (d) => 26 + (d.data.importance || 3) * 2 + 12)
      .attr("font-size", (d) => (d.data.importance === 5 ? "13px" : "11px"))
      .attr("font-family", "'DM Sans', sans-serif")
      .attr("font-weight", (d) => (d.data.importance === 5 ? "700" : "500"))
      .attr("fill", (d) => categoryColors[d.data.category]?.text || "#e0e7ff")
      .attr("pointer-events", "none")
      .each(function (d) {
        const words = d.data.label.split(" ");
        const textEl = d3.select(this);
        if (words.length <= 2) {
          textEl.text(d.data.label);
        } else {
          textEl.text(words.slice(0, 2).join(" "));
          textEl.append("tspan").attr("x", 0).attr("dy", "1.2em").text(words.slice(2).join(" "));
        }
      });

    svg.on("click", () => onSelectNode(null));

    const initialScale = 0.85;
    const initialTransform = d3.zoomIdentity.translate(80, H / 2).scale(initialScale);
    svg.call(zoom.transform, initialTransform);
  }, [graphData, onSelectNode]);

  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    const el = svgRef.current;
    const W = el.clientWidth || 900;
    const H = el.clientHeight || 620;

    svg
      .selectAll<SVGCircleElement, d3.HierarchyPointNode<GraphNode>>(".node-circle")
      .attr("stroke-width", (d) => (!d ? 1.5 : d.data.id === selectedId ? 3 : d.data.importance === 5 ? 2.5 : 1.5))
      .attr("stroke-opacity", (d) => (!d ? 1 : d.data.id === selectedId ? 1 : selectedId ? 0.3 : 1));

    svg
      .selectAll<SVGPathElement, d3.HierarchyPointLink<GraphNode>>(".edge-path")
      .attr("stroke", (d) => {
        if (!selectedId) return "rgba(148,163,184,0.3)";
        const isConnected = d.source.data.id === selectedId || d.target.data.id === selectedId;
        return isConnected ? categoryColors[d.source.data.category]?.node || "#6366f1" : "rgba(148,163,184,0.08)";
      })
      .attr("stroke-width", (d) => (!selectedId ? 1.5 : d.source.data.id === selectedId || d.target.data.id === selectedId ? 2.5 : 1));

    svg
      .selectAll<SVGTextElement, d3.HierarchyPointLink<GraphNode>>(".edge-label")
      .attr("fill", (d) => {
        if (!selectedId) return "rgba(148,163,184,0.6)";
        return d.source.data.id === selectedId || d.target.data.id === selectedId ? "#e2e8f0" : "rgba(148,163,184,0.15)";
      });

    if (zoomRef.current && rootLayoutRef.current) {
      if (selectedId) {
        const selectedNode = rootLayoutRef.current.descendants().find((n) => n.data.id === selectedId);
        if (selectedNode) {
          const scale = 1.3;
          const targetX = selectedNode.y;
          const targetY = selectedNode.x;
          const visibleCenterX = (W - 380) / 2;
          const visibleCenterY = H / 2;

          const newTransform = d3.zoomIdentity
            .translate(visibleCenterX - targetX * scale, visibleCenterY - targetY * scale)
            .scale(scale);

          svg.transition().duration(800).ease(d3.easeCubicOut).call(zoomRef.current.transform, newTransform);
        }
      } else {
        const defaultScale = 0.85;
        const newTransform = d3.zoomIdentity.translate(80, H / 2).scale(defaultScale);
        svg.transition().duration(800).ease(d3.easeCubicOut).call(zoomRef.current.transform, newTransform);
      }
    }
  }, [selectedId]);

  return <svg ref={svgRef} style={{ width: "100%", height: "100%" }} />;
}

function ConceptCard({
  node,
  paperText,
  onClose,
  apiBase,
}: {
  node: GraphNode;
  paperText: string;
  onClose: () => void;
  apiBase: string;
}) {
  const [qaList, setQaList] = useState<QAItem[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const colors = categoryColors[node.category] || categoryColors.concept;

  const handleAsk = async () => {
    if (!question.trim() || loading) return;
    const q = question.trim();
    setQuestion("");
    setLoading(true);

    try {
      const history = qaList.map((qa) => ({ question: qa.question, answer: qa.answer }));
      const res = await fetch(`${apiBase}/graph/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          concept: node.label,
          question: q,
          paper_context: paperText,
          history,
          node_id: node.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to get answer");
      setQaList((prev) => [...prev, { question: q, answer: data.answer }]);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to get answer";
      setQaList((prev) => [...prev, { question: q, answer: `Failed to get answer: ${message}` }]);
    }
    setLoading(false);
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [qaList, loading]);

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        width: "380px",
        maxWidth: "92vw",
        height: "100%",
        background: "rgba(12,9,5,0.98)",
        borderLeft: `1px solid ${colors.node}40`,
        display: "flex",
        flexDirection: "column",
        backdropFilter: "blur(20px)",
        animation: "slideIn 0.25s cubic-bezier(0.16,1,0.3,1)",
        zIndex: 20,
      }}
    >
      <style>{`
        @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes fadeUp { from { transform: translateY(8px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        .qa-item { animation: fadeUp 0.3s ease; }
        .ask-btn:hover { opacity: 1 !important; transform: scale(1.02); }
        .close-btn:hover { background: rgba(255,255,255,0.08) !important; }
        .ask-input:focus { outline: none; border-color: ${colors.node}aa !important; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
      `}</style>

      <div style={{ padding: "20px 20px 16px", borderBottom: `1px solid ${colors.node}25` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              background: colors.bg,
              border: `1px solid ${colors.node}40`,
              borderRadius: "20px",
              padding: "3px 10px",
              marginBottom: "10px",
            }}
          >
            <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: colors.node }} />
            <span
              style={{
                fontSize: "10px",
                color: colors.text,
                fontFamily: "'DM Mono', monospace",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              {node.category}
            </span>
          </div>
          <button
            className="close-btn"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
            color: "rgba(148,163,184,0.7)",
              cursor: "pointer",
              padding: "4px 8px",
              borderRadius: "6px",
              fontSize: "18px",
              lineHeight: 1,
              transition: "background 0.15s",
            }}
          >
            ×
          </button>
        </div>
        <h2
          style={{
            margin: 0,
            fontSize: "20px",
            fontWeight: "700",
            fontFamily: "'DM Sans', sans-serif",
            color: "#f1f5f9",
            lineHeight: 1.2,
            background: `linear-gradient(135deg, #f1f5f9, ${colors.glow})`,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          {node.label}
        </h2>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
        <div
          style={{
            background: "rgba(255,228,170,0.03)",
            border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: "12px",
            padding: "16px",
            marginBottom: "20px",
          }}
        >
          <div
            style={{
              fontSize: "10px",
              color: "rgba(201,166,92,0.72)",
              fontFamily: "'DM Mono', monospace",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              marginBottom: "8px",
            }}
          >
            CONCEPT SUMMARY
          </div>
          <p
            style={{
              margin: 0,
              fontSize: "13.5px",
              color: "rgba(248,230,188,0.9)",
              lineHeight: 1.7,
              fontFamily: "'DM Sans', sans-serif",
            }}
          >
            {node.summary}
          </p>
        </div>

        {qaList.map((qa, i) => (
          <div key={i} className="qa-item" style={{ marginBottom: "16px" }}>
            <div style={{ display: "flex", gap: "10px", marginBottom: "8px" }}>
              <div
                style={{
                  width: "22px",
                  height: "22px",
                  borderRadius: "50%",
                  flexShrink: 0,
                  background: `linear-gradient(135deg, ${colors.node}, ${colors.glow})`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "10px",
                  color: "#0a0b12",
                  fontWeight: "700",
                  fontFamily: "'DM Mono', monospace",
                }}
              >
                Q
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: "13px",
                  color: "#cbd5e1",
                  fontWeight: "500",
                  lineHeight: 1.5,
                  fontFamily: "'DM Sans', sans-serif",
                  paddingTop: "2px",
                }}
              >
                {qa.question}
              </p>
            </div>
            <div
              style={{
                marginLeft: "32px",
                background: "rgba(255,255,255,0.025)",
                borderLeft: `2px solid ${colors.node}50`,
                borderRadius: "0 8px 8px 0",
                padding: "10px 14px",
              }}
            >
              <p
                style={{
                  margin: 0,
                  fontSize: "13px",
                  color: "rgba(203,213,225,0.8)",
                  lineHeight: 1.7,
                  fontFamily: "'DM Sans', sans-serif",
                }}
              >
                {qa.answer}
              </p>
            </div>
          </div>
        ))}

        {loading && (
          <div className="qa-item" style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px", marginLeft: "32px" }}>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                style={{
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  background: colors.node,
                  animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
                }}
              />
            ))}
            <style>{`@keyframes pulse { 0%,100% { opacity: 0.3; transform: scale(0.8); } 50% { opacity: 1; transform: scale(1.1); } }`}</style>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div style={{ padding: "16px", borderTop: `1px solid ${colors.node}20` }}>
        <div
          style={{
            fontSize: "10px",
              color: "rgba(148,163,184,0.5)",
            fontFamily: "'DM Mono', monospace",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            marginBottom: "10px",
          }}
        >
          ASK A FOLLOW-UP
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <input
            className="ask-input"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void handleAsk()}
            placeholder={`Ask about ${node.label}…`}
            style={{
              flex: 1,
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: "8px",
              padding: "10px 12px",
              color: "#e2e8f0",
              fontSize: "13px",
              fontFamily: "'DM Sans', sans-serif",
              transition: "border-color 0.2s",
            }}
          />
          <button
            className="ask-btn"
            onClick={() => void handleAsk()}
            disabled={loading || !question.trim()}
            style={{
              background: `linear-gradient(135deg, ${colors.node}, ${colors.glow})`,
              border: "none",
              borderRadius: "8px",
              padding: "10px 14px",
              cursor: "pointer",
              color: "#0a0b12",
              fontWeight: "700",
              fontSize: "14px",
              opacity: loading || !question.trim() ? 0.4 : 0.9,
              transition: "opacity 0.2s, transform 0.15s",
              fontFamily: "'DM Mono', monospace",
            }}
          >
            ↵
          </button>
        </div>
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div
      style={{
        position: "absolute",
        bottom: "20px",
        left: "20px",
        background: "rgba(10,11,18,0.85)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "12px",
        padding: "12px 16px",
        backdropFilter: "blur(12px)",
      }}
    >
      {Object.entries(categoryColors).map(([cat, c]) => (
        <div key={cat} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
          <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: c.node, boxShadow: `0 0 6px ${c.glow}` }} />
          <span style={{ fontSize: "10px", color: "rgba(148,163,184,0.7)", fontFamily: "'DM Mono', monospace", textTransform: "capitalize" }}>{cat}</span>
        </div>
      ))}
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", marginTop: "8px", paddingTop: "8px" }}>
        <span style={{ fontSize: "9px", color: "rgba(100,116,139,0.6)", fontFamily: "'DM Mono', monospace" }}>SCROLL TO ZOOM · DRAG TO PAN</span>
      </div>
    </div>
  );
}

function InputScreen({ onAnalyze, loading }: { onAnalyze: (text: string) => void; loading: boolean }) {
  const [text, setText] = useState("");

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", padding: "40px", gap: "32px" }}>
      <div style={{ textAlign: "center", maxWidth: "520px" }}>
        <div
          style={{
            width: "56px",
            height: "56px",
            margin: "0 auto 20px",
            background: "linear-gradient(135deg, #6366f1, #06b6d4)",
            borderRadius: "16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "26px",
            boxShadow: "0 0 40px rgba(99,102,241,0.4)",
          }}
        >
          ⬡
        </div>
        <h1
          style={{
            margin: "0 0 12px",
            fontSize: "32px",
            fontWeight: "800",
            fontFamily: "'DM Sans', sans-serif",
            background: "linear-gradient(135deg, #f1f5f9 30%, #818cf8)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          Paper Graph Explorer
        </h1>
        <p style={{ margin: 0, color: "rgba(148,163,184,0.7)", fontSize: "14px", lineHeight: 1.6, fontFamily: "'DM Sans', sans-serif" }}>
          Transform any research paper into an interactive concept graph.
          <br />
          Click nodes to explore summaries and ask questions.
        </p>
      </div>

      <div style={{ width: "100%", maxWidth: "640px" }}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste your research paper text here…"
          style={{
            width: "100%",
            height: "220px",
            resize: "vertical",
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "14px",
            padding: "16px",
            color: "#e2e8f0",
            fontSize: "13px",
            lineHeight: 1.7,
            fontFamily: "'DM Sans', sans-serif",
            boxSizing: "border-box",
            transition: "border-color 0.2s",
          }}
          onFocus={(e) => (e.target.style.borderColor = "rgba(99,102,241,0.5)")}
          onBlur={(e) => (e.target.style.borderColor = "rgba(255,255,255,0.1)")}
        />
        <div style={{ display: "flex", gap: "10px", marginTop: "12px" }}>
          <button
            onClick={() => onAnalyze(text || SAMPLE_PAPER)}
            disabled={loading}
            style={{
              flex: 1,
              padding: "14px",
              borderRadius: "10px",
              border: "none",
              cursor: "pointer",
              background: "linear-gradient(135deg, #6366f1, #06b6d4)",
              color: "#fff",
              fontSize: "14px",
              fontWeight: "700",
              fontFamily: "'DM Sans', sans-serif",
              opacity: loading ? 0.7 : 1,
              transition: "opacity 0.2s, transform 0.15s",
              boxShadow: "0 0 30px rgba(99,102,241,0.3)",
            }}
          >
            {loading ? "Analyzing paper…" : "Analyze Paper →"}
          </button>
          <button
            onClick={() => onAnalyze(SAMPLE_PAPER)}
            disabled={loading}
            style={{
              padding: "14px 20px",
              borderRadius: "10px",
              border: "1px solid rgba(255,255,255,0.1)",
              background: "transparent",
              color: "rgba(148,163,184,0.8)",
              cursor: "pointer",
              fontSize: "13px",
              fontFamily: "'DM Sans', sans-serif",
              whiteSpace: "nowrap",
              transition: "border-color 0.2s",
            }}
          >
            Try Sample
          </button>
        </div>
      </div>
    </div>
  );
}

function LoadingScreen() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const t = window.setInterval(() => setStep((s) => Math.min(s + 1, LOADING_STEPS.length - 1)), 1200);
    return () => window.clearInterval(t);
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: "24px" }}>
      <div style={{ position: "relative", width: "64px", height: "64px" }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              inset: `${i * 10}px`,
              border: `2px solid rgba(99,102,241,${0.8 - i * 0.2})`,
              borderRadius: "50%",
              animation: `spin ${1.5 + i * 0.5}s linear infinite ${i % 2 ? "reverse" : ""}`,
            }}
          />
        ))}
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
      <div style={{ textAlign: "center" }}>
        <p style={{ margin: 0, color: "#818cf8", fontSize: "14px", fontFamily: "'DM Mono', monospace" }}>{LOADING_STEPS[step]}</p>
      </div>
    </div>
  );
}

export function PaperGraphExplorer({
  embedded = false,
  autoDocId = null,
  prefetchedGraph = null,
  backgroundStatus = "idle",
  backgroundError = null,
}: PaperGraphExplorerProps) {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";

  const [stage, setStage] = useState<"input" | "loading" | "graph">("input");
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [paperText, setPaperText] = useState("");
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastPrefetchKeyRef = useRef<string>("");
  const lastAutoDocIdRef = useRef<string | null>(null);

  const handleAnalyze = useCallback(
    async (text: string) => {
      setPaperText(text);
      setStage("loading");
      setError(null);
      try {
        const res = await fetch(`${apiBase}/graph/extract`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paper_text: text }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Failed to extract graph");
        setGraphData(data as GraphData);
        setStage("graph");
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Graph extraction failed";
        setError(msg);
        setStage("input");
      }
    },
    [apiBase]
  );

  useEffect(() => {
    if (!autoDocId) return;
    if (lastAutoDocIdRef.current === autoDocId) return;
    lastAutoDocIdRef.current = autoDocId;

    let cancelled = false;
    const run = async () => {
      try {
        setStage("loading");
        const contextRes = await fetch(`${apiBase}/documents/${autoDocId}/context`);
        const contextData = await contextRes.json();
        if (!contextRes.ok) throw new Error(contextData.detail || "Failed to fetch uploaded document context");
        if (cancelled) return;
        const text = String(contextData.paper_text || "");
        await handleAnalyze(text);
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : "Auto graph generation failed";
          setError(msg);
          setStage("input");
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [apiBase, autoDocId, handleAnalyze]);

  useEffect(() => {
    if (!prefetchedGraph) return;
    const key = `${prefetchedGraph.graphData.title}:${prefetchedGraph.graphData.nodes.length}:${prefetchedGraph.graphData.edges.length}`;
    if (lastPrefetchKeyRef.current === key) return;
    lastPrefetchKeyRef.current = key;
    setPaperText(prefetchedGraph.paperText);
    setGraphData(prefetchedGraph.graphData);
    setError(null);
    setStage("graph");
  }, [prefetchedGraph]);

  useEffect(() => {
    if (backgroundStatus === "loading" && stage === "input") {
      setStage("loading");
    }
    if (backgroundStatus === "error" && backgroundError && error !== backgroundError) {
      setError(backgroundError);
      if (stage === "loading") setStage("input");
    }
  }, [backgroundError, backgroundStatus, error, stage]);

  return (
    <div
      style={{
        width: "100%",
        height: embedded ? "100%" : "100vh",
        minHeight: embedded ? "640px" : "100vh",
        background: "#080910",
        position: "relative",
        overflow: "hidden",
        fontFamily: "'DM Sans', sans-serif",
        borderRadius: embedded ? "12px" : 0,
      }}
    >
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap'); * { box-sizing: border-box; }`}</style>

      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background:
            "radial-gradient(ellipse 80% 60% at 20% 50%, rgba(99,102,241,0.07) 0%, transparent 60%), radial-gradient(ellipse 60% 40% at 80% 30%, rgba(6,182,212,0.06) 0%, transparent 60%)",
        }}
      />

      {stage === "graph" && graphData && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 10,
            padding: "14px 20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "rgba(8,9,16,0.8)",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            backdropFilter: "blur(16px)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{ fontSize: "18px" }}>⬡</div>
            <div>
              <div style={{ fontSize: "13px", fontWeight: "700", color: "#f1f5f9" }}>{graphData.title || "Research Paper"}</div>
              <div style={{ fontSize: "10px", color: "rgba(148,163,184,0.5)", fontFamily: "'DM Mono', monospace" }}>
                {graphData.nodes?.length} CONCEPTS · {graphData.edges?.length} CONNECTIONS
              </div>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div
          style={{
            position: "absolute",
            top: "20px",
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(239,68,68,0.15)",
            border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: "8px",
            padding: "10px 16px",
            color: "#fca5a5",
            fontSize: "13px",
            fontFamily: "'DM Mono', monospace",
            zIndex: 100,
          }}
        >
          ⚠ {error}
        </div>
      )}

      <div style={{ position: "absolute", inset: 0, top: stage === "graph" ? "52px" : 0 }}>
        {stage === "input" && <InputScreen onAnalyze={handleAnalyze} loading={false} />}
        {stage === "loading" && <LoadingScreen />}
        {stage === "graph" && graphData && (
          <div style={{ width: "100%", height: "100%", position: "relative" }}>
            <GraphCanvas graphData={graphData} selectedId={selectedNode?.id || null} onSelectNode={setSelectedNode} />
            <Legend />
            {selectedNode && <ConceptCard node={selectedNode} paperText={paperText} onClose={() => setSelectedNode(null)} apiBase={apiBase} />}
          </div>
        )}
      </div>
    </div>
  );
}
