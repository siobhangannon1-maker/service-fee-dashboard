"use client";

import { useState } from "react";

export default function PraktikaAssistedFilingTest() {
  const [patientId, setPatientId] = useState("");
  const [noteText, setNoteText] = useState(
    "AI ACTION LOG\nEmail received\nTrello task created\nReply drafted\nAttachment added to patient file"
  );
  const [files, setFiles] = useState<FileList | null>(null);
  const [status, setStatus] = useState("");
  const [response, setResponse] = useState<any>(null);

  async function submit() {
    setStatus("Filing to Praktika...");
    setResponse(null);

    const formData = new FormData();
    formData.append("patientId", patientId);
    formData.append("noteText", noteText);

    if (files) {
      Array.from(files).forEach((file) => {
        formData.append("files", file);
      });
    }

    const res = await fetch("/api/praktika/patient-filing/test", {
      method: "POST",
      body: formData,
    });

    const json = await res.json();
    setResponse(json);

    if (json.ok) {
      setStatus("Done. Check the dummy patient in Praktika.");
    } else {
      setStatus(json.error || "Failed.");
    }
  }

  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <div className="text-sm font-semibold uppercase tracking-[0.14em] text-amber-900">
        Praktika Assisted Filing Test
      </div>

      <p className="mt-2 text-sm text-amber-900">
        Use this only with a dummy/test patient first.
      </p>

      <div className="mt-4 grid gap-3">
        <label className="block">
          <div className="mb-1 text-xs font-medium text-amber-900">
            Praktika patient ID
          </div>
          <input
            value={patientId}
            onChange={(event) => setPatientId(event.target.value)}
            className="w-full rounded-lg border border-amber-300 px-3 py-2 text-sm"
            placeholder="e.g. 2588622"
          />
        </label>

        <label className="block">
          <div className="mb-1 text-xs font-medium text-amber-900">
            Files: PDF to Communications, JPG/PNG to Images
          </div>
          <input
            type="file"
            multiple
            accept=".pdf,.jpg,.jpeg,.png"
            onChange={(event) => setFiles(event.target.files)}
            className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm"
          />
        </label>

        <label className="block">
          <div className="mb-1 text-xs font-medium text-amber-900">
            AI action note
          </div>
          <textarea
            value={noteText}
            onChange={(event) => setNoteText(event.target.value)}
            className="min-h-32 w-full rounded-lg border border-amber-300 px-3 py-2 text-sm"
          />
        </label>

        <button
          type="button"
          onClick={submit}
          disabled={!patientId.trim()}
          className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          File to dummy patient
        </button>

        {status ? <p className="text-sm text-amber-900">{status}</p> : null}

        {response ? (
          <pre className="max-h-96 overflow-auto rounded-xl bg-white p-3 text-xs text-slate-800">
            {JSON.stringify(response, null, 2)}
          </pre>
        ) : null}
      </div>
    </section>
  );
}