import type {
  ContextEdge,
  ContextNode,
  ContextTreePayload,
  ExtensionMessage,
  ExtensionResponse,
  GraphCategory,
  PaperUseCase,
} from "./shared/types";
import { API_BASE_URL } from "./shared/config";

const SUPPORTED_HOST_RE = /(researchgate\.net|arxiv\.org|semanticscholar\.org)$/i;
const GRAPH_EXTRACT_URL = `${API_BASE_URL}/graph/extract`;
const GRAPH_USE_CASES_URL = `${API_BASE_URL}/graph/use-cases`;
const SUPPORTED_HOST_RE =
  /(^|\.)((researchgate\.net)|(arxiv\.org)|(semanticscholar\.org)|(openreview\.net)|(ncbi\.nlm\.nih\.gov)|(ieeexplore\.ieee\.org)|(dl\.acm\.org)|(link\.springer\.com))$/i;
const GRAPH_EXTRACT_URL = "http://127.0.0.1:8000/graph/extract";
const GRAPH_USE_CASES_URL = "http://127.0.0.1:8000/graph/use-cases";

function isSupportedUrl(url?: string): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return SUPPORTED_HOST_RE.test(host);
  } catch {
    return false;
  }
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function stripHtml(value: string): string {
  return normalizeText(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
  );
}

function arxivAbsUrlFromAny(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!/arxiv\.org$/i.test(parsed.hostname)) return null;
    const match = parsed.pathname.match(/^\/pdf\/([^/]+?)(?:\.pdf)?$/i);
    if (!match?.[1]) return null;
    return `https://arxiv.org/abs/${match[1]}`;
  } catch {
    return null;
  }
}

