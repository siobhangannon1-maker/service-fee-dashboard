"use client";

import { useState } from "react";

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function runBrainAnalysis(inboxItemId: string) {
    const res = await fetch("/api/ai/brain/analyse", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ inboxItemId }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "AI Brain analysis failed.");
    }

    return data;
  }

  async function handleUpload() {
    if (!file) {
      setMessage("Please choose a file first.");
      return;
    }

    setLoading(true);
    setMessage("Uploading correspondence...");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const uploadRes = await fetch("/api/ai-reception/upload", {
        method: "POST",
        body: formData,
      });

      const uploadData = await uploadRes.json();

      if (!uploadRes.ok) {
        throw new Error(uploadData.error || "Upload failed.");
      }

      const inboxItemId =
        uploadData.inboxItemId ||
        uploadData.item?.id ||
        uploadData.inbox_item?.id ||
        uploadData.data?.id;

      if (!inboxItemId) {
        setMessage(
          "Upload successful, but no inbox item ID was returned. The item may still appear in the inbox, but AI Brain was not auto-run."
        );
        setFile(null);
        return;
      }

      setMessage("Upload successful. Running AI Brain analysis...");

      await runBrainAnalysis(inboxItemId);

      setMessage(
        "Upload successful. AI Brain analysis created. You can now review it in the Approval Queue."
      );

      setFile(null);
    } catch (error: any) {
      setMessage(error.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="max-w-xl p-6">
      <h1 className="mb-2 text-xl font-semibold text-slate-900">
        Upload Correspondence
      </h1>

      <p className="mb-6 text-sm text-slate-600">
        Upload referrals, letters, x-rays or patient correspondence. Uploaded
        items will be added to the AI Inbox and analysed by the AI Brain.
      </p>

      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <input
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.txt,.doc,.docx"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="block w-full text-sm text-slate-700"
        />

        {file ? (
          <div className="mt-3 rounded-2xl bg-slate-50 p-3 text-sm text-slate-700">
            Selected: {file.name}
          </div>
        ) : null}

        <button
          type="button"
          onClick={handleUpload}
          disabled={loading || !file}
          className="mt-4 rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Processing..." : "Upload and run AI Brain"}
        </button>

        {message ? (
          <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
            {message}
          </div>
        ) : null}
      </div>

      <div className="mt-6 flex gap-2">
        <a
          href="/ai-reception/inbox"
          className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          View AI Inbox
        </a>

        <a
          href="/ai-reception/approval-queue"
          className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          View Approval Queue
        </a>
      </div>
    </main>
  );
}