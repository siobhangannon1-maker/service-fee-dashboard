"use client";

import { useState } from "react";

type Result = {
  endpoint: string;
  ok: boolean;
  status: number;
  responsePreview: string;
  error: string | null;
};

export default function PraktikaEndpointTestPage() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [results, setResults] = useState<Result[]>([]);

  async function runTests() {
    try {
      setBusy(true);
      setMessage("");
      setResults([]);

      const response = await fetch(
        "/api/ai/brain/praktika/test-endpoints",
        {
          method: "GET",
          cache: "no-store",
        },
      );

      const text = await response.text();

      let result: any = null;

      try {
        result = JSON.parse(text);
      } catch {
        throw new Error(
          `The API route did not return JSON. Status ${response.status}. Response starts with: ${text.slice(
            0,
            300,
          )}`,
        );
      }

      if (!response.ok) {
        throw new Error(result.error || "Endpoint test failed.");
      }

      setResults(Array.isArray(result.results) ? result.results : []);
      setMessage("Endpoint tests completed.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Endpoint test failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6 text-slate-900">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-3xl font-bold">Praktika Endpoint Tester</h1>

        <p className="mt-2 text-sm text-slate-500">
          This safely tests discovered Praktika online booking endpoints.
        </p>

        <button
          type="button"
          onClick={runTests}
          disabled={busy}
          className="mt-6 rounded-full bg-slate-950 px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "Testing..." : "Run Endpoint Tests"}
        </button>

        {message ? (
          <div className="mt-5 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
            {message}
          </div>
        ) : null}

        <div className="mt-8 space-y-6">
          {results.map((result) => (
            <div
              key={result.endpoint}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="flex items-center gap-3">
                <div className="rounded-full bg-slate-100 px-3 py-1 text-xs">
                  {result.status}
                </div>

                <div className="font-semibold">{result.endpoint}</div>
              </div>

              {result.error ? (
                <div className="mt-3 text-sm text-red-600">
                  {result.error}
                </div>
              ) : null}

              <pre className="mt-4 max-h-96 overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-white">
                {result.responsePreview}
              </pre>
            </div>
          ))}

          {results.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
              No endpoint results yet.
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}