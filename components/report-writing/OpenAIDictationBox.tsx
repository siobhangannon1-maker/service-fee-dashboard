"use client";

import { useEffect, useRef, useState } from "react";
import {
  RetainedRecording,
  transcribeRetained,
} from "@/lib/report-writing/dictation-upload-client";
import {
  DictationContext,
  contextKey,
  AUDIO_TYPES,
} from "@/lib/report-writing/dictation-upload-contract";

type OpenAIDictationBoxProps = {
  disabled?: boolean;
  providerId: string;
  draftId?: string | null;
  existingText?: string;
  patientFirstName: string;
  patientLastName: string;
  patientDob?: string;
  editorKey?: string;
  onStarted?: () => void;
  onPaused?: (text?: string) => void;
  onResumed?: () => void;
  onFinished: (text: string) => void;
};

function formatDuration(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export default function OpenAIDictationBox({
  disabled,
  providerId,
  draftId = null,
  existingText = "",
  patientFirstName,
  patientLastName,
  patientDob = "",
  editorKey = "",
  onStarted,
  onPaused,
  onResumed,
  onFinished,
}: OpenAIDictationBoxProps) {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const retainedRef = useRef<RetainedRecording | null>(null);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const currentRef = useRef({
    providerId,
    patientFirstName,
    patientLastName,
    patientDob,
    editorKey,
    draftId,
    existingText,
    onFinished,
  });
  currentRef.current = {
    providerId,
    patientFirstName,
    patientLastName,
    patientDob,
    editorKey,
    draftId,
    existingText,
    onFinished,
  };
  const [hasRecording, setHasRecording] = useState(false);
  const [result, setResult] = useState("");

  useEffect(() => {
    mountedRef.current = true;
    const warn = (event: BeforeUnloadEvent) => {
      if (
        retainedRef.current ||
        mediaRecorderRef.current?.state === "recording" ||
        mediaRecorderRef.current?.state === "paused"
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      mountedRef.current = false;
      window.removeEventListener("beforeunload", warn);
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.onstop = null;
        mediaRecorderRef.current.ondataavailable = null;
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  function sameCurrentContext(take: RetainedRecording) {
    const current = currentRef.current;
    return (
      contextKey(take.context) ===
      contextKey({ ...current, recordingId: take.context.recordingId })
    );
  }
  function downloadRecording() {
    const take = retainedRef.current;
    if (!take) return;
    const url = URL.createObjectURL(take.audio),
      link = document.createElement("a");
    link.href = url;
    link.download = `dictation-${take.context.recordingId}.${AUDIO_TYPES[take.audio.type.split(";")[0]] || "webm"}`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState("");
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!recording || paused) return;

    const interval = window.setInterval(() => {
      setSeconds((current) => current + 1);
    }, 1000);

    return () => window.clearInterval(interval);
  }, [recording, paused]);

  async function startRecording() {
    if (disabled || processing || busyRef.current || retainedRef.current)
      return;
    busyRef.current = true;

    try {
      setMessage("");
      setSeconds(0);
      chunksRef.current = [];

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        busyRef.current = false;
        return;
      }
      streamRef.current = stream;

      const mimeType = ["audio/webm", "audio/mp4"].find((type) =>
        MediaRecorder.isTypeSupported(type),
      );
      if (!mimeType) throw new Error("Unsupported recording format");
      const recorder = new MediaRecorder(stream, { mimeType });
      const context: DictationContext = {
        providerId,
        patientFirstName: patientFirstName.trim(),
        patientLastName: patientLastName.trim(),
        patientDob,
        editorKey,
        draftId,
        recordingId: crypto.randomUUID(),
      };

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;

        const audioBlob = new Blob(chunksRef.current, {
          type: recorder.mimeType || mimeType,
        });
        chunksRef.current = [];
        retainedRef.current = { audio: audioBlob, context, uploaded: false };
        setHasRecording(true);
        busyRef.current = false;
        await transcribeAudio(false);
      };

      mediaRecorderRef.current = recorder;
      recorder.start(1000);

      setRecording(true);
      setPaused(false);
      setMessage("Recording...");
      onStarted?.();
      busyRef.current = false;
    } catch (error) {
      busyRef.current = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      alert(
        "Could not access the microphone. Please check browser permissions.",
      );
    }
  }

  function pauseRecording() {
    if (!mediaRecorderRef.current) return;

    if (mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.pause();
      setPaused(true);
      setMessage(
        "Paused. Draft will save once transcription is available. Click Resume to continue.",
      );
      onPaused?.();
    }
  }

  function resumeRecording() {
    if (!mediaRecorderRef.current) return;

    if (mediaRecorderRef.current.state === "paused") {
      mediaRecorderRef.current.resume();
      setPaused(false);
      setMessage("Recording...");
      onResumed?.();
    }
  }

  function stopRecording() {
    if (!mediaRecorderRef.current) return;

    if (mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }

    setRecording(false);
    setPaused(false);
    setProcessing(true);
    setMessage("Transcribing and saving draft...");
  }

  async function transcribeAudio(isRetry: boolean) {
    const take = retainedRef.current;
    if (!take || busyRef.current) return;
    if (!sameCurrentContext(take)) {
      setMessage(
        "Return to the original patient and draft to retry. You can still download the recording.",
      );
      return;
    }
    busyRef.current = true;
    setProcessing(true);
    setMessage("Uploading and transcribing. Keep this page open...");
    try {
      const text = (
        await transcribeRetained(take, {
          ...currentRef.current,
          recordingId: take.context.recordingId,
        })
      ).trim();
      if (!mountedRef.current) return;
      if (!text)
        throw new Error(
          "No transcription was returned. Retry or download your recording.",
        );
      // Retry and editor changes must never replace a letter automatically.
      if (!sameCurrentContext(take)) {
        setMessage(
          "Transcription finished for the original patient. Return to that patient and draft before using it.",
        );
        setResult(text);
        return;
      }
      if (isRetry || currentRef.current.existingText.trim()) {
        setResult(text);
        setMessage(
          "Transcription recovered. Review it below; your existing letter has not been changed.",
        );
      } else {
        currentRef.current.onFinished(text);
        retainedRef.current = null;
        setHasRecording(false);
        setMessage("Transcription complete and sent to the draft editor.");
      }
    } catch (error) {
      if (mountedRef.current)
        setMessage(
          error instanceof Error
            ? error.message
            : "Transcription failed. Retry or download your recording.",
        );
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setProcessing(false);
    }
  }
  function insertReviewedResult() {
    const take = retainedRef.current;
    if (
      !take ||
      !sameCurrentContext(take) ||
      currentRef.current.existingText.trim() ||
      !result
    )
      return;
    currentRef.current.onFinished(result);
    retainedRef.current = null;
    setHasRecording(false);
    setResult("");
    setMessage("Reviewed transcription sent to the draft editor.");
  }

  const statusLabel = recording
    ? paused
      ? "Paused"
      : "Recording"
    : processing
      ? "Transcribing"
      : "Ready";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-3">
        {!recording ? (
          <button
            type="button"
            disabled={disabled || processing || hasRecording}
            onClick={startRecording}
            className="rounded-xl bg-green-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
          >
            {processing ? "Transcribing..." : "Start Dictation"}
          </button>
        ) : null}

        {recording && !paused ? (
          <button
            type="button"
            onClick={pauseRecording}
            className="rounded-xl bg-amber-500 px-5 py-3 font-semibold text-white"
          >
            Pause
          </button>
        ) : null}

        {recording && paused ? (
          <button
            type="button"
            onClick={resumeRecording}
            className="rounded-xl bg-green-600 px-5 py-3 font-semibold text-white"
          >
            Resume
          </button>
        ) : null}

        {recording ? (
          <button
            type="button"
            onClick={stopRecording}
            className="rounded-xl bg-red-600 px-5 py-3 font-semibold text-white"
          >
            Stop and Save Draft
          </button>
        ) : null}

        <div
          className={[
            "flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold",
            recording && !paused
              ? "bg-red-50 text-red-700"
              : paused
                ? "bg-amber-50 text-amber-700"
                : "bg-slate-100 text-slate-600",
          ].join(" ")}
        >
          <span
            className={[
              "h-3 w-3 rounded-full",
              recording && !paused
                ? "animate-pulse bg-red-600"
                : paused
                  ? "bg-amber-500"
                  : "bg-slate-400",
            ].join(" ")}
          />
          <span>{statusLabel}</span>
          <span className="font-mono">{formatDuration(seconds)}</span>
        </div>

        {disabled ? (
          <div className="text-sm text-slate-500">
            Enter patient first and last name before dictating.
          </div>
        ) : null}
      </div>

      <p className="mt-2 text-xs text-slate-500">
        Maximum recording file size: 24 MB. Keep the Dictate tab open until
        transcription finishes.
      </p>
      {hasRecording ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={processing || disabled}
            onClick={() => transcribeAudio(true)}
            className="rounded-xl bg-blue-600 px-4 py-2 font-semibold text-white disabled:opacity-50"
          >
            Retry transcription
          </button>
          <button
            type="button"
            onClick={downloadRecording}
            className="rounded-xl border px-4 py-2 font-semibold"
          >
            Download recording
          </button>
          {!processing ? (
            <button
              type="button"
              onClick={() => {
                if (
                  window.confirm(
                    "Discard this retained recording? Download it first if you need a copy.",
                  )
                ) {
                  retainedRef.current = null;
                  setHasRecording(false);
                  setResult("");
                  setMessage("");
                }
              }}
              className="rounded-xl border px-4 py-2"
            >
              Discard recording
            </button>
          ) : null}
          <p className="text-sm text-slate-600">
            Keep this page and Dictate tab open until finished, or download the
            audio. Recordings are held in browser memory.
          </p>
        </div>
      ) : null}
      {result &&
      retainedRef.current &&
      sameCurrentContext(retainedRef.current) ? (
        <div className="mt-3 space-y-2">
          <label
            className="block text-sm font-semibold"
            htmlFor="recovered-dictation"
          >
            Transcription for review
          </label>
          <textarea
            id="recovered-dictation"
            readOnly
            value={result}
            className="min-h-40 w-full rounded-xl border p-3"
          />
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(result);
                setMessage(
                  "Transcription copied. Paste it where needed in your letter.",
                );
              } catch {
                setMessage("Select and copy the transcription above.");
              }
            }}
            className="rounded-xl border px-4 py-2"
          >
            Copy transcription
          </button>
          {!existingText.trim() ? (
            <button
              type="button"
              onClick={insertReviewedResult}
              className="ml-2 rounded-xl bg-blue-600 px-4 py-2 text-white"
            >
              Insert reviewed transcription
            </button>
          ) : (
            <p className="text-sm text-slate-600">
              Your letter already contains text. Copy the transcription into the
              intended position.
            </p>
          )}
        </div>
      ) : null}
      {message ? (
        <div role="status" className="mt-3 text-sm text-slate-600">
          {message}
        </div>
      ) : null}
    </div>
  );
}
