"use client";

import { useEffect, useState } from "react";

type Note = {
  id: string;
  body: string;
  created_by_display_name: string | null;
  created_at: string;
};

export default function ConversationNotesPanel({
  conversationId,
}: {
  conversationId: string;
}) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  async function loadNotes() {
    const response = await fetch(
      `/api/reception/notes?conversationId=${conversationId}`
    );

    const data = await response.json();
    setNotes(data.notes || []);
  }

  useEffect(() => {
    loadNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  async function saveNote() {
    if (!body.trim()) return;

    setSaving(true);

    const response = await fetch("/api/reception/notes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        conversationId,
        body,
      }),
    });

    const data = await response.json();

    setSaving(false);

    if (!response.ok) {
      alert(data.error || "Could not save note.");
      return;
    }

    setBody("");
    await loadNotes();
  }

  return (
    <div className="border-b p-5">
      <h3 className="font-semibold text-slate-900">Internal notes</h3>

      <p className="mt-1 text-xs text-slate-500">
        These notes are only visible to staff. They are not sent to the patient.
      </p>

      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder="Add a private note..."
        className="mt-3 h-24 w-full resize-none rounded-xl border border-slate-300 p-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
      />

      <button
        onClick={saveNote}
        disabled={saving || !body.trim()}
        className="mt-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
      >
        {saving ? "Saving..." : "Add note"}
      </button>

      <div className="mt-4 space-y-2">
        {notes.length === 0 && (
          <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">
            No internal notes yet.
          </div>
        )}

        {notes.map((note) => (
          <div key={note.id} className="rounded-xl bg-amber-50 p-3 text-sm">
            <div className="whitespace-pre-wrap text-slate-800">
              {note.body}
            </div>

            <div className="mt-2 text-xs text-slate-500">
              {note.created_by_display_name || "Staff"} ·{" "}
              {new Date(note.created_at).toLocaleString("en-AU")}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}