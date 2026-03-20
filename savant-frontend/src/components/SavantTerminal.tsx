"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Citation = {
  filename?: string;
  page_number?: number;
  chunk_index?: number;
  score?: number;
  snippet?: string;
};

type QueryTelemetry = {
  embed_ms?: number;
  retrieval_ms?: number;
  llm_ms?: number;
  tts_ms?: number;
  payment_verify_ms?: number;
  total_ms?: number;
};

type DocMeta = {
  chunksProcessed?: number;
  chunksStored?: number;
  pageCount?: number;
  ingestMs?: number;
};

type ConversationRecord = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  docId: string | null;
  fileName: string | null;
  sessionId: string | null;
  logs: string[];
  citations: Citation[];
  telemetry: QueryTelemetry | null;
  docMeta: DocMeta | null;
};

type SavantTerminalProps = {
  onUploadComplete?: (payload: { docId: string; filename: string; conversationId: string }) => void;
  onConversationChange?: (payload: {
    conversationId: string;
    docId: string | null;
    fileName: string | null;
  }) => void;
  graphStatusByConversation?: Record<string, "idle" | "loading" | "ready" | "error">;
};

declare global {
  interface Window {
    webkitSpeechRecognition?: new () => SpeechRecognition;
  }
}

const STORAGE_KEY = "savant_conversations_v1";
const DEFAULT_SUGGESTIONS = [
  "Summarize the main contribution of this paper.",
  "What problem is the paper trying to solve?",
  "What are the key findings and limitations?",
];

const DOCUMENT_SUGGESTIONS = [
  "Explain the methodology step by step.",
  "What datasets, metrics, and baselines are used?",
  "What are the biggest limitations or open questions?",
];

const newConversation = (): ConversationRecord => {
  const now = Date.now();
  return {
    id: `conv_${now}_${Math.random().toString(16).slice(2, 8)}`,
    title: "New Chat",
    createdAt: now,
    updatedAt: now,
    docId: null,
    fileName: null,
    sessionId: null,
    logs: ["> terminal initialized... awaiting document upload."],
    citations: [],
    telemetry: null,
    docMeta: null,
  };
};

