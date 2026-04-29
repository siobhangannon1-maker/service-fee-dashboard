"use client";

import { useState } from "react";

export default function SyncGoogleReviewsButton() {
  const [isSyncing, setIsSyncing] = useState(false);
  const [message, setMessage] = useState("");

  async function handleSync() {
    try {
      setIsSyncing(true);
      setMessage("");

      const response = await fetch("/api/google-reviews/sync", {
        method: "POST",
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || "Google review sync failed");
      }

      setMessage(
        `Synced ${result.reviews_saved} reviews from ${result.locations_checked} locations.`
      );

      window.location.reload();
    } catch (error: any) {
      setMessage(error?.message || "Could not sync Google reviews.");
    } finally {
      setIsSyncing(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: "6px" }}>
      <button
        type="button"
        onClick={handleSync}
        disabled={isSyncing}
        style={{
          padding: "10px 14px",
          borderRadius: "12px",
          border: "1px solid #16a34a",
          backgroundColor: isSyncing ? "#86efac" : "#16a34a",
          color: "#ffffff",
          fontWeight: 800,
          cursor: isSyncing ? "not-allowed" : "pointer",
          whiteSpace: "nowrap",
        }}
      >
        {isSyncing ? "Syncing..." : "Sync Google Reviews"}
      </button>

      {message ? (
        <div
          style={{
            fontSize: "12px",
            color: message.toLowerCase().includes("could not")
              ? "#b91c1c"
              : "#166534",
            fontWeight: 700,
          }}
        >
          {message}
        </div>
      ) : null}
    </div>
  );
}