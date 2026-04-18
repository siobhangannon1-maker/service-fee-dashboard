"use client";

import { useState } from "react";

export default function UploadPageClient() {
  const [file, setFile] = useState<File | null>(null);
  const [month, setMonth] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleUpload() {
    if (!file || !month) {
      alert("Please select file and month");
      return;
    }

    setLoading(true);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("month", month);

    const res = await fetch("/api/imports/upload", {
      method: "POST",
      body: formData,
    });

    const data = await res.json();

    setLoading(false);

    if (res.ok) {
      alert("Upload successful");
      window.location.href = `/imports/${data.importId}`;
    } else {
      alert(data.error);
    }
  }

  return (
    <div style={{ padding: 20 }}>
      <h1>Upload CSV</h1>

      <div style={{ marginBottom: 10 }}>
        <label>Month:</label>
        <input
          type="text"
          placeholder="e.g. 2026-03"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        />
      </div>

      <div style={{ marginBottom: 10 }}>
        <input
          type="file"
          accept=".csv"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />
      </div>

      <button onClick={handleUpload} disabled={loading}>
        {loading ? "Uploading..." : "Upload"}
      </button>
    </div>
  );
}