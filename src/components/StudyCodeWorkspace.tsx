import { useState } from "react";
import {
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Code2,
  Download,
  ImagePlus,
  Loader2,
  RotateCw,
  Volume2,
  X,
  XCircle,
} from "lucide-react";
import type { ImageAttachment, StudyFlashcardsData, StudyQuizData } from "../types/ai";
import {
  fileToBase64,
  generateStudyInteractive,
  streamChat,
  synthesizeSpeech,
} from "../utils/api";
import { MarkdownRenderer } from "./MarkdownRenderer";

type LabMode = "study" | "code";
type StudyOutputType = "explain" | "quiz" | "flashcards" | "summary";
type CodeAction = "write" | "debug" | "explain" | "optimize";

const SUBJECTS = [
  "Mathematics",
  "Physics",
  "Chemistry",
  "Biology",
  "Computer Science",
  "History & Polity",
  "English & Grammar",
  "Competitive Exams",
];

const LANGUAGES = [
  "Python",
  "TypeScript / JavaScript",
  "Kotlin (Android)",
  "Java",
  "C++",
  "SQL",
  "HTML / CSS",
];

export function StudyCodeWorkspace() {
  const [labMode, setLabMode] = useState<LabMode>("study");

  // Study states
  const [subject, setSubject] = useState("Mathematics");
  const [difficulty, setDifficulty] = useState("High School");
  const [studyOutput, setStudyOutput] = useState<StudyOutputType>("explain");
  const [studyPrompt, setStudyPrompt] = useState("");
  const [studyImage, setStudyImage] = useState<ImageAttachment | null>(null);
  const [studyMarkdown, setStudyMarkdown] = useState("");
  const [quizData, setQuizData] = useState<StudyQuizData | null>(null);
  const [quizAnswers, setQuizAnswers] = useState<Record<number, number>>({});
  const [flashcardsData, setFlashcardsData] = useState<StudyFlashcardsData | null>(null);
  const [cardIndex, setCardIndex] = useState(0);
  const [isCardFlipped, setIsCardFlipped] = useState(false);

  // Code states
  const [codeLang, setCodeLang] = useState("Python");
  const [codeAction, setCodeAction] = useState<CodeAction>("write");
  const [codePrompt, setCodePrompt] = useState("");
  const [codeOutput, setCodeOutput] = useState("");

  // Shared loading / error / audio
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const handleImagePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const converted = await fileToBase64(file);
      setStudyImage({
        ...converted,
        name: file.name,
      });
      setErrorMsg(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Could not attach image.");
    }
  };

  const handleRunStudy = async () => {
    if (!studyPrompt.trim() && !studyImage) {
      setErrorMsg("Enter a topic, question, or attach a photo of your notes.");
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);

    try {
      if (studyOutput === "quiz" || studyOutput === "flashcards") {
        setStudyMarkdown("");
        const result = await generateStudyInteractive({
          topic: studyPrompt.trim(),
          mode: studyOutput,
          subject,
          difficulty,
          image: studyImage ? { mimeType: studyImage.mimeType, data: studyImage.data } : undefined,
        });

        if (result.mode === "quiz") {
          setFlashcardsData(null);
          setQuizData(result.data);
          setQuizAnswers({});
        } else {
          setQuizData(null);
          setFlashcardsData(result.data);
          setCardIndex(0);
          setIsCardFlipped(false);
        }
      } else {
        setQuizData(null);
        setFlashcardsData(null);
        setStudyMarkdown("");

        const instruction =
          studyOutput === "explain"
            ? `You are a patient, crystal-clear tutor for ${subject} (${difficulty} level). Break concepts down step-by-step with intuition, formulas/examples, and common mistakes to avoid. Match the user's language (English, Hindi, or Hinglish).`
            : `You are an expert study assistant for ${subject} (${difficulty} level). Create clean, structured revision notes with key definitions, formulas, and bullet-point takeaways.`;

        let acc = "";
        await streamChat({
          messages: [
            {
              id: "study_1",
              role: "user",
              text: studyPrompt.trim() || "Explain and solve the attached study material step by step.",
              image: studyImage
                ? { mimeType: studyImage.mimeType, data: studyImage.data }
                : undefined,
              createdAt: Date.now(),
            },
          ],
          systemInstruction: instruction,
          thinkingDepth: "high",
          onChunk: (chunk) => {
            acc += chunk;
            setStudyMarkdown(acc);
          },
        });
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Study generation failed.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRunCode = async () => {
    if (!codePrompt.trim()) {
      setErrorMsg("Describe what you want to build or paste code to debug/explain.");
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);
    setCodeOutput("");

    const actionGuides: Record<CodeAction, string> = {
      write: `Write clean, production-ready ${codeLang} code with brief comments and usage example.`,
      debug: `Identify every bug or edge case in the ${codeLang} code below, explain why it fails, and provide the corrected complete code.`,
      explain: `Explain this ${codeLang} code clearly line-by-line, covering time/space complexity and key concepts.`,
      optimize: `Refactor and optimize this ${codeLang} code for readability, performance, and best practices.`,
    };

    try {
      let acc = "";
      await streamChat({
        messages: [
          {
            id: "code_1",
            role: "user",
            text: `${actionGuides[codeAction]}\n\n${codePrompt.trim()}`,
            createdAt: Date.now(),
          },
        ],
        systemInstruction:
          "You are a senior software engineer and coding mentor. Provide accurate, runnable code in fenced markdown blocks and concise technical explanations.",
        thinkingDepth: "high",
        onChunk: (chunk) => {
          acc += chunk;
          setCodeOutput(acc);
        },
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Code assistant request failed.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleListenStudy = async () => {
    if (!studyMarkdown.trim()) return;
    setIsSpeaking(true);
    setErrorMsg(null);
    try {
      const clean = studyMarkdown.replace(/```[\s\S]*?```/g, " Code omitted. ").replace(/[#*_`]/g, "");
      const url = await synthesizeSpeech({ text: clean.slice(0, 1500), voiceName: "Kore" });
      const audio = new Audio(url);
      audio.onended = () => setIsSpeaking(false);
      audio.onerror = () => setIsSpeaking(false);
      await audio.play();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Audio playback failed.");
      setIsSpeaking(false);
    }
  };

  const handleDownloadCode = () => {
    if (!codeOutput.trim()) return;
    const blob = new Blob([codeOutput], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `monarch-code-${codeLang.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const quizScore = quizData
    ? quizData.questions.reduce(
        (acc, q, idx) => (quizAnswers[idx] === q.correctIndex ? acc + 1 : acc),
        0
      )
    : 0;

  return (
    <div className="h-full overflow-y-auto px-4 sm:px-6 py-5 bg-slate-50 dark:bg-[#0B0F17]">
      <div className="max-w-5xl mx-auto space-y-5">
        {/* Header & Mode Switch */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">
              Study &amp; Coding Lab
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Interactive quizzes, flashcards, homework help, and multi-language code engineering.
            </p>
          </div>

          <div className="inline-flex p-1 rounded-xl bg-slate-200/70 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 self-start">
            <button
              type="button"
              onClick={() => {
                setLabMode("study");
                setErrorMsg(null);
              }}
              className={`inline-flex items-center gap-2 min-h-[40px] px-4 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer whitespace-nowrap ${
                labMode === "study"
                  ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              <BookOpen className="w-4 h-4" />
              <span>Study Tutor</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setLabMode("code");
                setErrorMsg(null);
              }}
              className={`inline-flex items-center gap-2 min-h-[40px] px-4 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer whitespace-nowrap ${
                labMode === "code"
                  ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              <Code2 className="w-4 h-4" />
              <span>Coding Studio</span>
            </button>
          </div>
        </div>

        {errorMsg && (
          <div className="flex items-center justify-between gap-3 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 px-4 py-3 text-sm text-red-700 dark:text-red-300">
            <span>{errorMsg}</span>
            <button
              type="button"
              onClick={() => setErrorMsg(null)}
              aria-label="Dismiss error"
              className="p-1 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {labMode === "study" ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* Study Controls */}
            <div className="lg:col-span-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131926] p-4 sm:p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                    Subject
                  </label>
                  <select
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600/40"
                  >
                    {SUBJECTS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                    Level
                  </label>
                  <select
                    value={difficulty}
                    onChange={(e) => setDifficulty(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600/40"
                  >
                    <option value="School">School</option>
                    <option value="High School">High School</option>
                    <option value="College">College</option>
                    <option value="Competitive">Competitive Exam</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                  Study Format
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      { id: "explain", label: "Step-by-Step" },
                      { id: "quiz", label: "Practice Quiz" },
                      { id: "flashcards", label: "Flashcards" },
                      { id: "summary", label: "Revision Notes" },
                    ] as const
                  ).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setStudyOutput(item.id)}
                      className={`min-h-[42px] px-3 py-2 rounded-xl text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap ${
                        studyOutput === item.id
                          ? "border-blue-600 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300"
                          : "border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                  Topic, Question, or Chapter
                </label>
                <textarea
                  value={studyPrompt}
                  onChange={(e) => setStudyPrompt(e.target.value)}
                  rows={4}
                  placeholder="e.g., Newton's laws of motion, Organic chemistry reactions, or paste a question in English/Hinglish..."
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/40"
                />
              </div>

              <div className="flex items-center justify-between gap-3">
                <label className="inline-flex items-center gap-2 min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap">
                  <ImagePlus className="w-4 h-4" />
                  <span>{studyImage ? "Change Photo" : "Attach Notes Photo"}</span>
                  <input type="file" accept="image/*" onChange={handleImagePick} className="hidden" />
                </label>

                {studyImage && (
                  <button
                    type="button"
                    onClick={() => setStudyImage(null)}
                    className="text-xs text-red-600 dark:text-red-400 hover:underline cursor-pointer"
                  >
                    Remove
                  </button>
                )}
              </div>

              {studyImage && (
                <img
                  src={studyImage.previewUrl}
                  alt="Attached study page"
                  className="max-h-36 rounded-xl object-contain border border-slate-200 dark:border-slate-700"
                />
              )}

              <button
                type="button"
                onClick={handleRunStudy}
                disabled={isLoading}
                className="w-full min-h-[46px] rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Preparing Study Session...</span>
                  </>
                ) : (
                  <span>Generate Study Material</span>
                )}
              </button>
            </div>

            {/* Study Output Canvas */}
            <div className="lg:col-span-7 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131926] p-4 sm:p-6 min-h-[360px]">
              {!studyMarkdown && !quizData && !flashcardsData && !isLoading && (
                <div className="h-full min-h-[300px] flex flex-col items-center justify-center text-center px-4">
                  <BookOpen className="w-8 h-8 text-slate-400 mb-3" />
                  <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                    Ready for your study session
                  </h2>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400 max-w-sm">
                    Pick a subject and format on the left to generate step-by-step explanations, interactive MCQs, or flippable revision cards.
                  </p>
                </div>
              )}

              {isLoading && !studyMarkdown && (
                <div className="min-h-[300px] flex items-center justify-center gap-2.5 text-sm text-slate-500 dark:text-slate-400">
                  <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
                  <span>Crafting your study material...</span>
                </div>
              )}

              {studyMarkdown && (
                <div>
                  <div className="flex items-center justify-between gap-3 pb-3 mb-4 border-b border-slate-200 dark:border-slate-800">
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                      {subject} · {difficulty}
                    </span>
                    <button
                      type="button"
                      onClick={handleListenStudy}
                      disabled={isSpeaking}
                      className="inline-flex items-center gap-1.5 min-h-[36px] px-3 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                      <span>{isSpeaking ? "Playing..." : "Listen"}</span>
                    </button>
                  </div>
                  <MarkdownRenderer content={studyMarkdown} />
                </div>
              )}

              {quizData && (
                <div className="space-y-5">
                  <div className="flex items-center justify-between gap-4 pb-3 border-b border-slate-200 dark:border-slate-800">
                    <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                      {quizData.title}
                    </h2>
                    <span className="text-xs font-semibold tabular-nums text-blue-600 dark:text-blue-400">
                      Score: {quizScore} / {quizData.questions.length}
                    </span>
                  </div>

                  {quizData.questions.map((q, qIdx) => {
                    const picked = quizAnswers[qIdx];
                    const hasAnswered = picked !== undefined;
                    return (
                      <div
                        key={qIdx}
                        className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 space-y-3"
                      >
                        <div className="text-sm font-semibold text-slate-900 dark:text-white">
                          {qIdx + 1}. {q.question}
                        </div>
                        <div className="space-y-2">
                          {q.options.map((opt, optIdx) => {
                            const isSelected = picked === optIdx;
                            const isCorrect = q.correctIndex === optIdx;
                            let stateStyle =
                              "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:border-blue-500";
                            if (hasAnswered) {
                              if (isCorrect) {
                                stateStyle =
                                  "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200";
                              } else if (isSelected) {
                                stateStyle =
                                  "border-red-500 bg-red-50 dark:bg-red-950/40 text-red-900 dark:text-red-200";
                              }
                            }
                            return (
                              <button
                                key={optIdx}
                                type="button"
                                disabled={hasAnswered}
                                onClick={() =>
                                  setQuizAnswers((prev) => ({ ...prev, [qIdx]: optIdx }))
                                }
                                className={`w-full text-left min-h-[44px] px-3.5 py-2.5 rounded-xl border text-sm flex items-center justify-between gap-2 transition-colors cursor-pointer disabled:cursor-default ${stateStyle}`}
                              >
                                <span>{opt}</span>
                                {hasAnswered && isCorrect && (
                                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                                )}
                                {hasAnswered && isSelected && !isCorrect && (
                                  <XCircle className="w-4 h-4 text-red-600 shrink-0" />
                                )}
                              </button>
                            );
                          })}
                        </div>
                        {hasAnswered && (
                          <div className="text-xs text-slate-600 dark:text-slate-300 pt-1">
                            <span className="font-semibold">Explanation:</span> {q.explanation}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {flashcardsData && flashcardsData.cards.length > 0 && (
                <div className="space-y-5">
                  <div className="flex items-center justify-between gap-4 pb-3 border-b border-slate-200 dark:border-slate-800">
                    <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                      {flashcardsData.title}
                    </h2>
                    <span className="text-xs font-medium tabular-nums text-slate-500 dark:text-slate-400">
                      Card {cardIndex + 1} of {flashcardsData.cards.length}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => setIsCardFlipped((f) => !f)}
                    className="w-full min-h-[220px] p-6 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 flex flex-col items-center justify-center text-center cursor-pointer transition-colors hover:border-blue-500/60"
                  >
                    <div className="text-xs font-medium text-blue-600 dark:text-blue-400 mb-3">
                      {isCardFlipped ? "Answer" : "Prompt · Tap to flip"}
                    </div>
                    <div className="font-display text-lg font-semibold text-slate-900 dark:text-white max-w-md leading-relaxed">
                      {isCardFlipped
                        ? flashcardsData.cards[cardIndex].back
                        : flashcardsData.cards[cardIndex].front}
                    </div>
                    {!isCardFlipped && flashcardsData.cards[cardIndex].hint && (
                      <div className="mt-4 text-xs text-slate-500 dark:text-slate-400">
                        Hint: {flashcardsData.cards[cardIndex].hint}
                      </div>
                    )}
                  </button>

                  <div className="flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setCardIndex((i) => Math.max(0, i - 1));
                        setIsCardFlipped(false);
                      }}
                      disabled={cardIndex === 0}
                      className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-200 disabled:opacity-40 cursor-pointer"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      <span>Previous</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setIsCardFlipped((f) => !f)}
                      className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-xl bg-slate-100 dark:bg-slate-800 text-sm font-medium text-slate-800 dark:text-slate-200 cursor-pointer"
                    >
                      <RotateCw className="w-4 h-4" />
                      <span>Flip Card</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setCardIndex((i) =>
                          Math.min(flashcardsData.cards.length - 1, i + 1)
                        );
                        setIsCardFlipped(false);
                      }}
                      disabled={cardIndex === flashcardsData.cards.length - 1}
                      className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-200 disabled:opacity-40 cursor-pointer"
                    >
                      <span>Next</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Coding Studio */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            <div className="lg:col-span-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131926] p-4 sm:p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                  Language / Stack
                </label>
                <select
                  value={codeLang}
                  onChange={(e) => setCodeLang(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600/40"
                >
                  {LANGUAGES.map((lang) => (
                    <option key={lang} value={lang}>
                      {lang}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                  Task Mode
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      { id: "write", label: "Write Code" },
                      { id: "debug", label: "Debug & Fix" },
                      { id: "explain", label: "Explain Logic" },
                      { id: "optimize", label: "Optimize" },
                    ] as const
                  ).map((act) => (
                    <button
                      key={act.id}
                      type="button"
                      onClick={() => setCodeAction(act.id)}
                      className={`min-h-[42px] px-3 py-2 rounded-xl text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap ${
                        codeAction === act.id
                          ? "border-blue-600 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300"
                          : "border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                      }`}
                    >
                      {act.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                  Problem Description or Code Snippet
                </label>
                <textarea
                  value={codePrompt}
                  onChange={(e) => setCodePrompt(e.target.value)}
                  rows={8}
                  placeholder={`Paste your ${codeLang} code or describe what function/app component you want to build...`}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3.5 py-2.5 text-[13px] font-mono text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/40"
                />
              </div>

              <button
                type="button"
                onClick={handleRunCode}
                disabled={isLoading}
                className="w-full min-h-[46px] rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Running Code Analysis...</span>
                  </>
                ) : (
                  <span>Run in Coding Studio</span>
                )}
              </button>
            </div>

            <div className="lg:col-span-7 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131926] p-4 sm:p-6 min-h-[360px]">
              {!codeOutput && !isLoading ? (
                <div className="h-full min-h-[300px] flex flex-col items-center justify-center text-center px-4">
                  <Code2 className="w-8 h-8 text-slate-400 mb-3" />
                  <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                    Engineering &amp; Debugging Workspace
                  </h2>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400 max-w-sm">
                    Generate algorithms, Android Kotlin screens, Python scripts, or debug tricky stack traces with copyable code blocks.
                  </p>
                </div>
              ) : (
                <div>
                  <div className="flex items-center justify-between gap-3 pb-3 mb-4 border-b border-slate-200 dark:border-slate-800">
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                      {codeLang} · {codeAction}
                    </span>
                    {codeOutput && (
                      <button
                        type="button"
                        onClick={handleDownloadCode}
                        className="inline-flex items-center gap-1.5 min-h-[36px] px-3 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download</span>
                      </button>
                    )}
                  </div>
                  {codeOutput ? (
                    <MarkdownRenderer content={codeOutput} />
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-slate-500">
                      <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                      <span>Writing solution...</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