async function extractArxivContextFromPdfUrl(sourceUrl: string): Promise<{ title: string; paperText: string } | null> {
  const absUrl = arxivAbsUrlFromAny(sourceUrl);
  if (!absUrl) return null;

  try {
    const res = await fetch(absUrl);
    if (!res.ok) return null;
    const html = await res.text();

    const titleMatch =
      html.match(/<meta\s+name=["']citation_title["']\s+content=["']([^"']+)["']/i) ||
      html.match(/<h1[^>]*class=["'][^"']*title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i);
    const abstractMatch =
      html.match(/<meta\s+name=["']citation_abstract["']\s+content=["']([^"']+)["']/i) ||
      html.match(/<blockquote[^>]*class=["'][^"']*abstract[^"']*["'][^>]*>([\s\S]*?)<\/blockquote>/i);

    const title = stripHtml(titleMatch?.[1] || "ArXiv Paper");
    const abstract = stripHtml(abstractMatch?.[1] || "");
    if (!abstract || abstract.length < 120) return null;

    return {
      title,
      paperText: `${title}\n\nAbstract:\n${abstract}`.slice(0, 32000),
    };
  } catch {
    return null;
  }
}

function topSentences(text: string, max = 8): string[] {
  return normalizeText(text)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 40)
    .slice(0, max);
}

function fallbackContextGraph(title: string, paperText: string, sourceUrl: string): ContextTreePayload {
  const s = topSentences(paperText, 8);
  const sentence = (idx: number, fallback: string): string => s[idx] || fallback;
  const useCases: PaperUseCase[] = [
    {
      title: "Operational Monitoring",
      description: sentence(4, "Apply the method to monitor critical signals and trigger early alerts in operational settings."),
    },
    {
      title: "Decision Support",
      description: sentence(5, "Use model outputs to support human analysts with faster and more consistent interpretation."),
    },
    {
      title: "Automated Screening",
      description: sentence(6, "Deploy as a first-pass screening layer to prioritize high-risk or high-value cases."),
    },
    {
      title: "Performance Optimization",
      description: sentence(7, "Use evaluation insights to optimize detection quality, false alarms, and computational cost."),
    },
  ];

  const nodes: ContextNode[] = [
    {
      id: "core_thesis",
      label: "Core Thesis",
      summary: sentence(0, "Main objective and central thesis extracted from the paper context."),
      category: "foundation",
      importance: 5,
    },
    {
      id: "problem_scope",
      label: "Problem Scope",
      summary: sentence(1, "Defines the scope and assumptions of the research problem."),
      category: "foundation",
      importance: 4,
    },
    {
      id: "method_design",
      label: "Method Design",
      summary: sentence(2, "Describes key method or architecture decisions."),
      category: "method",
      importance: 4,
    },
    {
      id: "data_setup",
      label: "Data and Setup",
      summary: sentence(3, "Dataset, settings, or experimental setup used for evaluation."),
      category: "component",
      importance: 3,
    },
    {
      id: "evaluation",
      label: "Evaluation",
      summary: sentence(4, "How performance is measured and compared."),
      category: "method",
      importance: 3,
    },
    {
      id: "key_findings",
      label: "Key Findings",
      summary: sentence(5, "Primary outcomes and observed improvements."),
      category: "result",
      importance: 4,
    },
    {
      id: "limitations",
      label: "Limitations",
      summary: sentence(6, "Constraints, failure modes, or caveats."),
      category: "concept",
      importance: 2,
    },
    {
      id: "future_work",
      label: "Future Work",
      summary: sentence(7, "Potential next steps and open directions."),
      category: "concept",
      importance: 2,
    },
  ];

  const edges: ContextEdge[] = [
    { source: "core_thesis", target: "problem_scope", label: "frames" },
    { source: "problem_scope", target: "method_design", label: "guides" },
    { source: "method_design", target: "data_setup", label: "uses" },
    { source: "method_design", target: "evaluation", label: "evaluated by" },
    { source: "evaluation", target: "key_findings", label: "supports" },
    { source: "key_findings", target: "limitations", label: "bounded by" },
    { source: "key_findings", target: "future_work", label: "motivates" },
  ];

  return {
    sourceUrl,
    title: title || "Paper Context Graph",
    paperText,
    nodes,
    edges,
    useCases,
  };
}

function asStringId(value: string | { id: string }): string {
  return typeof value === "string" ? value : value.id;
}

function sanitizeCategory(value: string): GraphCategory {
  const category = value.toLowerCase();
  if (category === "foundation" || category === "method" || category === "result" || category === "component" || category === "concept") {
    return category;
  }
  return "concept";
}

function validateUseCasesPayload(raw: unknown): PaperUseCase[] {
  if (!raw || typeof raw !== "object") return [];
  const payload = raw as { use_cases?: Array<{ title?: unknown; description?: unknown }> };
  if (!Array.isArray(payload.use_cases)) return [];

  const cleaned = payload.use_cases
    .map((item) => ({
      title: String(item.title || "").trim().slice(0, 80),
      description: String(item.description || "").trim().slice(0, 320),
    }))
    .filter((item) => item.title && item.description)
    .slice(0, 6);

  return cleaned;
}

function validateContextPayload(raw: unknown, sourceUrl: string, paperText: string, useCases: PaperUseCase[]): ContextTreePayload {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid context graph payload.");
  }
  const payload = raw as {
    title?: unknown;
    nodes?: Array<{
      id?: unknown;
      label?: unknown;
      summary?: unknown;
      category?: unknown;
      importance?: unknown;
    }>;
    edges?: Array<{ source?: unknown; target?: unknown; label?: unknown }>;
  };

  const nodes = Array.isArray(payload.nodes)
    ? payload.nodes
        .map((node) => ({
          id: String(node.id || "").trim(),
          label: String(node.label || "").trim(),
          summary: String(node.summary || "").trim(),
          category: sanitizeCategory(String(node.category || "concept")),
          importance: Math.max(1, Math.min(5, Number(node.importance || 3))),
        }))
        .filter((node) => node.id && node.label)
    : [];

  if (nodes.length < 2) {
    throw new Error("Not enough context nodes generated.");
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = Array.isArray(payload.edges)
    ? payload.edges
        .map((edge) => ({
          source: asStringId(edge.source as string | { id: string }),
          target: asStringId(edge.target as string | { id: string }),
          label: String(edge.label || "relates to").trim().slice(0, 60),
        }))
        .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target) && edge.source !== edge.target)
    : [];

  return {
    sourceUrl,
    title: String(payload.title || "Paper Context Graph"),
    paperText,
    nodes,
    edges,
    useCases,
  };
}

async function extractPageText(tabId: number): Promise<{ title: string; paperText: string }> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const normalize = (text: string): string => text.replace(/\s+/g, " ").trim();
      const textFromMeta = (selectors: string[]): string => {
        for (const selector of selectors) {
          const el = document.querySelector(selector);
          const value = el?.getAttribute("content");
          if (value && normalize(value).length > 40) {
            return normalize(value);
          }
        }
        return "";
      };

      const title =
        normalize((document.querySelector("h1") as HTMLElement | null)?.innerText || "") ||
        textFromMeta([
          'meta[name="citation_title"]',
          'meta[property="og:title"]',
          'meta[name="dc.title"]',
          'meta[name="twitter:title"]',
        ]) ||
        normalize(document.title || "") ||
        "Research Paper";

      const blocks: string[] = [];
      const seen = new Set<string>();
      const collect = (selector: string, limit = 24) => {
        const els = Array.from(document.querySelectorAll(selector));
        for (let i = 0; i < els.length && i < limit; i++) {
          const raw = normalize((els[i] as HTMLElement).innerText || "");
          if (raw.length < 80 || seen.has(raw)) continue;
          seen.add(raw);
          blocks.push(raw);
        }
      };

      const metaAbstract = textFromMeta([
        'meta[name="citation_abstract"]',
        'meta[name="description"]',
        'meta[property="og:description"]',
        'meta[name="dc.description"]',
        'meta[name="twitter:description"]',
      ]);
      if (metaAbstract) {
        blocks.push(`Abstract: ${metaAbstract}`);
      }

      collect("section.abstract, .abstract, #abstract, [class*='abstract']");
      collect('[data-test-id*="abstract"], [data-testid*="abstract"], [class*="summary"], [class*="article__abstract"]');
      collect('section[aria-label*="abstract" i], div[aria-label*="abstract" i]');
      collect("main p, article p, .paper p, [id*='main'] p, .ltx_para");
      collect(".article-section__content p, .c-article-section p, .abstract-group p, .u-mb-1 p");
      collect("main li, article li");

      let paperText = blocks.join("\n\n");
      if (paperText.length < 600) {
        paperText = normalize((document.body as HTMLElement).innerText || "").slice(0, 32000);
      }
      return { title, paperText: paperText.slice(0, 32000) };
    },
  });

  return result.result as { title: string; paperText: string };
}

async function fetchContextGraphFromBackend(paperText: string): Promise<unknown> {
  const res = await fetch(GRAPH_EXTRACT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paper_text: paperText }),
  });

  const raw = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = typeof raw?.detail === "string" ? raw.detail : "Graph extraction failed.";
    throw new Error(detail);
  }
  return raw;
}

