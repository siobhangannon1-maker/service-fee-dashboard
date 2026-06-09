"use client";

import { useEffect, useRef, useState } from "react";

type OpenAIDictationBoxProps = {
  disabled?: boolean;
  providerId: string;
  patientFirstName: string;
  patientLastName: string;
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
  patientFirstName,
  patientLastName,
  onStarted,
  onPaused,
  onResumed,
  onFinished,
}: OpenAIDictationBoxProps) {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

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
    if (disabled || processing) return;

    try {
      setMessage("");
      setSeconds(0);
      chunksRef.current = [];

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;

        const audioBlob = new Blob(chunksRef.current, { type: "audio/webm" });
        await transcribeAudio(audioBlob);
      };

      mediaRecorderRef.current = recorder;
      recorder.start();

      setRecording(true);
      setPaused(false);
      setMessage("Recording...");
      onStarted?.();
    } catch (error) {
      console.error("Could not start dictation:", error);
      alert("Could not access the microphone. Please check browser permissions.");
    }
  }

  function pauseRecording() {
    if (!mediaRecorderRef.current) return;

    if (mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.pause();
      setPaused(true);
      setMessage("Paused. Draft will save once transcription is available. Click Resume to continue.");
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

  async function transcribeAudio(audioBlob: Blob) {
    try {
      if (audioBlob.size === 0) {
        alert("No audio was recorded. Please try again.");
        return;
      }

      const formData = new FormData();
      formData.append("audio", audioBlob, "dictation.webm");
      formData.append("providerId", providerId);
      formData.append("patientFirstName", patientFirstName);
      formData.append("patientLastName", patientLastName);

      const response = await fetch("/api/report-writing/transcribe", {
        method: "POST",
        body: formData,
      });

      const responseText = await response.text();
      let data: any = {};

      try {
        data = JSON.parse(responseText);
      } catch {
        console.error("Non-JSON transcription response:", responseText);
        alert(`Transcription failed with non-JSON response. Status: ${response.status}`);
        return;
      }

      if (!response.ok || !data.success) {
        console.error("Transcription API error:", data);
        alert(data.error || `Failed to transcribe. Status: ${response.status}`);
        return;
      }

      const text = String(data.text || "").trim();
      onFinished(text);
      setMessage(`Transcription complete and draft saved for ${patientFirstName} ${patientLastName}.`);
    } catch (error) {
      console.error("Dictation upload/transcription error:", error);
      alert("Error transcribing audio. Check the browser console and terminal.");
    } finally {
      setProcessing(false);
    }
  }

  const statusLabel = recording ? (paused ? "Paused" : "Recording") : processing ? "Transcribing" : "Ready";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-3">
        {!recording ? (
          <button
            type="button"
            disabled={disabled || processing}
            onClick={startRecording}
            className="rounded-xl bg-green-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
          >
            {processing ? "Transcribing..." : "Start Dictation"}
          </button>
        ) : null}

        {recording && !paused ? (
          <button type="button" onClick={pauseRecording} className="rounded-xl bg-amber-500 px-5 py-3 font-semibold text-white">
            Pause
          </button>
        ) : null}

        {recording && paused ? (
          <button type="button" onClick={resumeRecording} className="rounded-xl bg-green-600 px-5 py-3 font-semibold text-white">
            Resume
          </button>
        ) : null}

        {recording ? (
          <button type="button" onClick={stopRecording} className="rounded-xl bg-red-600 px-5 py-3 font-semibold text-white">
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
              recording && !paused ? "animate-pulse bg-red-600" : paused ? "bg-amber-500" : "bg-slate-400",
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

      {message ? <div className="mt-3 text-sm text-slate-500">{message}</div> : null}
    </div>
  );
}