export function SavantTerminal({ onUploadComplete, onConversationChange, graphStatusByConversation }: SavantTerminalProps) {
  const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";

  const [conversations, setConversations] = useState<ConversationRecord[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [renameConversationId, setRenameConversationId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const [logs, setLogs] = useState<string[]>(["> terminal initialized... awaiting document upload."]);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [docId, setDocId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [pageNumber, setPageNumber] = useState<string>("");
  const [isUploading, setIsUploading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [telemetry, setTelemetry] = useState<QueryTelemetry | null>(null);
  const [docMeta, setDocMeta] = useState<DocMeta | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [voiceMode, setVoiceMode] = useState<"audio" | "tts" | null>(null);
  const [waveHeights, setWaveHeights] = useState<number[]>(() => Array.from({ length: 20 }, () => 18));

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentAudioObjectUrl = useRef<string | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const ttsUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const logsContainerRef = useRef<HTMLDivElement | null>(null);
  const [logScrollPercent, setLogScrollPercent] = useState(100);
  const hydratingConversationRef = useRef(false);
  const lastSyncedSnapshotRef = useRef<string>("");
  const lastConversationPayloadRef = useRef<string>("");

  const canUseSpeech = useMemo(() => {
    if (typeof window === "undefined") return false;
    return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  }, []);

  const hydrateFromBackend = async (): Promise<boolean> => {
    try {
      const res = await fetch(`${API_BASE}/chat/conversations`);
      const data = await res.json();
      if (!res.ok || !Array.isArray(data.conversations)) return false;

      const mapped: ConversationRecord[] = data.conversations.map((item: Record<string, unknown>) => ({
        id: String(item.conversation_id),
        title: String(item.title || "New Chat"),
        createdAt: new Date((item.created_at as string | number) || Date.now()).getTime(),
        updatedAt: new Date((item.updated_at as string | number) || Date.now()).getTime(),
        docId: (item.doc_id as string | null | undefined) ?? null,
        fileName: (item.file_name as string | null | undefined) ?? null,
        sessionId: (item.session_id as string | null | undefined) ?? null,
        logs:
          Array.isArray(item.logs) && item.logs.length
            ? (item.logs as string[])
            : ["> terminal initialized... awaiting document upload."],
        citations: Array.isArray(item.citations) ? (item.citations as Citation[]) : [],
        telemetry: (item.telemetry as QueryTelemetry | null | undefined) ?? null,
        docMeta: (item.doc_meta as DocMeta | null | undefined) ?? null,
      }));

      if (!mapped.length) return false;
      setConversations(mapped);
      setActiveConversationId(mapped[0].id);
      return true;
    } catch {
      return false;
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    (async () => {
      const backendHydrated = await hydrateFromBackend();
      if (backendHydrated) {
        setStorageReady(true);
        return;
      }
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) {
          const first = newConversation();
          setConversations([first]);
          setActiveConversationId(first.id);
        } else {
          const parsed = JSON.parse(raw) as ConversationRecord[];
          if (!Array.isArray(parsed) || parsed.length === 0) {
            const first = newConversation();
            setConversations([first]);
            setActiveConversationId(first.id);
          } else {
            setConversations(parsed);
            setActiveConversationId(parsed[0].id);
          }
        }
      } catch {
        const first = newConversation();
        setConversations([first]);
        setActiveConversationId(first.id);
      } finally {
        setStorageReady(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!storageReady || typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
  }, [conversations, storageReady]);

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeConversationId) ?? null,
    [activeConversationId, conversations]
  );

  useEffect(() => {
    hydratingConversationRef.current = true;
  }, [activeConversationId]);

  useEffect(() => {
    if (!activeConversation) return;
    setLogs(activeConversation.logs?.length ? activeConversation.logs : ["> terminal initialized... awaiting document upload."]);
    setUploadedFileName(activeConversation.fileName || null);
    setDocId(activeConversation.docId || null);
    setSessionId(activeConversation.sessionId || null);
    setCitations(activeConversation.citations || []);
    setTelemetry(activeConversation.telemetry || null);
    setDocMeta(activeConversation.docMeta || null);
    setShareUrl(null);
    requestAnimationFrame(() => {
      hydratingConversationRef.current = false;
    });
  }, [activeConversation]);

  useEffect(() => {
    if (!storageReady || !activeConversationId || hydratingConversationRef.current) return;

    setConversations((prev) => {
      const idx = prev.findIndex((conv) => conv.id === activeConversationId);
      if (idx === -1) return prev;
      const conv = prev[idx];

      const autoTitle = conv.logs.find((line) => line.startsWith("> Query initiated:"))?.replace("> Query initiated:", "Q:").slice(0, 70);
      const nextTitle = conv.title === "New Chat" ? uploadedFileName || autoTitle || conv.title : conv.title;

      const same =
        conv.title === nextTitle &&
        conv.docId === docId &&
        conv.fileName === uploadedFileName &&
        conv.sessionId === sessionId &&
        conv.logs === logs &&
        conv.citations === citations &&
        conv.telemetry === telemetry &&
        conv.docMeta === docMeta;

      if (same) return prev;

      const next = [...prev];
      next[idx] = {
        ...conv,
        title: nextTitle,
        docId,
        fileName: uploadedFileName,
        sessionId,
        logs,
        citations,
        telemetry,
        docMeta,
        updatedAt: Date.now(),
      };
      return next;
    });
  }, [activeConversationId, citations, docId, docMeta, logs, sessionId, storageReady, telemetry, uploadedFileName]);

  useEffect(() => {
    if (!storageReady || !activeConversationId || !activeConversation) return;

    const snapshot = JSON.stringify({
      id: activeConversationId,
      title: activeConversation.title,
      docId: activeConversation.docId,
      fileName: activeConversation.fileName,
      sessionId: activeConversation.sessionId,
      logs: activeConversation.logs,
      citations: activeConversation.citations,
      telemetry: activeConversation.telemetry,
      docMeta: activeConversation.docMeta,
    });
    if (snapshot === lastSyncedSnapshotRef.current) return;

    const timeout = window.setTimeout(async () => {
      try {
        await fetch(`${API_BASE}/chat/conversations/${activeConversationId}/state`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: activeConversation.title,
            doc_id: activeConversation.docId,
            file_name: activeConversation.fileName,
            session_id: activeConversation.sessionId,
            logs: activeConversation.logs,
            citations: activeConversation.citations,
            telemetry: activeConversation.telemetry,
            doc_meta: activeConversation.docMeta,
          }),
        });
        lastSyncedSnapshotRef.current = snapshot;
      } catch {
        // fallback remains in localStorage
      }
    }, 1200);

    return () => window.clearTimeout(timeout);
  }, [API_BASE, activeConversation, activeConversationId, storageReady]);

  useEffect(() => {
    return () => {
      if (currentAudioObjectUrl.current) {
        URL.revokeObjectURL(currentAudioObjectUrl.current);
      }
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  useEffect(() => {
    if (!logsContainerRef.current) return;
    requestAnimationFrame(() => {
      if (!logsContainerRef.current) return;
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
      const { scrollTop, scrollHeight, clientHeight } = logsContainerRef.current;
      const max = Math.max(1, scrollHeight - clientHeight);
      setLogScrollPercent(Math.round((scrollTop / max) * 100));
    });
  }, [logs]);

  useEffect(() => {
    if (!activeConversationId) return;
    const payload = {
      conversationId: activeConversationId,
      docId: activeConversation?.docId ?? null,
      fileName: activeConversation?.fileName ?? null,
    };
    const key = JSON.stringify(payload);
    if (key === lastConversationPayloadRef.current) return;
    lastConversationPayloadRef.current = key;
    onConversationChange?.(payload);
  }, [activeConversation, activeConversationId, onConversationChange]);

  useEffect(() => {
    if (!isPlaying || isPaused) {
      setWaveHeights(Array.from({ length: 20 }, () => 18));
      return;
    }
    const interval = window.setInterval(() => {
      setWaveHeights(Array.from({ length: 20 }, () => 14 + Math.floor(Math.random() * 82)));
    }, 120);
    return () => window.clearInterval(interval);
  }, [isPaused, isPlaying]);

  const addLog = (msg: string) => setLogs((prev) => [...prev, `> ${msg}`]);

  const createConversation = () => {
    const next = newConversation();
    setConversations((prev) => [next, ...prev]);
    setActiveConversationId(next.id);
    setQuery("");
    setPageNumber("");
    setShareUrl(null);
    setIsPlaying(false);
    setIsPaused(false);
    setVoiceMode(null);
    setDocMeta(null);
  };

  const renameConversation = async (conversationId: string, title: string) => {
    const clean = title.trim();
    if (!clean) return;
    setConversations((prev) =>
      prev.map((c) => (c.id === conversationId ? { ...c, title: clean.slice(0, 120), updatedAt: Date.now() } : c))
    );
    setRenameConversationId(null);
    setRenameDraft("");
    try {
      await fetch(`${API_BASE}/chat/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: clean }),
      });
    } catch {
      // local state already updated
    }
  };

  const deleteConversation = async (conversationId: string) => {
    const remaining = conversations.filter((c) => c.id !== conversationId);
    if (!remaining.length) {
      const next = newConversation();
      setConversations([next]);
      setActiveConversationId(next.id);
    } else {
      setConversations(remaining);
      if (activeConversationId === conversationId) {
        setActiveConversationId(remaining[0].id);
      }
    }
    try {
      await fetch(`${API_BASE}/chat/conversations/${conversationId}`, { method: "DELETE" });
    } catch {
      // local state still works
    }
  };

  const createSession = async (currentDocId?: string, title?: string) => {
    try {
      const res = await fetch(`${API_BASE}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc_id: currentDocId, title }),
      });
      const data = await res.json();
      if (res.ok) {
        setSessionId(data.session_id);
        setShareUrl(`${API_BASE}${data.share_url}`);
        addLog(`Session active: ${data.session_id.slice(0, 8)}...`);
      }
    } catch {
      addLog("Session service unavailable. Continuing without persistence.");
    }
  };

  const stopVoice = () => {
    if (voiceMode === "audio" && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    if (voiceMode === "tts" && typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      ttsUtteranceRef.current = null;
    }
    setIsPlaying(false);
    setIsPaused(false);
    setVoiceMode(null);
    addLog("Voice playback stopped.");
  };

  const pauseVoice = () => {
    if (voiceMode === "audio" && audioRef.current && !audioRef.current.paused) {
      audioRef.current.pause();
      setIsPaused(true);
      setIsPlaying(false);
      addLog("Voice playback paused.");
      return;
    }
    if (voiceMode === "tts" && typeof window !== "undefined" && "speechSynthesis" in window && window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
      window.speechSynthesis.pause();
      setIsPaused(true);
      setIsPlaying(false);
      addLog("Voice playback paused.");
    }
  };

  const resumeVoice = () => {
    if (voiceMode === "audio" && audioRef.current && audioRef.current.paused) {
      void audioRef.current.play();
      setIsPaused(false);
      setIsPlaying(true);
      addLog("Voice playback resumed.");
      return;
    }
    if (voiceMode === "tts" && typeof window !== "undefined" && "speechSynthesis" in window && window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
      setIsPaused(false);
      setIsPlaying(true);
      addLog("Voice playback resumed.");
    }
  };

  const speakWithBrowserTts = (text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      addLog("No audio output available (ElevenLabs + browser TTS unavailable).");
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.onstart = () => {
      setVoiceMode("tts");
      setIsPaused(false);
      setIsPlaying(true);
    };
    utterance.onend = () => {
      setIsPaused(false);
      setIsPlaying(false);
      setVoiceMode(null);
    };
    utterance.onerror = () => {
      setIsPaused(false);
      setIsPlaying(false);
      setVoiceMode(null);
    };
    ttsUtteranceRef.current = utterance;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;

    const selectedFile = e.target.files[0];
    setUploadedFileName(selectedFile.name);
    addLog(`Selected document: ${selectedFile.name}`);

    setIsUploading(true);
    addLog("Uploading and vectorizing document in MongoDB Atlas...");

    const formData = new FormData();
    formData.append("file", selectedFile);

    try {
      const res = await fetch(`${API_BASE}/upload`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (res.ok) {
        if (!data.chunks_processed || data.chunks_processed === 0) {
          setDocId(null);
          setDocMeta(null);
          addLog("Upload failed: no extractable text found in this PDF.");
          addLog("Tip: use a text-based PDF or OCR the document first.");
          return;
        }

        setDocId(data.doc_id);
        setDocMeta({
          chunksProcessed: Number(data.chunks_processed || 0),
          chunksStored: Number(data.chunks_stored || data.chunks_processed || 0),
          pageCount: Number(data.page_count || 0),
          ingestMs: Number(data.telemetry?.ingest_ms || 0),
        });
        addLog(`Ingestion complete! Extracted ${data.chunks_processed} chunks, stored ${data.chunks_stored ?? data.chunks_processed}.`);
        if (data.page_count) addLog(`Detected ${data.page_count} text pages.`);
        if (data.telemetry?.ingest_ms) addLog(`Ingestion latency: ${data.telemetry.ingest_ms} ms.`);

        await createSession(data.doc_id, `Session: ${selectedFile.name}`);
        if (activeConversationId) {
          onUploadComplete?.({ docId: data.doc_id, filename: selectedFile.name, conversationId: activeConversationId });
        }
      } else {
        addLog(`Upload failed: ${data.detail}`);
      }
    } catch (error) {
      console.error(error);
      addLog("Error connecting to backend for upload.");
    } finally {
      setIsUploading(false);
    }
  };

  const runQuery = async (promptText: string) => {
    if (!promptText.trim()) return;
    if (!docId) {
      addLog("ERROR: Please upload a document first.");
      return;
    }

    addLog(`Query initiated: "${promptText}"`);
    setIsProcessing(true);

    try {
      addLog("Searching MongoDB Atlas Vector Store...");
      const res = await fetch(`${API_BASE}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: promptText,
          doc_id: docId,
          page_number: pageNumber ? Number(pageNumber) : null,
          session_id: sessionId,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setCitations(data.citations ?? []);
        setTelemetry(data.telemetry ?? null);
        addLog(`Savant Brain generated response based on ${data.context_used.length} chunks.`);
        if (data.context_used.length === 0) addLog("No matching chunks were retrieved for this prompt.");
        addLog(`Synthesis: ${data.answer}`);

        if (data.audio_base64) {
          addLog("Streaming ElevenLabs audio...");
          const binaryString = window.atob(data.audio_base64);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
          const blob = new Blob([bytes], { type: "audio/mpeg" });
          const url = URL.createObjectURL(blob);

          if (currentAudioObjectUrl.current) URL.revokeObjectURL(currentAudioObjectUrl.current);
          currentAudioObjectUrl.current = url;

          if (audioRef.current) {
            audioRef.current.src = url;
            setVoiceMode("audio");
            setIsPaused(false);
            void audioRef.current.play();
          }
        } else if (data.answer) {
          addLog("ElevenLabs audio unavailable, using browser voice fallback...");
          speakWithBrowserTts(data.answer);
        }
      } else {
        addLog(`Processing failed: ${data.detail}`);
      }
    } catch (error) {
      console.error(error);
      addLog("Query failed. Check backend connection and try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleQuerySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await runQuery(query);
    setQuery("");
  };

  const startVoiceInput = () => {
    if (!canUseSpeech) {
      addLog("Browser speech recognition is not supported in this environment.");
      return;
    }

    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      addLog("Speech recognition interface not found.");
      return;
    }

    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }

    const recognition = new Recognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(true);
      addLog("Listening for voice query...");
    };

    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      if (transcript) {
        setQuery(transcript);
        addLog(`Heard: "${transcript}"`);
        if (docId && !isProcessing) {
          addLog("Submitting voice query...");
          void runQuery(transcript);
        }
      }
    };

    recognition.onerror = () => addLog("Voice input failed. Please try again.");
    recognition.onend = () => setIsListening(false);

    recognitionRef.current = recognition;
    recognition.start();
  };

  const copyShareLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      addLog("Share link copied to clipboard.");
    } catch {
      addLog(`Share URL: ${shareUrl}`);
    }
  };

  const filteredConversations = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return conversations;
    return conversations.filter((conv) => {
      const hay = `${conv.title} ${conv.fileName ?? ""} ${conv.logs.slice(-2).join(" ")}`.toLowerCase();
      return hay.includes(term);
    });
  }, [conversations, searchTerm]);

  const timelineItems = useMemo(() => {
    return logs.map((line, idx) => {
      const raw = line.replace(/^>\s*/, "");
      let tone: "info" | "success" | "warn" | "error" = "info";
      if (/failed|error/i.test(raw)) tone = "error";
      else if (/complete|generated|confirmed|copied|streaming|resumed|ready/i.test(raw)) tone = "success";
      else if (/tip|waiting|listening|uploading|searching|processing|paused/i.test(raw)) tone = "warn";
      return { id: `${idx}-${raw.slice(0, 20)}`, raw, tone };
    });
  }, [logs]);

  const pipelineStatus = useMemo(() => {
    if (isUploading) return "Uploading";
    if (isProcessing) return "Reasoning";
    if (docId) return "Ready";
    return "No Paper";
  }, [docId, isProcessing, isUploading]);

  const handleLogScroll = () => {
    if (!logsContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = logsContainerRef.current;
    const max = Math.max(1, scrollHeight - clientHeight);
    setLogScrollPercent(Math.round((scrollTop / max) * 100));
  };

  const handleLogSlider = (value: number) => {
    setLogScrollPercent(value);
    if (!logsContainerRef.current) return;
    const { scrollHeight, clientHeight } = logsContainerRef.current;
    const max = Math.max(0, scrollHeight - clientHeight);
    logsContainerRef.current.scrollTop = (value / 100) * max;
  };

  const suggestedQuestions = useMemo(() => {
    if (!docId) return DEFAULT_SUGGESTIONS;

    const suggestions = [...DOCUMENT_SUGGESTIONS];
    if (docMeta?.pageCount && docMeta.pageCount > 8) {
      suggestions.push("Give me a section-by-section breakdown of the paper.");
    } else {
      suggestions.push("Give me a concise executive summary in plain English.");
    }

    if (citations.length > 0) {
      suggestions.push("Which evidence in the paper best supports the last answer?");
    } else {
      suggestions.push("What evidence from the paper supports the main claims?");
    }

    return suggestions;
  }, [citations.length, docId, docMeta?.pageCount]);

  const applySuggestedQuestion = async (suggestion: string) => {
    setQuery(suggestion);
    if (!docId || isUploading || isProcessing) return;
    await runQuery(suggestion);
    setQuery("");
  };

  return (
    <div className="h-full min-h-[520px] grid grid-cols-1 xl:grid-cols-[300px_1fr] gap-4">
      <aside className="bg-[#0e1728]/45 backdrop-blur-md border border-[#7a5b1b]/70 rounded-xl p-3 flex flex-col min-h-[520px] min-h-0 shadow-[0_10px_28px_rgba(0,0,0,0.35)]">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[11px] font-mono uppercase tracking-[0.2em] text-[#c9a65c]">Conversations</div>
          <button
            type="button"
            onClick={createConversation}
            className="text-xs font-mono px-2 py-1 rounded-lg border border-[#8d6a20] bg-[#111e35] text-[#c8d9f4] hover:text-white hover:border-[#4e74aa]"
          >
            + New
          </button>
        </div>

        <input
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search chats..."
          className="mb-3 w-full bg-[#110d07]/55 border border-[#7a5b1b]/70 rounded-lg px-2.5 py-2 text-xs text-[#f8e6bc] font-mono focus:outline-none focus:border-[#f2c14e]"
        />

        <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
          {filteredConversations.map((conv) => (
            <div
              key={conv.id}
              className={`w-full text-left rounded border px-3 py-2 transition ${conv.id === activeConversationId
                  ? "bg-[#1b150a]/60 border-[#c19435] text-[#f2f7ff]"
                  : "bg-[#151008]/45 border-[#7a5b1b]/65 text-[#ddb974] hover:text-[#e7f0ff] hover:border-[#b58a2c]"
                }`}
            >
              {renameConversationId === conv.id ? (
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void renameConversation(conv.id, renameDraft);
                      if (e.key === "Escape") {
                        setRenameConversationId(null);
                        setRenameDraft("");
                      }
                    }}
                    className="flex-1 bg-[#110d07]/60 border border-[#8d6a20] rounded px-2 py-1 text-xs text-[#fbeece] font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => void renameConversation(conv.id, renameDraft)}
                    className="text-[10px] font-mono px-2 py-1 rounded border border-[#466896] text-[#e0ecff]"
                  >
                    Save
                  </button>
                </div>
              ) : (
                <>
                  <button type="button" onClick={() => setActiveConversationId(conv.id)} className="w-full text-left">
                    <div className="flex items-center gap-2">
                      <div className="text-xs font-medium truncate">{conv.title}</div>
                      {graphStatusByConversation?.[conv.id] === "loading" && (
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-amber-500/40 bg-amber-400/10 text-amber-300">
                          Building
                        </span>
                      )}
                      {graphStatusByConversation?.[conv.id] === "ready" && (
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-[#b58a2c]/50 bg-[#f2c14e]/10 text-[#f2c14e]">
                          Ready
                        </span>
                      )}
                      {graphStatusByConversation?.[conv.id] === "error" && (
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-red-500/40 bg-red-400/10 text-red-300">
                          Error
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] font-mono mt-1 text-[#7f95ba] truncate">
                      {conv.fileName ? conv.fileName : "No document"} · {new Date(conv.updatedAt).toLocaleString()}
                    </div>
                  </button>
                  <div className="flex items-center gap-2 mt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setRenameConversationId(conv.id);
                        setRenameDraft(conv.title);
                      }}
                      className="text-[10px] font-mono px-2 py-1 rounded border border-[#8d6a20] text-[#f2d18b] hover:text-white"
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteConversation(conv.id)}
                      className="text-[10px] font-mono px-2 py-1 rounded border border-red-600/60 text-red-300 hover:bg-red-500/10"
                    >
                      Delete
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
          {!filteredConversations.length && (
            <div className="text-[11px] font-mono text-[#7f95ba] p-2">No conversations found.</div>
          )}
        </div>
      </aside>

      <div className="flex flex-col h-full space-y-4 min-h-0">
        <div className="flex gap-2 min-h-0">
          <div
            ref={logsContainerRef}
            onScroll={handleLogScroll}
            className="flex-1 bg-[#0a0704]/45 backdrop-blur-md border border-[#37547e]/70 rounded-xl p-4 overflow-y-auto space-y-2 h-[300px] max-h-[420px] min-h-0 shadow-[inset_0_0_0_1px_rgba(120,160,220,0.12)]"
          >
            <div className="mb-3 p-3 rounded-xl border border-[#8d6a20] bg-[#161007]/60 backdrop-blur-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] font-mono uppercase tracking-[0.16em] text-[#f2c14e]">Paper Session</div>
                <div className="text-[11px] font-mono text-[#f7e6bf]">{pipelineStatus}</div>
              </div>
              <div className="mt-1 text-sm text-[#f8e6bf] truncate">{uploadedFileName || "No document uploaded"}</div>
              <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-mono text-[#cfb06f]">
                {docMeta?.pageCount ? <span className="px-2 py-1 rounded-md bg-[#12233a] border border-[#6a4f18]">{docMeta.pageCount} pages</span> : null}
                {docMeta?.chunksProcessed ? <span className="px-2 py-1 rounded-md bg-[#12233a] border border-[#6a4f18]">{docMeta.chunksProcessed} chunks</span> : null}
                {docMeta?.ingestMs ? <span className="px-2 py-1 rounded-md bg-[#12233a] border border-[#6a4f18]">{docMeta.ingestMs} ms ingest</span> : null}
              </div>
            </div>
            {timelineItems.map((item) => (
              <div
                key={item.id}
                className="rounded-lg border px-3 py-2 transition-all duration-200"
                style={{
                  borderColor:
                    item.tone === "error"
                      ? "rgba(248,113,113,0.45)"
                      : item.tone === "success"
                        ? "rgba(52,211,153,0.35)"
                        : item.tone === "warn"
                          ? "rgba(251,191,36,0.35)"
                          : "rgba(71,101,145,0.4)",
                  background:
                    item.tone === "error"
                      ? "rgba(127,29,29,0.18)"
                      : item.tone === "success"
                        ? "rgba(6,78,59,0.16)"
                        : item.tone === "warn"
                          ? "rgba(120,53,15,0.16)"
                          : "rgba(18,35,58,0.18)",
                }}
              >
                <div className="flex items-start gap-2">
                  <span
                    className="mt-1.5 h-1.5 w-1.5 rounded-full"
                    style={{
                      backgroundColor:
                        item.tone === "error"
                          ? "#f87171"
                          : item.tone === "success"
                            ? "#34d399"
                            : item.tone === "warn"
                              ? "#fbbf24"
                              : "#f2c14e",
                    }}
                  />
                  <div className="text-[#efd39a] font-mono text-xs sm:text-sm leading-relaxed">{item.raw}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="w-7 bg-[#171109]/50 backdrop-blur-sm border border-[#7a5b1b]/70 rounded-xl flex items-center justify-center px-1">
            <input
              aria-label="Scroll logs"
              type="range"
              min={0}
              max={100}
              value={logScrollPercent}
              onChange={(e) => handleLogSlider(Number(e.target.value))}
              className="w-24 h-1 -rotate-90 accent-[#f2c14e] cursor-pointer"
            />
          </div>
        </div>

        {(isPlaying || isPaused) && (
          <div className="border border-[#2f6554] rounded-xl bg-[#09141a]/65 backdrop-blur-sm p-3">
            <div className="h-10 flex items-center justify-center gap-1 my-1">
              {waveHeights.map((height, i) => (
                <div
                  key={i}
                  className="w-1.5 bg-[#f2c14e] rounded-full"
                  style={{
                    height: `${height}%`,
                    opacity: isPaused ? 0.35 : 0.95,
                    transition: "height 120ms linear, opacity 160ms ease",
                  }}
                />
              ))}
              <div className="text-[#f2c14e] text-xs ml-4 font-mono uppercase tracking-widest">
                {isPaused ? "Voice Paused" : "Savant Speaking"}
              </div>
            </div>
            <div className="flex items-center justify-center gap-2 mt-2">
              {!isPaused ? (
                <button
                  type="button"
                  onClick={pauseVoice}
                  className="text-xs font-mono px-3 py-1.5 rounded border border-amber-500/50 text-amber-200 hover:bg-amber-500/10"
                >
                  Pause
                </button>
              ) : (
                <button
                  type="button"
                  onClick={resumeVoice}
                  className="text-xs font-mono px-3 py-1.5 rounded border border-[#b58a2c]/50 text-[#f2d18b] hover:bg-[#f2c14e]/10"
                >
                  Resume
                </button>
              )}
              <button
                type="button"
                onClick={stopVoice}
                className="text-xs font-mono px-3 py-1.5 rounded border border-red-500/50 text-red-200 hover:bg-red-500/10"
              >
                Stop
              </button>
            </div>
          </div>
        )}

        <audio
          ref={audioRef}
          onPlay={() => {
            setVoiceMode("audio");
            setIsPaused(false);
            setIsPlaying(true);
          }}
          onPause={() => {
            if (audioRef.current && audioRef.current.currentTime < audioRef.current.duration) {
              setIsPaused(true);
              setIsPlaying(false);
            }
          }}
          onEnded={() => {
            setIsPaused(false);
            setIsPlaying(false);
            setVoiceMode(null);
          }}
          className="hidden"
        />

        {citations.length > 0 && (
          <div className="bg-[#171109]/52 backdrop-blur-sm border border-[#7a5b1b]/70 rounded-xl p-3 space-y-2">
            <div className="text-xs uppercase tracking-widest text-[#c8a55b] font-mono">Citations</div>
            {citations.map((citation, idx) => (
              <div key={`${citation.page_number}-${citation.chunk_index}-${idx}`} className="text-xs text-[#f5deb0] font-mono">
                p.{citation.page_number ?? "?"} c.{citation.chunk_index ?? "?"} | score {citation.score ?? 0} | {citation.snippet}
              </div>
            ))}
          </div>
        )}

        {telemetry && (
          <div className="bg-[#171109]/52 backdrop-blur-sm border border-[#7a5b1b]/70 rounded-xl p-3 text-xs text-[#f5deb0] font-mono">
            total {telemetry.total_ms ?? 0}ms | embed {telemetry.embed_ms ?? 0}ms | retrieve {telemetry.retrieval_ms ?? 0}ms | llm {telemetry.llm_ms ?? 0}ms | tts {telemetry.tts_ms ?? 0}ms
          </div>
        )}

        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-4 flex-wrap">
            <label className="cursor-pointer bg-[#2a1f0d]/65 hover:bg-[#3a2b10]/75 text-white font-mono text-sm px-4 py-2 rounded-lg transition border border-[#a67c1c]">
              {isUploading ? "Uploading..." : uploadedFileName ? "Replace Document (PDF)" : "Upload Document (PDF)"}
              <input type="file" accept=".pdf" className="hidden" onChange={handleFileUpload} disabled={isUploading || isProcessing} />
            </label>
            {uploadedFileName && <span className="text-[#cfb06f] text-sm truncate max-w-[280px]">{uploadedFileName}</span>}
            {shareUrl && (
              <button
                type="button"
                className="bg-[#171109]/60 border border-[#a67c1c] text-[#f8e6bc] px-3 py-2 rounded-lg text-xs font-mono backdrop-blur-sm"
                onClick={copyShareLink}
              >
                Copy Share Link
              </button>
            )}
          </div>

          <div className="rounded-xl border border-[#7a5b1b]/70 bg-[#171109]/45 p-3 backdrop-blur-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-[#c8a55b]">Question Suggestions</div>
                <div className="mt-1 text-xs text-[#d9c087]">
                  {docId ? "Click a prompt to ask about the current paper instantly." : "Upload a paper to unlock paper-aware suggested prompts."}
                </div>
              </div>
              <div className="text-[10px] font-mono text-[#8ea3c7]">
                {docId ? "Paper-aware" : "Starter"}
              </div>
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

          <form onSubmit={handleQuerySubmit} className="flex flex-col gap-2">
            <div className="flex gap-2">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Ask Savant to analyze the document..."
                className="flex-1 bg-[#171109]/58 border border-[#7a5b1b]/70 rounded-lg px-4 py-2 font-mono text-sm text-white focus:outline-none focus:border-[#f2c14e] backdrop-blur-sm"
                disabled={!docId || isUploading || isProcessing}
              />
              <input
                type="number"
                min={1}
                value={pageNumber}
                onChange={(e) => setPageNumber(e.target.value)}
                placeholder="Page"
                className="w-24 bg-[#171109]/58 border border-[#7a5b1b]/70 rounded-lg px-2 py-2 font-mono text-sm text-white focus:outline-none focus:border-[#f2c14e] backdrop-blur-sm"
                disabled={!docId || isUploading || isProcessing}
              />
              <button
                type="button"
                onClick={startVoiceInput}
                disabled={!docId || isUploading || isProcessing || !canUseSpeech}
                className="bg-[#171109]/60 text-[#f8e6bc] px-3 py-2 rounded-lg border border-[#a67c1c] font-mono text-xs backdrop-blur-sm"
              >
                {isListening ? "Stop Mic" : "Voice"}
              </button>
              <button
                type="submit"
                disabled={!docId || isUploading || isProcessing || !query.trim()}
                className="bg-[#f2c14e] text-[#1a1205] px-6 py-2 rounded-lg font-semibold text-sm hover:bg-[#f2c14e] disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {isProcessing ? "Processing..." : "Ask"}
              </button>
            </div>
            <div className="text-xs text-[#b99953] font-mono">
              Direct query mode active.
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
