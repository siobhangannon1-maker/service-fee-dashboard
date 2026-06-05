"use client";

import { useRef, useState } from "react";

type StructuredData = {
  chiefConcern: string;
  diagnosis: string;
  stageGrade: string;
  probingDepthsSummary: string;
  bopScore: string;
  suppuration: string;
  mobility: string;
  furcation: string;
  recession: string;
  plaqueCalculus: string;
  radiographicFindings: string;
  riskFactors: string;
  treatmentDiscussed: string;
  consentDiscussion: string;
  plan: string;
};

const emptyStructuredData: StructuredData = {
  chiefConcern: "",
  diagnosis: "",
  stageGrade: "",
  probingDepthsSummary: "",
  bopScore: "",
  suppuration: "",
  mobility: "",
  furcation: "",
  recession: "",
  plaqueCalculus: "",
  radiographicFindings: "",
  riskFactors: "",
  treatmentDiscussed: "",
  consentDiscussion: "",
  plan: "",
};

async function readJsonSafely(response: Response) {
  const text = await response.text();

  if (!text.trim()) {
    return { success: false, error: "Empty server response." };
  }

  try {
    return JSON.parse(text);
  } catch {
    return {
      success: false,
      error: "Server returned non-JSON response.",
      preview: text.slice(0, 500),
    };
  }
}

