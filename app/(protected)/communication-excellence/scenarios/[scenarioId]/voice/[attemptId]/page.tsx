"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type Message = {
  id?: string;
  speaker: "patient" | "staff" | string;
  message: string;
  created_at?: string;
};

export default function ActiveVoiceRoleplayPage() {
  const params = useParams();
  const router = useRouter();

  const scenarioId = String(params.scenarioId);
  const attemptId = String(params.attemptId);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastSpokenPatientMessageRef = useRef<string | null>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastDelivery, setLastDelivery] = useState<any>(null);
  const [finalScore, setFinalScore] = useState<any>(null);

  async function speakPatientText(text: string) {
    if (!text) return;

    setIsSpeaking(true);

    try {
      const response = await fetch(
        "/api/communication-excellence/voice-roleplay/speak",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ text }),
        }
      );

      if (!response.ok) {
        throw new Error("Could not play patient voice.");
      }

      const blob = await response.blob();
      const audioUrl = URL.createObjectURL(blob);

      if (audioRef.current) {
        audioRef.current.pause();
      }

      const audio = new Audio(audioUrl);
      audioRef.current = audio;

      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        setIsSpeaking(false);
      };

      audio.onerror = () => {
        URL.revokeObjectURL(audioUrl);
        setIsSpeaking(false);
      };

      await audio.play();
    } catch {
      setIsSpeaking(false);
    }
  }

  async function loadMessages() {
    const response = await fetch(
      `/api/communication-excellence/voice-roleplay/${attemptId}/messages`
    );

    if (!response.ok) return;

    const data = await response.json();
    const loadedMessages = data.messages ?? [];

    setMessages(loadedMessages);

    const latestPatientMessage = [...loadedMessages]
      .reverse()
      .find((message: Message) => message.speaker === "patient");

    if (
      latestPatientMessage &&
      latestPatientMessage.message !== lastSpokenPatientMessageRef.current
    ) {
      lastSpokenPatientMessageRef.current = latestPatientMessage.message;
      await speakPatientText(latestPatientMessage.message);
    }
  }

  useEffect(() => {
    loadMessages();

    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, [attemptId]);

  async function startRecording() {
    setError(null);
    setLastDelivery(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      startedAtRef.current = Date.now();

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const durationSeconds =
          startedAtRef.current === null
            ? null
            : Math.round((Date.now() - startedAtRef.current) / 1000);

        stream.getTracks().forEach((track) => track.stop());

        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        await sendAudio(blob, durationSeconds);
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch {
      setError("Microphone access failed. Please allow microphone permissions.");
    }
  }

  function stopRecording() {
    if (!mediaRecorderRef.current) return;

    mediaRecorderRef.current.stop();
    setIsRecording(false);
  }

  async function sendAudio(blob: Blob, durationSeconds: number | null) {
    setIsSending(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("audio", blob, "staff-response.webm");

      if (durationSeconds !== null) {
        formData.append("durationSeconds", String(durationSeconds));
      }

      const response = await fetch(
        `/api/communication-excellence/voice-roleplay/${attemptId}/turn`,
        {
          method: "POST",
          body: formData,
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Voice turn failed.");
      }

      setLastDelivery(data.deliveryNotes);

      setMessages((current) => [
        ...current,
        {
          speaker: "staff",
          message: data.staffTranscript,
        },
        {
          speaker: "patient",
          message: data.patientReply,
        },
      ]);

      lastSpokenPatientMessageRef.current = data.patientReply;
      await speakPatientText(data.patientReply);
    } catch (err: any) {
      setError(err.message || "Something went wrong.");
    } finally {
      setIsSending(false);
    }
  }

  async function finishScenario() {
    setIsFinishing(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/communication-excellence/voice-roleplay/${attemptId}/finish`,
        {
          method: "POST",
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not finish scenario.");
      }

      setFinalScore(data.finalScore);
    } catch (err: any) {
      setError(err.message || "Something went wrong.");
    } finally {
      setIsFinishing(false);
    }
  }

  const latestPatientMessage = [...messages]
    .reverse()
    .find((message) => message.speaker === "patient");

  return (
    <main className="mx-auto max-w-5xl p-6 space-y-6">
      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <p className="text-sm text-gray-500">Voice Roleplay</p>
        <h1 className="text-2xl font-semibold text-gray-900">
          Push-to-talk scenario
        </h1>
        <p className="mt-2 text-gray-600">
          The AI patient will speak aloud. Record your staff response, then the
          patient will reply again.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
          {error}
        </div>
      )}

      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Patient voice</h2>

        <div className="mt-4 rounded-xl border bg-slate-50 p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">
            Latest patient message
          </p>
          <p className="mt-2 text-gray-900">
            {latestPatientMessage?.message || "Waiting for patient message..."}
          </p>
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() =>
              latestPatientMessage?.message &&
              speakPatientText(latestPatientMessage.message)
            }
            disabled={!latestPatientMessage?.message || isSpeaking}
            className="rounded-xl border px-5 py-3 text-gray-900 disabled:opacity-50"
          >
            {isSpeaking ? "Speaking..." : "Replay patient voice"}
          </button>
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Conversation</h2>

        <div className="mt-4 space-y-3">
          {messages.length === 0 && (
            <p className="text-gray-500">
              No messages found yet. Go back and start the voice scenario again.
            </p>
          )}

          {messages.map((message, index) => (
            <div
              key={message.id ?? index}
              className={`rounded-xl p-4 ${
                message.speaker === "staff"
                  ? "bg-blue-50 border border-blue-100"
                  : "bg-gray-50 border border-gray-100"
              }`}
            >
              <p className="text-xs uppercase tracking-wide text-gray-500">
                {message.speaker === "staff" ? "Staff member" : "Patient"}
              </p>
              <p className="mt-1 text-gray-900">{message.message}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">
          Record your response
        </h2>

        <div className="mt-4 flex flex-wrap gap-3">
          {!isRecording ? (
            <button
              onClick={startRecording}
              disabled={isSending || isFinishing || isSpeaking}
              className="rounded-xl bg-black px-5 py-3 text-white disabled:opacity-50"
            >
              Start recording
            </button>
          ) : (
            <button
              onClick={stopRecording}
              className="rounded-xl bg-red-600 px-5 py-3 text-white"
            >
              Stop and submit
            </button>
          )}

          <button
            onClick={finishScenario}
            disabled={isRecording || isSending || isFinishing || messages.length === 0}
            className="rounded-xl border px-5 py-3 text-gray-900 disabled:opacity-50"
          >
            {isFinishing ? "Scoring..." : "Finish scenario"}
          </button>

          <button
            onClick={() =>
              router.push(`/communication-excellence/scenarios/${scenarioId}`)
            }
            className="rounded-xl border px-5 py-3 text-gray-900"
          >
            Exit
          </button>
        </div>

        {isSending && (
          <p className="mt-3 text-sm text-gray-500">
            Transcribing and generating patient reply...
          </p>
        )}
      </section>

      {lastDelivery && (
        <section className="rounded-2xl border bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">
            Latest delivery coaching
          </h2>

          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <ScoreCard label="Warmth" value={lastDelivery.warmth_score} />
            <ScoreCard label="Calmness" value={lastDelivery.calmness_score} />
            <ScoreCard label="Pace" value={lastDelivery.pace_score} />
            <ScoreCard label="Confidence" value={lastDelivery.confidence_score} />
          </div>

          <p className="mt-4 text-gray-700">{lastDelivery.coaching_note}</p>
        </section>
      )}

      {finalScore && (
        <section className="rounded-2xl border bg-green-50 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Final coaching</h2>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <ScoreCard label="Content" value={finalScore.content_score} />
            <ScoreCard label="Delivery" value={finalScore.delivery_score} />
            <ScoreCard label="Overall" value={finalScore.overall_score} />
          </div>

          <p className="mt-4 text-gray-800">{finalScore.staff_coaching}</p>
        </section>
      )}
    </main>
  );
}

function ScoreCard({ label, value }: { label: string; value?: number }) {
  return (
    <div className="rounded-xl border bg-white p-4">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-gray-900">
        {typeof value === "number" ? `${value}/10` : "—"}
      </p>
    </div>
  );
}