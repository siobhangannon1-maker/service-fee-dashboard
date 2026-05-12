"use client";

import { useState } from "react";

type ClassificationV2ButtonProps = {
  inboxItemId: string;
  onComplete?: (result: any) => void;
};

export default function ClassificationV2Button({
  inboxItemId,
  onComplete,
}: ClassificationV2ButtonProps) {
  const [loading, setLoading] = useState(false);

  async function runClassificationV2() {
    setLoading(true);

    try {
      const response = await fetch("/api/ai/brain/classify-v2", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inboxItemId,
          source: "workbench_button",
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        alert(result.error || "Classification V2 failed.");
        return;
      }

      onComplete?.(result);
      alert("Classification V2 completed.");
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : "Classification V2 failed.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={runClassificationV2}
      disabled={loading}
      className="rounded-full border border-cyan-200 bg-cyan-50 px-4 py-2 text-sm font-medium text-cyan-800 hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {loading ? "Running V2..." : "Run Classification V2"}
    </button>
  );
}
