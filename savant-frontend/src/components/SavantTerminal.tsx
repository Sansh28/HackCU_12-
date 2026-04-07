"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { ConversationSidebar } from "@/components/terminal/ConversationSidebar";
import { InsightsPanel } from "@/components/terminal/InsightsPanel";
import { QueryComposer } from "@/components/terminal/QueryComposer";
import { SuggestionsPanel } from "@/components/terminal/SuggestionsPanel";
import { TimelinePanel } from "@/components/terminal/TimelinePanel";
import { VoicePlaybackPanel } from "@/components/terminal/VoicePlaybackPanel";
import type { Citation, ConversationRecord, DocMeta, QueryTelemetry } from "@/components/terminal/types";
import { savantFetch } from "@/lib/api";
import { API_BASE_URL } from "@/lib/config";

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
      const res = await savantFetch("/chat/conversations");
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
    void (async () => {
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
  }, []);

  useEffect(() => {
    if (!storageReady || typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
  }, [conversations, storageReady]);

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId) ?? null,
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

    setConversations((previous) => {
      const index = previous.findIndex((conversation) => conversation.id === activeConversationId);
      if (index === -1) return previous;

      const conversation = previous[index];
      const autoTitle = conversation.logs.find((line) => line.startsWith("> Query initiated:"))?.replace("> Query initiated:", "Q:").slice(0, 70);
      const nextTitle = conversation.title === "New Chat" ? uploadedFileName || autoTitle || conversation.title : conversation.title;

      const same =
        conversation.title === nextTitle &&
        conversation.docId === docId &&
        conversation.fileName === uploadedFileName &&
        conversation.sessionId === sessionId &&
        conversation.logs === logs &&
        conversation.citations === citations &&
        conversation.telemetry === telemetry &&
        conversation.docMeta === docMeta;

      if (same) return previous;

      const next = [...previous];
      next[index] = {
        ...conversation,
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
        await savantFetch(`/chat/conversations/${activeConversationId}/state`, {
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
  }, [activeConversation, activeConversationId, storageReady]);

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

  const addLog = (message: string) => setLogs((previous) => [...previous, `> ${message}`]);

  const createConversation = () => {
    const next = newConversation();
    setConversations((previous) => [next, ...previous]);
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
    setConversations((previous) =>
      previous.map((conversation) =>
        conversation.id === conversationId ? { ...conversation, title: clean.slice(0, 120), updatedAt: Date.now() } : conversation
      )
    );
    setRenameConversationId(null);
    setRenameDraft("");
    try {
      await savantFetch(`/chat/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: clean }),
      });
    } catch {
      // local state already updated
    }
  };

  const deleteConversation = async (conversationId: string) => {
    const remaining = conversations.filter((conversation) => conversation.id !== conversationId);
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
      await savantFetch(`/chat/conversations/${conversationId}`, { method: "DELETE" });
    } catch {
      // local state still works
    }
  };

  const createSession = async (currentDocId?: string, title?: string) => {
    try {
      const res = await savantFetch("/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc_id: currentDocId, title }),
      });
      const data = await res.json();
      if (res.ok) {
        setSessionId(data.session_id);
        setShareUrl(`${API_BASE_URL}${data.share_url}`);
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
    if (
      voiceMode === "tts" &&
      typeof window !== "undefined" &&
      "speechSynthesis" in window &&
      window.speechSynthesis.speaking &&
      !window.speechSynthesis.paused
    ) {
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

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files || event.target.files.length === 0) return;

    const selectedFile = event.target.files[0];
    setUploadedFileName(selectedFile.name);
    addLog(`Selected document: ${selectedFile.name}`);

    setIsUploading(true);
    addLog("Uploading and vectorizing document in MongoDB Atlas...");

    const formData = new FormData();
    formData.append("file", selectedFile);

    try {
      const res = await savantFetch("/upload", {
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
      const res = await savantFetch("/query", {
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

  const handleQuerySubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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
    return conversations.filter((conversation) => {
      const haystack = `${conversation.title} ${conversation.fileName ?? ""} ${conversation.logs.slice(-2).join(" ")}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [conversations, searchTerm]);

  const timelineItems = useMemo(() => {
    return logs.map((line, index) => {
      const raw = line.replace(/^>\s*/, "");
      let tone: "info" | "success" | "warn" | "error" = "info";
      if (/failed|error/i.test(raw)) tone = "error";
      else if (/complete|generated|confirmed|copied|streaming|resumed|ready/i.test(raw)) tone = "success";
      else if (/tip|waiting|listening|uploading|searching|processing|paused/i.test(raw)) tone = "warn";
      return { id: `${index}-${raw.slice(0, 20)}`, raw, tone };
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
      <ConversationSidebar
        activeConversationId={activeConversationId}
        conversations={filteredConversations}
        graphStatusByConversation={graphStatusByConversation}
        renameConversationId={renameConversationId}
        renameDraft={renameDraft}
        searchTerm={searchTerm}
        onCreateConversation={createConversation}
        onDeleteConversation={(conversationId) => void deleteConversation(conversationId)}
        onRenameConversation={(conversationId, title) => void renameConversation(conversationId, title)}
        onRenameDraftChange={setRenameDraft}
        onRenameStart={(conversationId, title) => {
          setRenameConversationId(conversationId);
          setRenameDraft(title);
        }}
        onRenameCancel={() => {
          setRenameConversationId(null);
          setRenameDraft("");
        }}
        onSearchTermChange={setSearchTerm}
        onSelectConversation={setActiveConversationId}
      />

      <div className="flex flex-col h-full space-y-4 min-h-0">
        <TimelinePanel
          docMeta={docMeta}
          logScrollPercent={logScrollPercent}
          logsContainerRef={logsContainerRef}
          pipelineStatus={pipelineStatus}
          timelineItems={timelineItems}
          uploadedFileName={uploadedFileName}
          onLogScroll={handleLogScroll}
          onLogSliderChange={handleLogSlider}
        />

        {(isPlaying || isPaused) && (
          <VoicePlaybackPanel isPaused={isPaused} waveHeights={waveHeights} onPause={pauseVoice} onResume={resumeVoice} onStop={stopVoice} />
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

        <InsightsPanel citations={citations} telemetry={telemetry} />

        <div className="flex flex-col gap-4">
          <SuggestionsPanel
            docId={docId}
            isProcessing={isProcessing}
            isUploading={isUploading}
            suggestedQuestions={suggestedQuestions}
            onApplySuggestion={(suggestion) => void applySuggestedQuestion(suggestion)}
          />

          <QueryComposer
            canUseSpeech={canUseSpeech}
            docId={docId}
            isListening={isListening}
            isProcessing={isProcessing}
            isUploading={isUploading}
            pageNumber={pageNumber}
            query={query}
            shareUrl={shareUrl}
            uploadedFileName={uploadedFileName}
            onCopyShareLink={() => void copyShareLink()}
            onFileUpload={(event) => void handleFileUpload(event)}
            onPageNumberChange={setPageNumber}
            onQueryChange={setQuery}
            onStartVoiceInput={startVoiceInput}
            onSubmit={(event) => void handleQuerySubmit(event)}
          />
        </div>
      </div>
    </div>
  );
}
