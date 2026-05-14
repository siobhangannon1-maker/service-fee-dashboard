"use client"

import { useState } from "react"

export default function ReferrerSyncPage() {
  const [jsonText, setJsonText] = useState("")
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState("")

  async function importReferrers() {
    setMessage("")

    if (!jsonText.trim()) {
      alert("Paste Praktika referrer JSON first.")
      return
    }

    let parsedJson: unknown

    try {
      parsedJson = JSON.parse(jsonText)
    } catch {
      alert("The pasted text is not valid JSON.")
      return
    }

    setLoading(true)

    try {
      const response = await fetch("/api/report-writing/referrers/import", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(parsedJson),
      })

      const data = await response.json()

      if (!data.success) {
        alert(data.error || "Import failed.")
        return
      }

      setMessage(
        `Import complete. Imported/updated ${data.imported} referrers. Skipped ${data.skipped}.`
      )
    } catch (error) {
      console.error(error)
      alert("Error importing referrers.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-8">
      <div>
        <h1 className="text-3xl font-bold">Sync Praktika Referrers</h1>
        <p className="mt-2 text-sm text-slate-600">
          Paste the JSON response from Praktika referrals reporting. The app
          will import referrer names, clinics, addresses, and email addresses
          into the searchable report-writing referrer list.
        </p>
      </div>

      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Do not paste browser cookies, session IDs, passwords, or request
        headers here. Only paste the JSON response body.
      </div>

      <textarea
        className="h-[500px] w-full rounded-2xl border border-slate-300 p-4 font-mono text-sm"
        placeholder={`Paste Praktika JSON here, for example:

[
  {
    "vchProvider": "Dr Alex Miotti",
    "vchClinic": "Maven Dental Samuel Street",
    "vchStreetAddress": "39 Samuel St",
    "vchSuburb": "CAMP HILL",
    "vchPostCode": "4152",
    "vchState": "QLD",
    "vchEmail": "samuelstreet@mavendental.com.au"
  }
]`}
        value={jsonText}
        onChange={(e) => setJsonText(e.target.value)}
      />

      <button
        onClick={importReferrers}
        disabled={loading}
        className="rounded-xl bg-slate-950 px-6 py-3 font-semibold text-white disabled:opacity-50"
      >
        {loading ? "Importing..." : "Import Referrers"}
      </button>

      {message ? (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          {message}
        </div>
      ) : null}
    </div>
  )
}