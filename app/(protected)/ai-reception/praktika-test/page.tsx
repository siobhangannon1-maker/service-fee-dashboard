"use client";

import { useState } from "react";

type ProbeResult = {
  label: string;
  url: string;
  method: string;
  ok: boolean;
  status: number;
  contentType: string | null;
  responsePreview: string;
  parsedJson: any | null;
  error: string | null;
};

type EndpointHint = {
  source: string;
  kind: string;
  value: string;
};

type PraktikaProbeResponse = {
  success?: boolean;
  probes?: ProbeResult[];
  discoveredScriptUrls?: string[];
  discoveredApiHints?: string[];
  endpointHints?: EndpointHint[];
  error?: string;
};

export default function PraktikaTestPage() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const [probes, setProbes] = useState<ProbeResult[]>([]);
  const [scriptUrls, setScriptUrls] = useState<string[]>([]);
  const [endpointHints, setEndpointHints] = useState<EndpointHint[]>([]);
  const [showRaw, setShowRaw] = useState(false);

  async function runProbe() {
    try {
      setBusy(true);
      setMessage("");
      setProbes([]);
      setScriptUrls([]);
      setEndpointHints([]);

      const response = await fetch("/api/ai/brain/praktika/probe", {
        method: "GET",
        cache: "no-store",
      });

      const text = await response.text();

      let result: PraktikaProbeResponse | null = null;

      try {
        result = JSON.parse(text);
      } catch {
        throw new Error(
          `Probe route did not return valid JSON. Response starts with: ${text.slice(
            0,
            200,
          )}`,
        );
      }

      if (!response.ok) {
        throw new Error(result?.error || "Praktika probe failed.");
      }

      setProbes(Array.isArray(result?.probes) ? result.probes : []);
      setScriptUrls(
        Array.isArray(result?.discoveredScriptUrls)
          ? result.discoveredScriptUrls
          : [],
      );
      setEndpointHints(
        Array.isArray(result?.endpointHints) ? result.endpointHints : [],
      );

      setMessage("Praktika probe completed.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Praktika probe failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  const filteredHints = endpointHints.filter((hint) => {
    const value = hint.value.toLowerCase();

    if (value.includes("github.com")) return false;
    if (value.includes("momentjs.com")) return false;
    if (value.includes("w3.org")) return false;
    if (value.includes("openstreetmap")) return false;
    if (value.includes("googletagmanager")) return false;
    if (value.includes("stripe.com")) return false;
    if (value.includes("paypal.com")) return false;

    return true;
  });

  return (
    <main className="min-h-screen bg-slate-50 p-6 text-slate-900">
      <div className="mx-auto max-w-7xl">
        <h1 className="text-3xl font-bold">Praktika API Discovery</h1>

        <p className="mt-2 text-sm text-slate-500">
          This inspects the Praktika online booking JavaScript bundle and looks
          for endpoint clues. It does not write anything to Praktika.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={runProbe}
            disabled={busy}
            className="rounded-full bg-slate-950 px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? "Running probe..." : "Run Praktika probe"}
          </button>

          <button
            type="button"
            onClick={() => setShowRaw((current) => !current)}
            className="rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-medium text-slate-700"
          >
            {showRaw ? "Hide raw probe results" : "Show raw probe results"}
          </button>
        </div>

        {message ? (
          <div className="mt-5 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
            {message}
          </div>
        ) : null}

        <section className="mt-8">
          <h2 className="text-xl font-semibold">Discovered Script URLs</h2>

          <div className="mt-4 space-y-3">
            {scriptUrls.map((url) => (
              <div
                key={url}
                className="break-all rounded-2xl border border-slate-200 bg-white p-4 font-mono text-xs"
              >
                {url}
              </div>
            ))}

            {scriptUrls.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
                No script URLs discovered yet.
              </div>
            ) : null}
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-xl font-semibold">Likely Endpoint Clues</h2>

          <div className="mt-4 space-y-3">
            {filteredHints.map((hint, index) => (
              <div
                key={`${hint.source}-${hint.kind}-${hint.value}-${index}`}
                className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900"
              >
                <div className="mb-2 flex flex-wrap gap-2">
                  <span className="rounded-full bg-white px-3 py-1 text-xs font-medium">
                    {hint.kind}
                  </span>
                  <span className="break-all text-xs text-emerald-700">
                    {hint.source}
                  </span>
                </div>

                <div className="break-all font-mono text-xs">{hint.value}</div>
              </div>
            ))}

            {filteredHints.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
                No likely endpoint clues discovered yet.
              </div>
            ) : null}
          </div>
        </section>

        {showRaw ? (
          <section className="mt-10">
            <h2 className="text-xl font-semibold">Raw Probe Results</h2>

            <div className="mt-4 space-y-5">
              {probes.map((probe, index) => (
                <div
                  key={`${probe.url}-${index}`}
                  className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                      {probe.status}
                    </span>

                    <span className="text-sm font-semibold">
                      {probe.label}
                    </span>
                  </div>

                  <div className="mt-3 break-all rounded-xl bg-slate-100 p-3 font-mono text-xs">
                    {probe.url}
                  </div>

                  {probe.error ? (
                    <div className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">
                      {probe.error}
                    </div>
                  ) : null}

                  <pre className="mt-3 max-h-96 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-white">
                    {probe.responsePreview}
                  </pre>
                </div>
              ))}

              {probes.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
                  No probe results yet.
                </div>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}