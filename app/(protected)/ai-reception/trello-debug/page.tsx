"use client";

import { useEffect, useState } from "react";

type TrelloList = {
  id: string;
  name?: string;
  board_id?: string;
  board_name?: string;
  board_url?: string;
  idBoard?: string;
};

export default function TrelloDebugPage() {
  const [lists, setLists] = useState<TrelloList[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadLists() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/ai/brain/trello-lists", {
        method: "GET",
        cache: "no-store",
      });

      const text = await response.text();

      let result: any;

      try {
        result = JSON.parse(text);
      } catch {
        throw new Error(
          `The Trello API route did not return JSON. Status ${response.status}. Response starts with: ${text.slice(
            0,
            150,
          )}`,
        );
      }

      if (!response.ok) {
        throw new Error(result.error || "Could not load Trello lists.");
      }

      setLists(Array.isArray(result.lists) ? result.lists : []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load Trello lists.",
      );
      setLists([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadLists();
  }, []);

  return (
    <main className="min-h-screen bg-slate-50 p-6 text-slate-900">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-2xl font-bold">Trello Debug</h1>

        <p className="mt-2 text-sm text-slate-500">
          Use this page to copy Trello board IDs and list IDs.
        </p>

        <button
          type="button"
          onClick={loadLists}
          disabled={loading}
          className="mt-5 rounded-full bg-slate-950 px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {loading ? "Loading..." : "Reload Trello lists"}
        </button>

        {error ? (
          <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        {!error && loading ? (
          <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
            Loading Trello lists...
          </div>
        ) : null}

        {!loading && !error ? (
          <div className="mt-6 space-y-4">
            {lists.map((list) => (
              <div
                key={list.id}
                className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className="grid gap-5 md:grid-cols-2">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Board Name
                    </div>
                    <div className="mt-1 text-lg font-bold">
                      {list.board_name || "Board name not returned"}
                    </div>

                    <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Board ID
                    </div>
                    <div className="mt-1 rounded-xl bg-slate-100 p-3 font-mono text-xs break-all">
                      {list.board_id || list.idBoard || "Board ID not returned"}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      List Name
                    </div>
                    <div className="mt-1 text-lg font-bold">
                      {list.name || "Unnamed list"}
                    </div>

                    <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">
                      List ID
                    </div>
                    <div className="mt-1 rounded-xl bg-slate-100 p-3 font-mono text-xs break-all">
                      {list.id}
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {lists.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
                No Trello lists found.
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </main>
  );
}