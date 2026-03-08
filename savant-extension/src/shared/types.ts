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

export type ContextTreePayload = {
  sourceUrl: string;
  title: string;
  paperText: string;
  nodes: ContextNode[];
  edges: ContextEdge[];
  useCases: PaperUseCase[];
};

export type ExtensionMessage =
  | { type: "FETCH_CONTEXT_TREE" }
  | { type: "PING" };

export type ExtensionResponse =
  | { ok: true; data: ContextTreePayload }
  | { ok: false; error: string };
