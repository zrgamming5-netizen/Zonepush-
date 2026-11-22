import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Check,
  Copy,
  ImagePlus,
  Loader2,
  MessageSquare,
  Plus,
  Square,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import type { ChatMessage, ChatSession, ImageAttachment, ThinkingDepth } from "../types/ai";
import {
  blobToBase64,
  fileToBase64,
  streamChat,
  synthesizeSpeech,
  transcribeAudio,
} from "../utils/api";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { VoiceRecorderButton } from "./VoiceRecorderButton";

interface ChatWorkspaceProps {
  sessions: ChatSession[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  onCreateSession: () => void;
  onDeleteSession: (id: string) => void;
  onUpdateSessionMessages: (sessionId: string, messages: ChatMessage[], title?: string) => void;
  onQuickNavigate: (tab: "study" | "visual" | "translate") => void;
}

const STARTER_PROMPTS = [
  {
    title: "Solve & explain math",
    subtitle: "Quadratic equations step by step in simple Hindi + English",
    prompt: "Explain quadratic equations step by step with 2 solved examples in simple Hinglish.",
  },
  {
    title: "Debug or write code",
    subtitle: "Build a clean REST API endpoint in Node.js and TypeScript",
    prompt: "Write a clean TypeScript Express route with input validation and error handling.",
  },
  {
    title: "Exam revision plan",
    subtitle: "7-day focused study schedule with active recall blocks",
    prompt: "Create a realistic 7-day study timetable for computer science exams with daily revision slots.",
  },
  {
    title: "Translate & summarize",
    subtitle: "Turn long notes into clear bilingual bullet points",
    prompt: "Summarize how photosynthesis works in 5 clear bullet points, then translate the summary into Hindi.",
  },
];

export function ChatWorkspace({
  sessions,
  activeSessionId,
  onSelectSession,
  onCreateSession,
  onDeleteSession,
  onUpdateSessionMessages,
  onQuickNavigate,
}: ChatWorkspaceProps) {
  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? sessions[0];
  const messages = activeSession?.messages ?? [];

  const [input, setInput] = useState("");
  const [attachment, setAttachment] = useState<ImageAttachment | null>(null);
  const [thinkingDepth, setThinkingDepth] = useState<ThinkingDepth>("medium");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [playingMsgId, setPlayingMsgId] = useState<string | null>(null);
  const [loadingTtsId, setLoadingTtsId] = useState<string | null>(null);
  const [showMobileHistory, setShowMobileHistory] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, isStreaming]);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  const handleImagePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setErrorMsg("Please select an image file (PNG, JPG, WebP).");
      return;
    }
    try {
      const converted = await fileToBase64(file);
      setAttachment({
        data: converted.data,
        mimeType: converted.mimeType,
        previewUrl: converted.previewUrl,
        name: file.name,
      });
      setErrorMsg(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Could not attach image.");
    }
  };

  const handleVoiceRecorded = async (blob: Blob, mimeType: string) => {
    setIsTranscribing(true);
    setErrorMsg(null);
    try {
      const base64 = await blobToBase64(blob);
      const transcript = await transcribeAudio({ audioBase64: base64, mimeType });
      if (transcript) {
        setInput((prev) => (prev.trim() ? `${prev.trim()} ${transcript}` : transcript));
        textareaRef.current?.focus();
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Voice transcription failed.");
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleSend = async (overridePrompt?: string) => {
    const textToSend = (overridePrompt ?? input).trim();
    if (!textToSend && !attachment) return;
    if (isStreaming || !activeSession) return;

    setErrorMsg(null);
    const userMessage: ChatMessage = {
      id: `u_${Date.now()}`,
      role: "user",
      text: textToSend || "Please analyze this image.",
      image: attachment
        ? {
            mimeType: attachment.mimeType,
            data: attachment.data,
            previewUrl: attachment.previewUrl,
          }
        : undefined,
      createdAt: Date.now(),
    };

    const assistantId = `m_${Date.now() + 1}`;
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: "model",
      text: "",
      createdAt: Date.now() + 1,
    };

    const isFirstUserTurn = messages.length === 0;
    const derivedTitle = isFirstUserTurn
      ? (textToSend || attachment?.name || "New conversation").slice(0, 40)
      : undefined;

    const historyWithUser = [...messages, userMessage];
    onUpdateSessionMessages(
      activeSession.id,
      [...historyWithUser, assistantMessage],
      derivedTitle
    );

    if (!overridePrompt) {
      setInput("");
      setAttachment(null);
    }

    setIsStreaming(true);
    const controller = new AbortController();
    abortControllerRef.current = controller;

    let accumulated = "";
    try {
      await streamChat({
        messages: historyWithUser,
        thinkingDepth,
        signal: controller.signal,
        onChunk: (chunk) => {
          accumulated += chunk;
          onUpdateSessionMessages(activeSession.id, [
            ...historyWithUser,
            { ...assistantMessage, text: accumulated },
          ]);
        },
      });
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        const message = err instanceof Error ? err.message : "Response failed.";
        setErrorMsg(message);
        if (!accumulated) {
          onUpdateSessionMessages(activeSession.id, [
            ...historyWithUser,
            {
              ...assistantMessage,
              text: `Could not complete response: ${message}`,
            },
          ]);
        }
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  };

  const handleStopStream = () => {
    abortControllerRef.current?.abort();
    setIsStreaming(false);
  };

  const handleCopy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMsgId(id);
      window.setTimeout(() => setCopiedMsgId(null), 1800);
    } catch {
      // Ignore clipboard restriction
    }
  };

  const handleReadAloud = async (id: string, text: string) => {
    if (playingMsgId === id) {
      audioRef.current?.pause();
      setPlayingMsgId(null);
      return;
    }
    audioRef.current?.pause();
    setLoadingTtsId(id);
    setErrorMsg(null);
    try {
      const plainText = text.replace(/```[\s\S]*?```/g, " Code block omitted. ").replace(/[#*_`]/g, "");
      const audioUrl = await synthesizeSpeech({ text: plainText.slice(0, 1500), voiceName: "Kore" });
      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      audio.onended = () => setPlayingMsgId(null);
      audio.onerror = () => setPlayingMsgId(null);
      setPlayingMsgId(id);
      await audio.play();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Voice playback failed.");
    } finally {
      setLoadingTtsId(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 bg-slate-50 dark:bg-[#0B0F17]">
      {/* Desktop Conversation Sidebar */}
      <aside className="hidden lg:flex flex-col w-68 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101622] p-3">
        <button
          type="button"
          onClick={onCreateSession}
          className="flex items-center justify-center gap-2 w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap"
        >
          <Plus className="w-4 h-4" />
          <span>New Chat</span>
        </button>

        <div className="mt-4 mb-2 px-2 text-xs font-medium text-slate-500 dark:text-slate-400">
          Recent Conversations
        </div>

        <div className="flex-1 overflow-y-auto space-y-1">
          {sessions.map((session) => {
            const isActive = session.id === activeSession?.id;
            return (
              <div
                key={session.id}
                className={`group flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 min-h-[44px] transition-colors ${
                  isActive
                    ? "bg-slate-100 dark:bg-slate-800/90 text-slate-900 dark:text-white font-medium"
                    : "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelectSession(session.id)}
                  className="flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer"
                >
                  <MessageSquare className="w-4 h-4 shrink-0 opacity-70" />
                  <span className="truncate text-sm">{session.title}</span>
                </button>
                {sessions.length > 1 && (
                  <button
                    type="button"
                    onClick={() => onDeleteSession(session.id)}
                    aria-label="Delete conversation"
                    className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1.5 rounded-lg text-slate-400 hover:text-red-500 transition-opacity cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </aside>

      {/* Main Chat Canvas */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Sub-toolbar */}
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-slate-200/80 dark:border-slate-800/80 bg-white/70 dark:bg-[#0B0F17]/80 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowMobileHistory((v) => !v)}
              className="lg:hidden inline-flex items-center gap-1.5 min-h-[38px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer whitespace-nowrap"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>History ({sessions.length})</span>
            </button>
            <button
              type="button"
              onClick={onCreateSession}
              className="lg:hidden inline-flex items-center gap-1 min-h-[38px] px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New</span>
            </button>
            <span className="hidden sm:inline text-xs text-slate-500 dark:text-slate-400">
              Model: Gemini 4 Hydrogen · Vision &amp; Voice Ready
            </span>
          </div>

          <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800">
            {(["low", "medium", "high"] as const).map((depth) => (
              <button
                key={depth}
                type="button"
                onClick={() => setThinkingDepth(depth)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  thinkingDepth === depth
                    ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                {depth === "low" ? "Fast" : depth === "medium" ? "Balanced" : "Deep"}
              </button>
            ))}
          </div>
        </div>

        {/* Mobile History Drawer */}
        {showMobileHistory && (
          <div className="lg:hidden border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101622] px-4 py-3 space-y-1.5 max-h-56 overflow-y-auto">
            {sessions.map((session) => (
              <div
                key={session.id}
                className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 bg-slate-50 dark:bg-slate-800/60"
              >
                <button
                  type="button"
                  onClick={() => {
                    onSelectSession(session.id);
                    setShowMobileHistory(false);
                  }}
                  className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate flex-1 text-left cursor-pointer"
                >
                  {session.title}
                </button>
                {sessions.length > 1 && (
                  <button
                    type="button"
                    onClick={() => onDeleteSession(session.id)}
                    aria-label="Delete chat"
                    className="p-1.5 text-slate-400 hover:text-red-500 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Messages Feed */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6">
          <div className="max-w-3xl mx-auto">
            {messages.length === 0 ? (
              <div className="py-6 sm:py-12">
                <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white text-balance">
                  Ask anything, study smarter, or build faster
                </h1>
                <p className="mt-2 text-sm sm:text-base text-slate-600 dark:text-slate-400 max-w-xl leading-relaxed">
                  Chat in English, Hindi, or Hinglish. Attach photos of homework or code, speak with your microphone, or switch to dedicated studios below.
                </p>

                <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {STARTER_PROMPTS.map((item) => (
                    <button
                      key={item.title}
                      type="button"
                      onClick={() => handleSend(item.prompt)}
                      className="text-left p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131926] hover:border-blue-500/50 dark:hover:border-blue-500/50 transition-colors cursor-pointer"
                    >
                      <div className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                        {item.title}
                      </div>
                      <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                        {item.subtitle}
                      </div>
                    </button>
                  ))}
                </div>

                <div className="mt-6 pt-6 border-t border-slate-200/80 dark:border-slate-800/80 flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                  <span>Quick workspaces:</span>
                  <button
                    type="button"
                    onClick={() => onQuickNavigate("study")}
                    className="font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer min-h-[36px] px-1"
                  >
                    Open Study &amp; Code Lab
                  </button>
                  <span aria-hidden="true">·</span>
                  <button
                    type="button"
                    onClick={() => onQuickNavigate("visual")}
                    className="font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer min-h-[36px] px-1"
                  >
                    Open Visual Studio
                  </button>
                  <span aria-hidden="true">·</span>
                  <button
                    type="button"
                    onClick={() => onQuickNavigate("translate")}
                    className="font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer min-h-[36px] px-1"
                  >
                    Open Voice &amp; Text Translator
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                {messages.map((msg) => {
                  const isUser = msg.role === "user";
                  return (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}
                    >
                      <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5 px-1">
                        {isUser ? "You" : "Monarch AI"}
                      </div>

                      <div
                        className={`rounded-2xl px-4 py-3 max-w-[92%] sm:max-w-[85%] ${
                          isUser
                            ? "bg-blue-600 text-white"
                            : "bg-white dark:bg-[#131926] border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 w-full sm:w-auto"
                        }`}
                      >
                        {msg.image && (
                          <img
                            src={
                              msg.image.previewUrl ||
                              `data:${msg.image.mimeType};base64,${msg.image.data}`
                            }
                            alt="Uploaded visual context"
                            referrerPolicy="no-referrer"
                            className="max-h-60 rounded-xl mb-2.5 object-contain border border-white/15"
                          />
                        )}
                        {isUser ? (
                          <p className="text-[15px] leading-relaxed whitespace-pre-wrap">
                            {msg.text}
                          </p>
                        ) : msg.text ? (
                          <MarkdownRenderer content={msg.text} />
                        ) : (
                          <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 py-1">
                            <Loader2 className="w-4 h-4 animate-spin text-blue-600 dark:text-blue-400" />
                            <span>Thinking...</span>
                          </div>
                        )}
                      </div>

                      {!isUser && msg.text && (
                        <div className="flex items-center gap-2 mt-1.5 px-1">
                          <button
                            type="button"
                            onClick={() => handleCopy(msg.id, msg.text)}
                            className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white min-h-[36px] px-2 rounded-lg transition-colors cursor-pointer"
                          >
                            {copiedMsgId === msg.id ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-emerald-500" />
                                <span>Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5" />
                                <span>Copy</span>
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleReadAloud(msg.id, msg.text)}
                            disabled={loadingTtsId === msg.id}
                            className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white min-h-[36px] px-2 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                          >
                            {loadingTtsId === msg.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Volume2 className="w-3.5 h-3.5" />
                            )}
                            <span>{playingMsgId === msg.id ? "Stop Audio" : "Listen"}</span>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
                <div ref={scrollAnchorRef} />
              </div>
            )}
          </div>
        </div>

        {/* Composer Area */}
        <div className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101622] px-3 sm:px-6 py-3">
          <div className="max-w-3xl mx-auto">
            {errorMsg && (
              <div className="mb-2.5 flex items-center justify-between gap-3 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 px-3.5 py-2 text-xs text-red-700 dark:text-red-300">
                <span>{errorMsg}</span>
                <button
                  type="button"
                  onClick={() => setErrorMsg(null)}
                  aria-label="Dismiss error"
                  className="p-1 hover:opacity-75 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {attachment && (
              <div className="mb-2.5 inline-flex items-center gap-2.5 p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                <img
                  src={attachment.previewUrl}
                  alt={attachment.name}
                  className="w-11 h-11 rounded-lg object-cover"
                />
                <span className="text-xs text-slate-700 dark:text-slate-300 max-w-[180px] truncate">
                  {attachment.name}
                </span>
                <button
                  type="button"
                  onClick={() => setAttachment(null)}
                  aria-label="Remove image"
                  className="p-1.5 rounded-lg text-slate-500 hover:text-red-500 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            <div className="flex items-end gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImagePick}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isStreaming}
                aria-label="Attach photo"
                title="Attach photo or homework image"
                className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer shrink-0 disabled:opacity-50"
              >
                <ImagePlus className="w-4 h-4" />
              </button>

              <VoiceRecorderButton
                onRecorded={handleVoiceRecorded}
                isProcessing={isTranscribing}
                disabled={isStreaming}
                onError={(msg) => setErrorMsg(msg)}
              />

              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={
                  isTranscribing
                    ? "Transcribing your voice..."
                    : "Message Monarch AI (English, Hindi, Hinglish, Code)..."
                }
                rows={1}
                className="flex-1 min-h-[44px] max-h-36 resize-y rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/40"
              />

              {isStreaming ? (
                <button
                  type="button"
                  onClick={handleStopStream}
                  aria-label="Stop response"
                  className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 transition-colors cursor-pointer shrink-0"
                >
                  <Square className="w-4 h-4 fill-current" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleSend()}
                  disabled={!input.trim() && !attachment}
                  aria-label="Send message"
                  className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white transition-colors cursor-pointer shrink-0"
                >
                  <ArrowUp className="w-5 h-5" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