export default function ClinicalScribePage() {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const [providerId, setProviderId] = useState("");
  const [patientFirstName, setPatientFirstName] = useState("");
  const [patientLastName, setPatientLastName] = useState("");
  const [patientDob, setPatientDob] = useState("");
  const [praktikaPatientId, setPraktikaPatientId] = useState("");

  const [appointmentType, setAppointmentType] = useState(
    "periodontal_consultation",
  );

  const [transcript, setTranscript] = useState("");
  const [structuredData, setStructuredData] =
    useState<StructuredData>(emptyStructuredData);

  const [sessionId, setSessionId] = useState("");
  const [generatedNote, setGeneratedNote] = useState("");
  const [editedNote, setEditedNote] = useState("");

  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");

  const patientName = `${patientFirstName} ${patientLastName}`.trim();

  function updateStructuredField(
    key: keyof StructuredData,
    value: string,
  ) {
    setStructuredData((current) => ({
      ...current,
      [key]: value,
    }));
  }

  async function startRecording() {
    if (!patientFirstName.trim() || !patientLastName.trim()) {
      alert("Enter patient first and last name before recording.");
      return;
    }

    setMessage("");
    chunksRef.current = [];

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
    });

    const recorder = new MediaRecorder(stream, {
      mimeType: "audio/webm",
    });

    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };

    recorder.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop());

      const blob = new Blob(chunksRef.current, {
        type: "audio/webm",
      });

      await transcribeAudio(blob);
    };

    recorder.start();
    setRecording(true);
    setPaused(false);
    setMessage("Recording consultation...");
  }

  function pauseRecording() {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.pause();
      setPaused(true);
      setMessage("Recording paused.");
    }
  }

  function resumeRecording() {
    if (mediaRecorderRef.current?.state === "paused") {
      mediaRecorderRef.current.resume();
      setPaused(false);
      setMessage("Recording consultation...");
    }
  }

  function stopRecording() {
    if (!mediaRecorderRef.current) return;

    mediaRecorderRef.current.stop();
    setRecording(false);
    setPaused(false);
    setWorking(true);
    setMessage("Transcribing consultation...");
  }

  async function transcribeAudio(audioBlob: Blob) {
    try {
      if (audioBlob.size === 0) {
        alert("No audio was recorded.");
        return;
      }

      const formData = new FormData();

      // Uses your existing Smart Dictate transcription route.
      formData.append("file", audioBlob, "clinical-scribe.webm");

      const response = await fetch("/api/report-writing/transcribe-audio", {
        method: "POST",
        body: formData,
      });

      const data = await readJsonSafely(response);

      if (!response.ok || !data.success) {
        alert(data.error || "Failed to transcribe audio.");
        return;
      }

      const text = data.text || data.transcript || "";

      setTranscript((current) =>
        [current, text].filter(Boolean).join("\n\n"),
      );

      setMessage("Transcription complete. Review it, then generate the note.");
    } catch (error) {
      console.error(error);
      alert("Error transcribing audio.");
    } finally {
      setWorking(false);
    }
  }

  async function generateNote() {
    if (!providerId.trim()) {
      alert("Enter provider ID.");
      return;
    }

    if (!patientFirstName.trim() || !patientLastName.trim()) {
      alert("Enter patient first and last name.");
      return;
    }

    if (!transcript.trim() && !Object.values(structuredData).some(Boolean)) {
      alert("Enter a transcript or structured clinical data first.");
      return;
    }

    setWorking(true);
    setMessage("Generating clinical note...");

    try {
      const response = await fetch("/api/clinical-scribe/generate-note", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          providerId,
          patientFirstName,
          patientLastName,
          patientDob,
          praktikaPatientId,
          appointmentType,
          transcript,
          structuredData,
        }),
      });

      const data = await readJsonSafely(response);

      if (!response.ok || !data.success) {
        alert(data.error || "Failed to generate clinical note.");
        return;
      }

      setSessionId(data.sessionId);
      setGeneratedNote(data.note);
      setEditedNote(data.note);
      setMessage("Clinical note generated. Review and edit before uploading.");
    } catch (error) {
      console.error(error);
      alert("Error generating clinical note.");
    } finally {
      setWorking(false);
    }
  }

  async function uploadToPraktika() {
    if (!sessionId) {
      alert("Generate and save a note first.");
      return;
    }

    if (!praktikaPatientId.trim()) {
      alert("Enter the Praktika patient ID before upload.");
      return;
    }

    if (!editedNote.trim()) {
      alert("Clinical note is empty.");
      return;
    }

    const confirmed = confirm(
      `Upload this approved clinical note to Praktika for ${patientName}?`,
    );

    if (!confirmed) return;

    setWorking(true);
    setMessage("Uploading approved note to Praktika...");

    try {
      const response = await fetch("/api/clinical-scribe/upload-to-praktika", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionId,
          praktikaPatientId,
          editedNote,
          practiceId: 1181,
        }),
      });

      const data = await readJsonSafely(response);

      if (!response.ok || !data.success) {
        alert(data.error || "Failed to upload to Praktika.");
        return;
      }

      setMessage(
        data.praktikaNoteId
          ? `Uploaded to Praktika. Note ID: ${data.praktikaNoteId}`
          : "Uploaded to Praktika.",
      );
    } catch (error) {
      console.error(error);
      alert("Error uploading to Praktika.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-8">
      <section className="rounded-3xl border bg-white p-6 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
          AI Clinical Scribe
        </p>

        <h1 className="mt-1 text-3xl font-bold text-slate-950">
          Consultation to Clinical Note
        </h1>

        <p className="mt-2 text-sm text-slate-600">
          Record or paste a consultation transcript, add structured periodontal
          and radiographic data, generate a clinical note, review it, then upload
          it to Praktika.
        </p>
      </section>

      {message ? (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
          {message}
        </div>
      ) : null}

      <section className="grid gap-4 rounded-3xl border bg-white p-6 shadow-sm md:grid-cols-2">
        <div>
          <label className="text-sm font-semibold text-slate-700">
            Provider ID
          </label>
          <input
            className="mt-1 w-full rounded-xl border p-3"
            placeholder="Paste provider UUID for now"
            value={providerId}
            onChange={(event) => setProviderId(event.target.value)}
          />
          <p className="mt-1 text-xs text-slate-500">
            Later we can replace this with your current-provider lookup.
          </p>
        </div>

        <div>
          <label className="text-sm font-semibold text-slate-700">
            Appointment type
          </label>
          <select
            className="mt-1 w-full rounded-xl border p-3"
            value={appointmentType}
            onChange={(event) => setAppointmentType(event.target.value)}
          >
            <option value="periodontal_consultation">
              Periodontal Consultation
            </option>
            <option value="periodontal_review">Periodontal Review</option>
            <option value="SPT_report">Supportive Periodontal Therapy</option>
            <option value="implant_consultation">Implant Consultation</option>
            <option value="oral_surgery_consultation">
              Oral Surgery Consultation
            </option>
            <option value="post_op_review">Post-operative Review</option>
          </select>
        </div>

        <input
          className="rounded-xl border p-3"
          placeholder="Patient first name"
          value={patientFirstName}
          onChange={(event) => setPatientFirstName(event.target.value)}
        />

        <input
          className="rounded-xl border p-3"
          placeholder="Patient last name"
          value={patientLastName}
          onChange={(event) => setPatientLastName(event.target.value)}
        />

        <input
          className="rounded-xl border p-3"
          type="date"
          value={patientDob}
          onChange={(event) => setPatientDob(event.target.value)}
        />

        <input
          className="rounded-xl border p-3"
          placeholder="Praktika patient ID"
          value={praktikaPatientId}
          onChange={(event) => setPraktikaPatientId(event.target.value)}
        />
      </section>

      <section className="rounded-3xl border bg-white p-6 shadow-sm">
        <h2 className="text-xl font-bold text-slate-950">
          1. Consultation transcript
        </h2>

        <p className="mt-1 text-sm text-slate-600">
          Record the consultation or paste/edit the transcript manually.
        </p>

        <div className="mt-4 flex flex-wrap gap-3">
          {!recording ? (
            <button
              type="button"
              onClick={startRecording}
              disabled={working}
              className="rounded-xl bg-green-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
            >
              Start Recording
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
              Stop and Transcribe
            </button>
          ) : null}
        </div>

        <textarea
          className="mt-4 h-56 w-full rounded-2xl border p-4 text-sm"
          placeholder="Transcript will appear here. You can also paste consultation notes manually."
          value={transcript}
          onChange={(event) => setTranscript(event.target.value)}
        />
      </section>

      <section className="rounded-3xl border bg-white p-6 shadow-sm">
        <h2 className="text-xl font-bold text-slate-950">
          2. Structured periodontal and radiographic data
        </h2>

        <p className="mt-1 text-sm text-slate-600">
          This data is given priority over the transcript when generating the
          note.
        </p>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <textarea
            className="rounded-xl border p-3"
            placeholder="Chief concern"
            value={structuredData.chiefConcern}
            onChange={(event) =>
              updateStructuredField("chiefConcern", event.target.value)
            }
          />

          <textarea
            className="rounded-xl border p-3"
            placeholder="Diagnosis"
            value={structuredData.diagnosis}
            onChange={(event) =>
              updateStructuredField("diagnosis", event.target.value)
            }
          />

          <input
            className="rounded-xl border p-3"
            placeholder="Stage/grade, e.g. Stage III Grade B periodontitis"
            value={structuredData.stageGrade}
            onChange={(event) =>
              updateStructuredField("stageGrade", event.target.value)
            }
          />

          <input
            className="rounded-xl border p-3"
            placeholder="BOP score, e.g. 38%"
            value={structuredData.bopScore}
            onChange={(event) =>
              updateStructuredField("bopScore", event.target.value)
            }
          />

          <textarea
            className="rounded-xl border p-3 md:col-span-2"
            placeholder="Probing depths summary, e.g. Generalised 4-5 mm pockets with 6-7 mm pockets at 16D, 26D, 36M"
            value={structuredData.probingDepthsSummary}
            onChange={(event) =>
              updateStructuredField("probingDepthsSummary", event.target.value)
            }
          />

          <input
            className="rounded-xl border p-3"
            placeholder="Suppuration"
            value={structuredData.suppuration}
            onChange={(event) =>
              updateStructuredField("suppuration", event.target.value)
            }
          />

          <input
            className="rounded-xl border p-3"
            placeholder="Mobility"
            value={structuredData.mobility}
            onChange={(event) =>
              updateStructuredField("mobility", event.target.value)
            }
          />

          <input
            className="rounded-xl border p-3"
            placeholder="Furcation involvement"
            value={structuredData.furcation}
            onChange={(event) =>
              updateStructuredField("furcation", event.target.value)
            }
          />

          <input
            className="rounded-xl border p-3"
            placeholder="Recession"
            value={structuredData.recession}
            onChange={(event) =>
              updateStructuredField("recession", event.target.value)
            }
          />

          <input
            className="rounded-xl border p-3"
            placeholder="Plaque/calculus"
            value={structuredData.plaqueCalculus}
            onChange={(event) =>
              updateStructuredField("plaqueCalculus", event.target.value)
            }
          />

          <textarea
            className="rounded-xl border p-3"
            placeholder="Risk factors, e.g. smoking, diabetes, bruxism, OH"
            value={structuredData.riskFactors}
            onChange={(event) =>
              updateStructuredField("riskFactors", event.target.value)
            }
          />

          <textarea
            className="rounded-xl border p-3 md:col-span-2"
            placeholder="Radiographic findings"
            value={structuredData.radiographicFindings}
            onChange={(event) =>
              updateStructuredField(
                "radiographicFindings",
                event.target.value,
              )
            }
          />

          <textarea
            className="rounded-xl border p-3"
            placeholder="Treatment discussed"
            value={structuredData.treatmentDiscussed}
            onChange={(event) =>
              updateStructuredField("treatmentDiscussed", event.target.value)
            }
          />

          <textarea
            className="rounded-xl border p-3"
            placeholder="Consent/risk discussion"
            value={structuredData.consentDiscussion}
            onChange={(event) =>
              updateStructuredField("consentDiscussion", event.target.value)
            }
          />

          <textarea
            className="rounded-xl border p-3 md:col-span-2"
            placeholder="Plan"
            value={structuredData.plan}
            onChange={(event) =>
              updateStructuredField("plan", event.target.value)
            }
          />
        </div>
      </section>

      <section className="rounded-3xl border bg-white p-6 shadow-sm">
        <h2 className="text-xl font-bold text-slate-950">
          3. Generate and approve clinical note
        </h2>

        <button
          type="button"
          onClick={generateNote}
          disabled={working}
          className="mt-4 rounded-xl bg-slate-950 px-5 py-3 font-semibold text-white disabled:opacity-50"
        >
          {working ? "Working..." : "Generate Clinical Note"}
        </button>

        {generatedNote ? (
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <div>
              <h3 className="font-bold text-slate-950">Original AI note</h3>
              <textarea
                className="mt-2 h-96 w-full rounded-2xl border bg-slate-50 p-4 text-sm"
                value={generatedNote}
                readOnly
              />
            </div>

            <div>
              <h3 className="font-bold text-slate-950">
                Clinician approved note
              </h3>
              <textarea
                className="mt-2 h-96 w-full rounded-2xl border p-4 text-sm"
                value={editedNote}
                onChange={(event) => setEditedNote(event.target.value)}
              />

              <button
                type="button"
                onClick={uploadToPraktika}
                disabled={working || !editedNote.trim()}
                className="mt-4 rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
              >
                Upload Approved Note to Praktika
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}