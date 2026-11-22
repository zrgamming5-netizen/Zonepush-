import dotenv from "dotenv";
dotenv.config();

import express, { type Request, type Response } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const isDev = process.argv.includes("--dev") || process.env.NODE_ENV === "development";

function getAIClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured. Check your Settings > Secrets panel.");
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

function formatApiError(err: unknown): { status: number; message: string } {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("403") || msg.includes("PERMISSION_DENIED") || msg.includes("API_KEY_INVALID")) {
    return {
      status: 403,
      message: "API key permission error. Please verify your GEMINI_API_KEY in Settings > Secrets.",
    };
  }
  if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED")) {
    return {
      status: 429,
      message: "Rate limit or quota reached. Please wait a moment and try again.",
    };
  }
  if (msg.includes("404") || msg.includes("NOT_FOUND")) {
    return {
      status: 404,
      message: "Requested AI model was not found or is temporarily unavailable.",
    };
  }
  return { status: 500, message: msg || "An unexpected AI service error occurred." };
}

function mapThinkingLevel(depth?: string): ThinkingLevel {
  switch (depth) {
    case "low":
      return ThinkingLevel.LOW;
    case "medium":
      return ThinkingLevel.MEDIUM;
    case "high":
    default:
      return ThinkingLevel.HIGH;
  }
}

const app = express();
app.use(express.json({ limit: "25mb" }));

// Health check
app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ ok: true });
});

// 1. Streaming Chat & Study/Coding Assistant
interface ChatHistoryItem {
  role: "user" | "model";
  text: string;
  image?: {
    mimeType: string;
    data: string;
  };
}

app.post("/api/chat/stream", async (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");

  const sendEvent = (payload: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  try {
    const {
      messages,
      systemInstruction,
      thinkingDepth = "medium",
    }: {
      messages: ChatHistoryItem[];
      systemInstruction?: string;
      thinkingDepth?: string;
    } = req.body ?? {};

    if (!Array.isArray(messages) || messages.length === 0) {
      sendEvent({ error: "Please enter a message." });
      res.end();
      return;
    }

    const ai = getAIClient();

    const contents = messages.map((m) => {
      const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];
      if (m.image?.data && m.image?.mimeType) {
        parts.push({
          inlineData: {
            mimeType: m.image.mimeType,
            data: m.image.data,
          },
        });
      }
      if (m.text && m.text.trim().length > 0) {
        parts.push({ text: m.text });
      }
      return {
        role: m.role === "model" ? "model" : "user",
        parts,
      };
    });

    const stream = await ai.models.generateContentStream({
      model: "gemini-4-hydrogen",
      contents,
      config: {
        systemInstruction:
          systemInstruction ||
          "You are Monarch AI, a helpful, clear, and versatile AI assistant. Support general chat, studying, coding, and multilingual queries (including English, Hindi, and Hinglish when the user uses them). Format responses cleanly with Markdown and fenced code blocks where useful.",
        thinkingConfig: {
          thinkingLevel: mapThinkingLevel(thinkingDepth),
        },
      },
    });

    for await (const chunk of stream) {
      if (chunk.text) {
        sendEvent({ text: chunk.text });
      }
    }

    sendEvent({ done: true });
    res.end();
  } catch (err) {
    const formatted = formatApiError(err);
    sendEvent({ error: formatted.message });
    res.end();
  }
});