async function fetchUseCasesFromBackend(paperText: string): Promise<PaperUseCase[]> {
  const res = await fetch(GRAPH_USE_CASES_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paper_text: paperText }),
  });

  const raw = await res.json().catch(() => ({}));
  if (!res.ok) return [];
  return validateUseCasesPayload(raw);
}

async function fetchContextTreeFromActiveTab(): Promise<ExtensionResponse> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id || !tab.url) {
    return { ok: false, error: "No active tab available." };
  }
  if (!isSupportedUrl(tab.url)) {
    return {
      ok: false,
      error: "Unsupported page. Open a ResearchGate, arXiv, Semantic Scholar, OpenReview, PubMed, IEEE, ACM, or Springer paper and try again.",
    };
  }

  let extracted = await extractPageText(tab.id);
  if (!extracted.paperText || extracted.paperText.length < 300) {
    const arxivFallback = await extractArxivContextFromPdfUrl(tab.url);
    if (arxivFallback) {
      extracted = arxivFallback;
    } else {
      return { ok: false, error: "Could not extract enough paper context from this page." };
    }
  }

  try {
    const [graphRaw, useCases] = await Promise.all([
      fetchContextGraphFromBackend(extracted.paperText),
      fetchUseCasesFromBackend(extracted.paperText),
    ]);
    const validated = validateContextPayload(graphRaw, tab.url, extracted.paperText, useCases);
    return { ok: true, data: validated };
  } catch {
    return {
      ok: true,
      data: fallbackContextGraph(extracted.title, extracted.paperText, tab.url),
    };
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  await chrome.sidePanel.setOptions({
    tabId: tab.id,
    path: "sidepanel.html",
    enabled: isSupportedUrl(tab.url),
  });
  await chrome.sidePanel.open({ tabId: tab.id });
});

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== "complete") return;
  await chrome.sidePanel.setOptions({
    tabId,
    enabled: isSupportedUrl(tab.url),
    path: "sidepanel.html",
  });
});

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  if (message.type === "PING") {
    sendResponse({
      ok: true,
      data: { sourceUrl: "", title: "pong", paperText: "", nodes: [], edges: [], useCases: [] },
    } satisfies ExtensionResponse);
    return false;
  }

  if (message.type === "FETCH_CONTEXT_TREE") {
    void (async () => {
      try {
        const response = await fetchContextTreeFromActiveTab();
        sendResponse(response);
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Failed to fetch context tree.",
        } satisfies ExtensionResponse);
      }
    })();
    return true;
  }

  sendResponse({ ok: false, error: "Unknown message." } satisfies ExtensionResponse);
  return false;
});
