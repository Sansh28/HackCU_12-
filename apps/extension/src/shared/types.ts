export type GraphCategory = "foundation" | "method" | "result" | "component" | "concept";

export type ContextNode = {
  id: string;
  label: string;
  summary: string;
  category: GraphCategory;
  importance: number;
};

export type ContextEdge = {
  source: string;
  target: string;
  label: string;
};

export type PaperUseCase = {
  title: string;
  description: string;
};

export type ExtractionStrategy =
  | "adapter:arxiv"
  | "adapter:openreview"
  | "adapter:semantic-scholar"
  | "adapter:acm"
  | "adapter:ieee"
  | "adapter:springer"
  | "adapter:researchgate"
  | "adapter:ncbi"
  | "generic-dom"
  | "arxiv-abs-fallback"
  | "local-fallback-graph";

export type ExtractionMeta = {
  site:
    | "arxiv"
    | "openreview"
    | "semantic-scholar"
    | "acm"
    | "ieee"
    | "springer"
    | "researchgate"
    | "ncbi"
    | "generic";
  strategy: ExtractionStrategy;
  confidence: "high" | "medium" | "low";
  usedFallbackGraph: boolean;
  usedBackendGraph: boolean;
};

export type ContextTreePayload = {
  sourceUrl: string;
  title: string;
  paperText: string;
  nodes: ContextNode[];
  edges: ContextEdge[];
  useCases: PaperUseCase[];
  extraction: ExtractionMeta;
};

export type ExtensionMessage =
  | { type: "FETCH_CONTEXT_TREE" }
  | { type: "PING" };

export type ExtensionResponse =
  | { ok: true; data: ContextTreePayload }
  | { ok: false; error: string };
