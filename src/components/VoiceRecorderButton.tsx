import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, Square } from "lucide-react";

interface VoiceRecorderButtonProps {
  onRecorded: (blob: Blob, mimeType: string) => Promise<void> | void;
  disabled?: boolean;
  isProcessing?: boolean;
  label?: string;
  compact?: boolean;
  onError?: (message: string) => void;
}

export function VoiceRecorderButton({
  onRecorded,
  disabled = false,
  isProcessing = false,
  label = "Record voice",
  compact = true,
  onError,
}: VoiceRecorderButtonProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsRecording(false);
  };

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      onError?.("Microphone recording is not supported in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const preferredTypes = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
        "audio/ogg",
      ];
      const supportedType = preferredTypes.find((t) => MediaRecorder.isTypeSupported(t)) || "";
      const recorder = supportedType
        ? new MediaRecorder(stream, { mimeType: supportedType })
        : new MediaRecorder(stream);

      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const mime = recorder.mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: mime });
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        if (blob.size > 0) {
          await onRecorded(blob, mime);
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start(250);
      setElapsedSec(0);
      setIsRecording(true);
      timerRef.current = window.setInterval(() => {
        setElapsedSec((prev) => prev + 1);
      }, 1000);
    } catch {
      onError?.("Microphone access was denied or unavailable. Please allow microphone permission.");
    }
  };

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  if (isRecording) {
    return (
      <button
        type="button"
        onClick={stopRecording}
        aria-label="Stop recording"
        className="inline-flex items-center justify-center gap-2 min-h-[44px] min-w-[44px] px-3.5 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
      >
        <Square className="w-3.5 h-3.5 fill-current" />
        <span className="tabular-nums">{formatDuration(elapsedSec)}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={startRecording}
      disabled={disabled || isProcessing}
      aria-label={label}
      title={label}
      className={`inline-flex items-center justify-center gap-2 min-h-[44px] min-w-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
        compact ? "px-2.5 py-2" : "px-4 py-2 text-sm font-medium"
      }`}
    >
      {isProcessing ? (
        <Loader2 className="w-4 h-4 animate-spin text-blue-600 dark:text-blue-400" />
      ) : (
        <Mic className="w-4 h-4" />
      )}
      {!compact && <span>{isProcessing ? "Processing audio..." : label}</span>}
    </button>
  );
}
