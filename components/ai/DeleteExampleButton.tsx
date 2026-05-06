"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type DeleteExampleButtonProps = {
  id: string;
};

export default function DeleteExampleButton({
  id,
}: DeleteExampleButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function removeExample() {
    const confirmed = window.confirm(
      "Remove this approved example? It will be hidden from future AI use."
    );

    if (!confirmed) return;

    setLoading(true);

    try {
      const res = await fetch("/api/ai/examples/deactivate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id }),
      });

      const text = await res.text();
      const result = text ? JSON.parse(text) : null;

      if (!res.ok) {
        throw new Error(result?.error || "Failed to remove example.");
      }

      router.refresh();
    } catch (error: any) {
      alert(error.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={removeExample}
      disabled={loading}
      className="rounded-2xl border border-red-200 bg-red-50 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {loading ? "Removing..." : "Remove example"}
    </button>
  );
}