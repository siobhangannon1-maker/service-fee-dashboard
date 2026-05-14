"use client"

import { useState } from "react"

export default function SyncReferrersButton() {
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState("")

  async function syncPraktikaReferrers() {
    const confirmed = confirm(
      "Sync the latest referrer list from Praktika now?"
    )

    if (!confirmed) return

    setLoading(true)
    setMessage("")

    try {
      const response = await fetch(
        "/api/report-writing/referrers/sync-praktika",
        {
          method: "POST",
        }
      )

      const data = await response.json()

      if (!data.success) {
        alert(data.error || "Sync failed.")
        return
      }

      setMessage(
        `Synced ${data.imported} referrers from Praktika. Skipped ${data.skipped}.`
      )
    } catch (error) {
      console.error(error)
      alert("Error syncing Praktika referrers.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={syncPraktikaReferrers}
        disabled={loading}
        className="inline-flex items-center justify-center rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50"
      >
        {loading ? "Syncing Praktika..." : "Sync Praktika Referrers"}
      </button>

      {message ? (
        <div className="text-xs text-green-700">{message}</div>
      ) : null}
    </div>
  )
}