"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type RunPatientMatchButtonProps = {
  inboxItemId: string;
};

export default function RunPatientMatchButton({
  inboxItemId,
}: RunPatientMatchButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function runMatch() {
    setLoading(true);
    setMessage("");

    try {
      const res = await fetch("/api/ai/patient-match/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ inboxItemId }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Patient match failed.");
      }

      setMessage(`Found ${data.matches?.length || 0} possible match(es).`);
      router.refresh();
    } catch (error: any) {
      setMessage(error.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <button
        type="button"
        onClick={runMatch}
        disabled={loading}
        className="rounded-2xl bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? "Matching..." : "Run Patient Match"}
      </button>

      {message ? (
        <p className="max-w-xs text-xs text-purple-700">{message}</p>
      ) : null}
    </div>
  );
}