// 2. Study Quiz & Flashcard Structured Generator
app.post("/api/study/interactive", async (req: Request, res: Response) => {
  try {
    const {
      topic,
      mode,
      subject = "General",
      difficulty = "Intermediate",
      image,
    }: {
      topic: string;
      mode: "quiz" | "flashcards";
      subject?: string;
      difficulty?: string;
      image?: { mimeType: string; data: string };
    } = req.body ?? {};

    if (!topic?.trim() && !image?.data) {
      res.status(400).json({ error: "Please enter a study topic or attach notes." });
      return;
    }

    const ai = getAIClient();

    if (mode === "quiz") {
      const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];
      if (image?.data && image?.mimeType) {
        parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
      }
      parts.push({
        text: `Create a 5-question multiple choice quiz for subject "${subject}" at "${difficulty}" level on the topic: "${topic || "the attached study material"}". Include clear explanations for each correct answer.`,
      });

      const response = await ai.models.generateContent({
        model: "gemini-4-hydrogen",
        contents: { parts },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              questions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    question: { type: Type.STRING },
                    options: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                    correctIndex: { type: Type.INTEGER },
                    explanation: { type: Type.STRING },
                  },
                  required: ["question", "options", "correctIndex", "explanation"],
                },
              },
            },
            required: ["title", "questions"],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? "{}").trim());
      res.json({ mode: "quiz", data: parsed });
      return;
    }

    // Flashcards
    const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];
    if (image?.data && image?.mimeType) {
      parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
    }
    parts.push({
      text: `Create 6 concise, high-retention study flashcards for subject "${subject}" (${difficulty} level) on: "${topic || "the attached study material"}".`,
    });

    const response = await ai.models.generateContent({
      model: "gemini-4-hydrogen",
      contents: { parts },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            cards: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  front: { type: Type.STRING },
                  back: { type: Type.STRING },
                  hint: { type: Type.STRING },
                },
                required: ["front", "back", "hint"],
              },
            },
          },
          required: ["title", "cards"],
        },
      },
    });

    const parsed = JSON.parse((response.text ?? "{}").trim());
    res.json({ mode: "flashcards", data: parsed });
  } catch (err) {
    const formatted = formatApiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// 3. Visual & Diagram Studio (Crisp Scalable SVG Artwork & Study Diagrams)
app.post("/api/visual/generate", async (req: Request, res: Response) => {
  try {
    const {
      prompt,
      style = "Illustration",
      aspectRatio = "1:1",
    }: {
      prompt: string;
      style?: string;
      aspectRatio?: "1:1" | "16:9" | "4:3" | "9:16";
    } = req.body ?? {};

    if (!prompt?.trim()) {
      res.status(400).json({ error: "Please describe the visual or diagram to create." });
      return;
    }

    const viewBoxMap: Record<string, { w: number; h: number }> = {
      "1:1": { w: 800, h: 800 },
      "16:9": { w: 960, h: 540 },
      "4:3": { w: 800, h: 600 },
      "9:16": { w: 540, h: 960 },
    };
    const dims = viewBoxMap[aspectRatio] ?? viewBoxMap["1:1"];

    const ai = getAIClient();

    const response = await ai.models.generateContent({
      model: "gemini-4-hydrogen",
      contents: `Design a rich, polished, self-contained SVG graphic for: "${prompt}".
Style: ${style}.
Dimensions: viewBox="0 0 ${dims.w} ${dims.h}" width="${dims.w}" height="${dims.h}".

Rules for the SVG:
- Must be a valid, complete <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dims.w} ${dims.h}" width="${dims.w}" height="${dims.h}">...</svg>.
- Use layered shapes, gradients (<defs><linearGradient>...), crisp typography (<text> with sans-serif font), clean spacing, and balanced composition so it looks like a studio-grade vector illustration, poster, icon, or educational study diagram.
- If Style is "Study Diagram" or "Technical Blueprint", include clear labeled arrows, clean callout labels, and legible annotations inside the SVG.
- Do NOT include external <image href="http..."> URLs or <script> tags.
- Return JSON with title, description, palette (array of 3-5 hex colors used), and svg (the complete SVG markup string).`,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            description: { type: Type.STRING },
            palette: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            svg: { type: Type.STRING },
          },
          required: ["title", "description", "palette", "svg"],
        },
      },
    });

    const parsed = JSON.parse((response.text ?? "{}").trim());
    // Basic sanitization: strip any <script> tags if present
    const safeSvg = String(parsed.svg ?? "").replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "");

    res.json({
      title: parsed.title || prompt,
      description: parsed.description || "",
      palette: Array.isArray(parsed.palette) ? parsed.palette : [],
      svg: safeSvg,
      width: dims.w,
      height: dims.h,
      aspectRatio,
      style,
    });
  } catch (err) {
    const formatted = formatApiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// 4. Text Translation
app.post("/api/translate/text", async (req: Request, res: Response) => {
  try {
    const {
      text,
      sourceLang = "Auto-detect",
      targetLang = "Hindi",
      tone = "Natural",
    }: {
      text: string;
      sourceLang?: string;
      targetLang?: string;
      tone?: string;
    } = req.body ?? {};

    if (!text?.trim()) {
      res.status(400).json({ error: "Please enter text to translate." });
      return;
    }

    const ai = getAIClient();
    const response = await ai.models.generateContent({
      model: "gemini-4-hydrogen",
      contents: `Translate the following text from "${sourceLang}" to "${targetLang}" in a "${tone}" tone.
Text:
"""
${text}
"""
Provide:
1. translatedText: accurate, natural translation in the target script.
2. detectedSourceLanguage: the detected source language name.
3. transliteration: Romanized phonetic pronunciation if the target script is non-Latin (e.g., Hindi, Arabic, Japanese, Korean, Tamil, Bengali, Russian, Chinese), otherwise empty string.
4. usageNote: brief 1-sentence nuance or grammar tip when helpful.`,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            translatedText: { type: Type.STRING },
            detectedSourceLanguage: { type: Type.STRING },
            transliteration: { type: Type.STRING },
            usageNote: { type: Type.STRING },
          },
          required: ["translatedText", "detectedSourceLanguage", "transliteration", "usageNote"],
        },
      },
    });

    const parsed = JSON.parse((response.text ?? "{}").trim());
    res.json(parsed);
  } catch (err) {
    const formatted = formatApiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// 5. Audio Transcription (used for Voice Input across Chat & Translator)
app.post("/api/audio/transcribe", async (req: Request, res: Response) => {
  try {
    const {
      audioBase64,
      mimeType = "audio/webm",
    }: {
      audioBase64: string;
      mimeType?: string;
    } = req.body ?? {};

    if (!audioBase64) {
      res.status(400).json({ error: "No audio data received." });
      return;
    }

    const ai = getAIClient();
    const cleanMime = mimeType.split(";")[0] || "audio/webm";

    const response = await ai.models.generateContent({
      model: "gemini-3.5-transcribe",
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: cleanMime,
              data: audioBase64,
            },
          },
          {
            text: "Transcribe this audio accurately in its original spoken language. Return only the transcription text.",
          },
        ],
      },
    });

    res.json({ transcript: (response.text ?? "").trim() });
  } catch (err) {
    const formatted = formatApiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// 6. Audio Translation (Transcribe Audio + Translate to Target Language)
app.post("/api/translate/audio", async (req: Request, res: Response) => {
  try {
    const {
      audioBase64,
      mimeType = "audio/webm",
      sourceLang = "Auto-detect",
      targetLang = "Hindi",
      tone = "Natural",
    }: {
      audioBase64: string;
      mimeType?: string;
      sourceLang?: string;
      targetLang?: string;
      tone?: string;
    } = req.body ?? {};

    if (!audioBase64) {
      res.status(400).json({ error: "No audio data provided." });
      return;
    }

    const ai = getAIClient();
    const cleanMime = mimeType.split(";")[0] || "audio/webm";

    // Step 1: Transcribe audio using gemini-3.5-transcribe
    const transcribeRes = await ai.models.generateContent({
      model: "gemini-3.5-transcribe",
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: cleanMime,
              data: audioBase64,
            },
          },
          {
            text:
              sourceLang && sourceLang !== "Auto-detect"
                ? `Transcribe this ${sourceLang} audio accurately. Return only the transcript.`
                : "Transcribe this audio accurately in its spoken language. Return only the transcript.",
          },
        ],
      },
    });

    const transcript = (transcribeRes.text ?? "").trim();
    if (!transcript) {
      res.status(422).json({ error: "Could not detect clear speech in the audio. Please try again." });
      return;
    }

    // Step 2: Translate transcript using gemini-4-hydrogen
    const translateRes = await ai.models.generateContent({
      model: "gemini-4-hydrogen",
      contents: `Translate the following spoken transcript from "${sourceLang}" to "${targetLang}" in a "${tone}" tone.
Transcript:
"""
${transcript}
"""`,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            translatedText: { type: Type.STRING },
            detectedSourceLanguage: { type: Type.STRING },
            transliteration: { type: Type.STRING },
            usageNote: { type: Type.STRING },
          },
          required: ["translatedText", "detectedSourceLanguage", "transliteration", "usageNote"],
        },
      },
    });

    const parsed = JSON.parse((translateRes.text ?? "{}").trim());
    res.json({
      transcript,
      ...parsed,
    });
  } catch (err) {
    const formatted = formatApiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// 7. Text-to-Speech (WAV output using gemini-3.8-flash-lite-tts)
app.post("/api/audio/tts", async (req: Request, res: Response) => {
  try {
    const {
      text,
      voiceName = "Kore",
      style = "Clear, warm, natural pronunciation",
    }: {
      text: string;
      voiceName?: string;
      style?: string;
    } = req.body ?? {};

    if (!text?.trim()) {
      res.status(400).json({ error: "Text is required for speech synthesis." });
      return;
    }

    const allowedVoices = ["Puck", "Charon", "Kore", "Fenrir", "Zephyr"];
    const selectedVoice = allowedVoices.includes(voiceName) ? voiceName : "Kore";

    const ai = getAIClient();
    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash-lite-tts",
      contents: [
        {
          role: "user",
          parts: [
            {
              text: text.slice(0, 2000),
              speechMetadata: {
                style,
              },
            },
          ],
        },
      ],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: selectedVoice },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) {
      res.status(500).json({ error: "Speech synthesis did not return audio data." });
      return;
    }

    res.json({
      audioBase64: base64Audio,
      mimeType: "audio/wav",
    });
  } catch (err) {
    const formatted = formatApiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

async function startServer() {
  if (isDev) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, "dist");
    app.use(express.static(distDir));
    app.get("/{*path}", (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Monarch AI server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
