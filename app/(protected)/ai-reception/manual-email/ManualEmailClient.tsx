"use client";

import { useState } from "react";

export default function ManualEmailClient() {
  const [senderName, setSenderName] = useState("");
  const [senderEmail, setSenderEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function handleSubmit() {
    setLoading(true);
    setMessage("");

    const res = await fetch("/api/ai-reception/manual-email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        senderName,
        senderEmail,
        subject,
        body,
      }),
    });

    const result = await res.json();

    if (!res.ok) {
      setMessage(result.error || "Failed to process email.");
      setLoading(false);
      return;
    }

    setMessage("Email added to AI inbox.");
    setSenderName("");
    setSenderEmail("");
    setSubject("");
    setBody("");
    setLoading(false);
  }

  return (
    <main className="p-6 max-w-3xl">
      <h1 className="text-2xl font-semibold text-slate-900">
        Manual Email Intake
      </h1>

      <p className="mt-2 text-sm text-slate-600">
        Paste an email to classify and generate a draft reply.
      </p>

      {message && (
        <div className="mt-4 rounded-xl border p-3 text-sm">
          {message}
        </div>
      )}

      <div className="mt-6 grid gap-4">
        <input
          placeholder="Sender name"
          value={senderName}
          onChange={(e) => setSenderName(e.target.value)}
          className="border rounded-xl px-4 py-3"
        />

        <input
          placeholder="Sender email"
          value={senderEmail}
          onChange={(e) => setSenderEmail(e.target.value)}
          className="border rounded-xl px-4 py-3"
        />

        <input
          placeholder="Subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className="border rounded-xl px-4 py-3"
        />

        <textarea
          placeholder="Paste email body here..."
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="border rounded-xl px-4 py-3 min-h-40"
        />

        <button
          onClick={handleSubmit}
          disabled={loading}
          className="bg-slate-900 text-white rounded-xl px-4 py-3"
        >
          {loading ? "Processing..." : "Process Email"}
        </button>
      </div>
    </main>
  );
}