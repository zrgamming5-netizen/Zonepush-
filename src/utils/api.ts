import type {
  ChatMessage,
  GeneratedVisual,
  StudyFlashcardsData,
  StudyQuizData,
  ThinkingDepth,
} from "../types/ai";

export async function fileToBase64(file: File): Promise<{ data: string; mimeType: string; previewUrl: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const commaIdx = result.indexOf(",");
      const data = commaIdx >= 0 ? result.slice(commaIdx + 1) : result;
      resolve({
        data,
        mimeType: file.type || "application/octet-stream",
        previewUrl: result,
      });
    };
    reader.onerror = () => reject(new Error("Failed to read selected file."));
    reader.readAsDataURL(file);
  });
}

export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const commaIdx = result.indexOf(",");
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error("Failed to read audio recording."));
    reader.readAsDataURL(blob);
  });
}

export async function streamChat(params: {
  messages: ChatMessage[];
  systemInstruction?: string;
  thinkingDepth?: ThinkingDepth;
  onChunk: (chunkText: string) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const payload = {
    messages: params.messages.map((m) => ({
      role: m.role,
      text: m.text,
      image: m.image ? { mimeType: m.image.mimeType, data: m.image.data } : undefined,
    })),
    systemInstruction: params.systemInstruction,
    thinkingDepth: params.thinkingDepth ?? "medium",
  };

  const response = await fetch("/api/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: params.signal,
  });

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Request failed with status ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n\n");
    buffer = lines.pop() ?? "";

    for (const block of lines) {
      const dataLine = block
        .split("\n")
        .find((line) => line.startsWith("data: "));
      if (!dataLine) continue;
      const jsonStr = dataLine.slice(6).trim();
      if (!jsonStr) continue;

      const parsed = JSON.parse(jsonStr) as { text?: string; error?: string; done?: boolean };
      if (parsed.error) {
        throw new Error(parsed.error);
      }
      if (parsed.text) {
        params.onChunk(parsed.text);
      }
    }
  }
}

export async function generateStudyInteractive(params: {
  topic: string;
  mode: "quiz" | "flashcards";
  subject: string;
  difficulty: string;
  image?: { mimeType: string; data: string };
}): Promise<{ mode: "quiz"; data: StudyQuizData } | { mode: "flashcards"; data: StudyFlashcardsData }> {
  const response = await fetch("/api/study/interactive", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(json.error || "Failed to generate study material.");
  }
  return json;
}

export async function generateVisual(params: {
  prompt: string;
  style: string;
  aspectRatio: "1:1" | "16:9" | "4:3" | "9:16";
}): Promise<Omit<GeneratedVisual, "id" | "prompt" | "createdAt">> {
  const response = await fetch("/api/visual/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(json.error || "Failed to generate visual.");
  }
  return json;
}

export async function translateText(params: {
  text: string;
  sourceLang: string;
  targetLang: string;
  tone: string;
}): Promise<{
  translatedText: string;
  detectedSourceLanguage: string;
  transliteration: string;
  usageNote: string;
}> {
  const response = await fetch("/api/translate/text", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(json.error || "Text translation failed.");
  }
  return json;
}

export async function transcribeAudio(params: {
  audioBase64: string;
  mimeType: string;
}): Promise<string> {
  const response = await fetch("/api/audio/transcribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(json.error || "Audio transcription failed.");
  }
  return json.transcript as string;
}

export async function translateAudio(params: {
  audioBase64: string;
  mimeType: string;
  sourceLang: string;
  targetLang: string;
  tone: string;
}): Promise<{
  transcript: string;
  translatedText: string;
  detectedSourceLanguage: string;
  transliteration: string;
  usageNote: string;
}> {
  const response = await fetch("/api/translate/audio", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(json.error || "Audio translation failed.");
  }
  return json;
}

export async function synthesizeSpeech(params: {
  text: string;
  voiceName?: string;
  style?: string;
}): Promise<string> {
  const response = await fetch("/api/audio/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(json.error || "Speech generation failed.");
  }
  return `data:${json.mimeType || "audio/wav"};base64,${json.audioBase64}`;
}
