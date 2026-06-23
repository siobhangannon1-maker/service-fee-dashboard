"use client";

import { useState } from "react";

type Props = {
  selectedProviderId?: string | null;
};

export default function TypistProviderSmsBox({ selectedProviderId }: Props) {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  const canSend = Boolean(message.trim() && !sending);

  async function sendSms() {
    setStatusMessage("");

    if (!selectedProviderId) {
      setStatusMessage("Please select a provider first.");
      return;
    }

    if (!message.trim()) {
      setStatusMessage("Please type an SMS message.");
      return;
    }

    setSending(true);

    try {
      const response = await fetch("/api/report-writing/send-sms-notification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId: selectedProviderId,
          message: message.trim(),
          source: "typist_to_provider",
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || "SMS could not be sent.");
      }

      setMessage("");
      setStatusMessage("SMS sent.");
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "SMS could not be sent."
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-900">Send SMS to provider</h3>

      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Send SMS message..."
        className="mt-3 min-h-[88px] w-full resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
      />

      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="text-xs text-slate-500">{statusMessage}</div>

        <button
          type="button"
          onClick={sendSms}
          disabled={!canSend}
          className={
            canSend
              ? "rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              : "cursor-not-allowed rounded-xl bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-400"
          }
        >
          {sending ? "Sending..." : "Send SMS"}
        </button>
      </div>
    </section>
  );
}