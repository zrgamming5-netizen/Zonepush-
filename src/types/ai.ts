export type AppTab = "chat" | "study" | "visual" | "translate";

export type ThinkingDepth = "low" | "medium" | "high";

export interface ImageAttachment {
  mimeType: string;
  data: string; // base64 without data URL prefix
  previewUrl: string;
  name: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "model";
  text: string;
  image?: {
    mimeType: string;
    data: string;
    previewUrl?: string;
  };
  createdAt: number;
}

export interface ChatSession {
  id: string;
  title: string;
  updatedAt: number;
  messages: ChatMessage[];
}

export interface QuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export interface StudyQuizData {
  title: string;
  questions: QuizQuestion[];
}

export interface FlashcardItem {
  front: string;
  back: string;
  hint: string;
}

export interface StudyFlashcardsData {
  title: string;
  cards: FlashcardItem[];
}

export interface GeneratedVisual {
  id: string;
  title: string;
  description: string;
  palette: string[];
  svg: string;
  width: number;
  height: number;
  aspectRatio: "1:1" | "16:9" | "4:3" | "9:16";
  style: string;
  prompt: string;
  createdAt: number;
}

export interface TranslationResult {
  id: string;
  sourceText: string;
  translatedText: string;
  detectedSourceLanguage: string;
  targetLang: string;
  transliteration: string;
  usageNote: string;
  mode: "text" | "audio";
  createdAt: number;
}
