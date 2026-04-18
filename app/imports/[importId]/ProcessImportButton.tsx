"use client";

import { useState } from "react";

type Props = {
  importId: string;
};

export default function ProcessImportButton({ importId }: Props) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("Ready");
  const [debug, setDebug] = useState(`Received importId: ${importId}`);

  async function handleProcess() {
    console.log("BUTTON CLICKED");
    console.log("importId from props:", importId);

    if (!importId) {
      setMessage("Error: No import ID found");
      setDebug("importId prop is missing");
      return;
    }

    setLoading(true);
    setMessage("Starting processing...");
    setDebug(`Calling API with importId: ${importId}`);

    try {
      const res = await fetch(`/api/imports/${importId}/process`, {
        method: "POST",
      });

      const data = await res.json().catch(() => ({}));

      console.log("API status:", res.status);
      console.log("API data:", data);

      if (res.ok) {
        const rowCount = data?.result?.rowCount ?? 0;
        const normalizedCount = data?.result?.normalizedCount ?? 0;
        const matchedProviderCount = data?.result?.matchedProviderCount ?? 0;
        const needsReviewCount = data?.result?.needsReviewCount ?? 0;

        setMessage(
          `Processing successful. Raw rows: ${rowCount}. Normalized rows: ${normalizedCount}. Matched providers: ${matchedProviderCount}. Needs review: ${needsReviewCount}.`
        );
        setDebug("API call succeeded");
      } else {
        setMessage(`Error: ${data?.error || "Processing failed"}`);
        setDebug(`API call failed with status ${res.status}`);
      }
    } catch (error) {
      console.error("handleProcess error:", error);
      setMessage("Error: Something went wrong while calling the API");
      setDebug(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleProcess}
        disabled={loading}
        style={{
          padding: "12px 18px",
          backgroundColor: loading ? "#999" : "#0070f3",
          color: "#fff",
          border: "none",
          borderRadius: "6px",
          cursor: loading ? "not-allowed" : "pointer",
          marginBottom: "16px",
        }}
      >
        {loading ? "Processing..." : "Read CSV and Save Rows"}
      </button>

      <div
        style={{
          padding: "12px",
          background: "#f5f5f5",
          borderRadius: "6px",
          marginBottom: "12px",
        }}
      >
        <strong>Status:</strong> {message}
      </div>

      <div
        style={{
          padding: "12px",
          background: "#fafafa",
          border: "1px solid #ddd",
          borderRadius: "6px",
        }}
      >
        <strong>Debug:</strong> {debug}
      </div>
    </div>
  );
}