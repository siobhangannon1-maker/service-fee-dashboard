"use client"

import { useEffect, useMemo, useState } from "react"

type Typist = {
  user_id: string
  full_name: string | null
  email: string | null
  phone: string
}

type Props = {
  providerId: string
}

export default function ProviderToTypistSmsBox({ providerId }: Props) {
  const [typists, setTypists] = useState<Typist[]>([])
  const [selectedTypistId, setSelectedTypistId] = useState("")
  const [body, setBody] = useState("")
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")

  const selectedTypist = useMemo(
    () => typists.find((typist) => typist.user_id === selectedTypistId) || null,
    [typists, selectedTypistId],
  )

  useEffect(() => {
    async function loadTypists() {
      const response = await fetch("/api/report-writing/list-typists")
      const data = await response.json().catch(() => ({}))

      if (data.success) {
        const rows = data.typists || []
        setTypists(rows)
        setSelectedTypistId((current) => current || rows[0]?.user_id || "")
      }
    }

    loadTypists()
  }, [])

  const canSend = Boolean(selectedTypist?.phone && body.trim() && !sending)

  async function sendSms() {
    if (!canSend || !selectedTypist) return

    setSending(true)
    setMessage("")
    setError("")

    try {
      const response = await fetch("/api/report-writing/send-sms-notification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientPhone: selectedTypist.phone,
          recipientUserId: selectedTypist.user_id,
          context: "provider_to_typist",
          providerId,
          body: body.trim(),
        }),
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Could not send SMS.")
      }

      setBody("")
      setMessage("SMS sent.")
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Could not send SMS.")
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="min-w-0 lg:w-72">
          <h3 className="text-base font-semibold text-slate-950">Send SMS</h3>
          <p className="mt-1 text-sm text-slate-500">Send a SMS to your typist.</p>

          <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Typist
          </label>
          <select
            value={selectedTypistId}
            onChange={(event) => setSelectedTypistId(event.target.value)}
            className="mt-1 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          >
            {typists.map((typist) => (
              <option key={typist.user_id} value={typist.user_id}>
                {typist.full_name || typist.email || typist.phone}
              </option>
            ))}
          </select>
        </div>

        <div className="min-w-0 flex-1">
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Message
          </label>
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Send SMS message..."
            className="mt-1 h-24 w-full resize-none rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              {message ? <span className="text-green-700">{message}</span> : null}
              {error ? <span className="text-red-700">{error}</span> : null}
            </div>

            <button
              type="button"
              disabled={!canSend}
              onClick={sendSms}
              className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
            >
              {sending ? "Sending..." : "Send SMS"}
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
