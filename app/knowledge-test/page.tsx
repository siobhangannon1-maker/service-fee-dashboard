"use client";

import { useState } from "react";

type SearchResult = {
  id: string;
  title: string;
  heading: string | null;
  content: string;
  similarity: number;
};

export default function KnowledgeTestPage() {
  const [query, setQuery] = useState(
    "Patient has swelling after wisdom teeth surgery"
  );

  const [results, setResults] = useState<SearchResult[]>([]);

  const [loading, setLoading] = useState(false);

  async function handleSearch() {
    setLoading(true);

    try {
      const response = await fetch("/api/knowledge/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
        }),
      });

      const data = await response.json();

      setResults(data.results ?? []);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="mb-6 text-3xl font-bold">
        Knowledge Search Test
      </h1>

      <div className="mb-6 flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 rounded border p-3"
        />

        <button
          onClick={handleSearch}
          className="rounded bg-black px-4 py-2 text-white"
        >
          {loading ? "Searching..." : "Search"}
        </button>
      </div>

      <div className="space-y-4">
        {results.map((result) => (
          <div
            key={result.id}
            className="rounded border p-4 shadow-sm"
          >
            <div className="mb-2 flex items-center justify-between">
              <div>
                <h2 className="font-semibold">
                  {result.title}
                </h2>

                <p className="text-sm text-gray-500">
                  {result.heading}
                </p>
              </div>

              <div className="text-sm text-gray-500">
                {(result.similarity * 100).toFixed(1)}%
              </div>
            </div>

            <pre className="whitespace-pre-wrap rounded bg-gray-50 p-3 text-sm">
              {result.content}
            </pre>
          </div>
        ))}
      </div>
    </main>
  );
}