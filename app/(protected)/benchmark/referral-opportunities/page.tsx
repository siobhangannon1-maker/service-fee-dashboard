"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Prospect = {
  id: string;
  practice_name: string;
  address: string | null;
  suburb: string | null;
  post_code: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  google_rating: number | null;
  google_user_ratings_total: number | null;
  is_existing_referrer: boolean;
  matched_referrer_id: string | null;
  updated_at: string | null;
};


const LOCATIONS = [
  { label: "Coorparoo", latitude: -27.506971, longitude: 153.063376 },
  { label: "Paddington", latitude: -27.4594, longitude: 153.0008 },
  { label: "Carindale", latitude: -27.5056, longitude: 153.1023 },
  { label: "Mount Gravatt", latitude: -27.5333, longitude: 153.0833 },
  { label: "Wynnum", latitude: -27.445, longitude: 153.173 },
  { label: "Capalaba", latitude: -27.522, longitude: 153.191 },
  { label: "Chermside", latitude: -27.384, longitude: 153.032 },
  { label: "Toowong", latitude: -27.485, longitude: 152.992 },
  { label: "Kenmore", latitude: -27.507872, longitude: 152.93866 },
  { label: "Oxley", latitude: -27.549906, longitude: 152.974411 },
  { label: "Corinda", latitude: -27.537989, longitude: 152.98204 },
  { label: "Cannon Hill", latitude: -27.47197, longitude: 153.087952 },
  { label: "Sunnybank", latitude: -27.575283, longitude: 153.055724 },
  { label: "Herston", latitude: -27.445076, longitude: 153.020737 },
  { label: "Aspley", latitude: -27.363853, longitude: 1153.017273 },
  { label: "Wavell Heights", latitude: -27.395879, longitude: 153.048943 },
  { label: "Indooroopilly", latitude: -27.506561, longitude: 152.982278},
  { label: "Springwood", latitude: -27.611, longitude: 153.127 },
  { label: "Loganholme", latitude: -27.684, longitude: 153.187 },
  { label: "Cleveland", latitude: -27.526, longitude: 153.265 },
  { label: "Ashgrove", latitude: -27.445, longitude: 152.992 },
];

export default function ReferralOpportunitiesPage() {
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [selectedLocation, setSelectedLocation] = useState("Coorparoo");
  const [radiusMeters, setRadiusMeters] = useState(5000);
  const [tab, setTab] = useState<"non-referrers" | "existing" | "all">(
    "non-referrers"
  );
  const [loading, setLoading] = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);
  const [message, setMessage] = useState("");

  const location = LOCATIONS.find((item) => item.label === selectedLocation)!;

  async function loadProspects() {
    try {
      const res = await fetch("/api/referral-opportunities/list", {
        cache: "no-store",
      });

      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.error || "Failed to load opportunities.");
      }

      setProspects(json.prospects || []);
    } catch (error: any) {
      setMessage(error?.message || "Failed to load opportunities.");
    }
  }

  async function syncOneLocation(targetLocation = location) {
    const res = await fetch("/api/referral-opportunities/sync-google-places", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        latitude: targetLocation.latitude,
        longitude: targetLocation.longitude,
        radiusMeters,
      }),
    });

    const json = await res.json();

    if (!res.ok) {
      throw new Error(
        json.error || `Sync failed for ${targetLocation.label}.`
      );
    }

    return json;
  }

  async function syncGooglePlaces() {
    setLoading(true);
    setMessage("");

    try {
      const json = await syncOneLocation(location);
      setMessage(`${location.label}: ${json.message || "Sync complete."}`);
      await loadProspects();
    } catch (error: any) {
      setMessage(error?.message || "Sync failed.");
    } finally {
      setLoading(false);
    }
  }

  async function syncAllTargetSuburbs() {
    const confirmed = window.confirm(
      `Sync all ${LOCATIONS.length} target suburbs?\n\nThis will call Google Places once per suburb and may use Places API quota.`
    );

    if (!confirmed) return;

    setSyncingAll(true);
    setMessage("Starting sync for all target suburbs...");

    let totalFound = 0;
    let totalUpserted = 0;
    const errors: string[] = [];

    try {
      for (let index = 0; index < LOCATIONS.length; index++) {
        const target = LOCATIONS[index];

        setMessage(
          `Syncing ${target.label} (${index + 1} of ${LOCATIONS.length})...`
        );

        try {
          const result = await syncOneLocation(target);
          totalFound += Number(result.found || 0);
          totalUpserted += Number(result.upserted || 0);
        } catch (error: any) {
          errors.push(`${target.label}: ${error?.message || "Sync failed"}`);
        }
      }

      await loadProspects();

      setMessage(
        `Finished syncing all target suburbs. Found ${totalFound} places and saved/updated ${totalUpserted}.` +
          (errors.length ? `\n\nErrors:\n${errors.join("\n")}` : "")
      );
    } finally {
      setSyncingAll(false);
    }
  }

  useEffect(() => {
    loadProspects();
  }, []);

  const filtered = useMemo(() => {
    if (tab === "non-referrers") {
      return prospects.filter((item) => !item.is_existing_referrer);
    }

    if (tab === "existing") {
      return prospects.filter((item) => item.is_existing_referrer);
    }

    return prospects;
  }, [prospects, tab]);

  const nonReferrers = prospects.filter((item) => !item.is_existing_referrer);
  const existing = prospects.filter((item) => item.is_existing_referrer);

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">
              Referral Opportunities
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Find nearby dental practices that do not appear to be referring yet.
            </p>
          </div>

          <Link
            href="/benchmark/referrals"
            className="rounded-2xl border bg-white px-4 py-2 text-sm hover:bg-slate-100"
          >
            Back to Referral Map
          </Link>
        </div>

        <section className="rounded-3xl border bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Search nearby dentists</h2>

          <div className="mt-4 grid gap-4 md:grid-cols-4">
            <label>
              <div className="mb-1 text-sm font-medium">Search centre</div>
              <select
                value={selectedLocation}
                onChange={(event) => setSelectedLocation(event.target.value)}
                className="w-full rounded-2xl border bg-white px-3 py-2"
              >
                {LOCATIONS.map((item) => (
                  <option key={item.label} value={item.label}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <div className="mb-1 text-sm font-medium">Radius</div>
              <select
                value={radiusMeters}
                onChange={(event) => setRadiusMeters(Number(event.target.value))}
                className="w-full rounded-2xl border bg-white px-3 py-2"
              >
                <option value={2000}>2 km</option>
                <option value={5000}>5 km</option>
                <option value={10000}>10 km</option>
              </select>
            </label>

            <div className="flex items-end">
              <button
                onClick={syncGooglePlaces}
                disabled={loading || syncingAll}
                className="w-full rounded-2xl bg-slate-900 px-4 py-2 text-white disabled:opacity-50"
              >
                {loading ? "Syncing..." : "Search selected suburb"}
              </button>
            </div>

            <div className="flex items-end">
              <button
                onClick={syncAllTargetSuburbs}
                disabled={loading || syncingAll}
                className="w-full rounded-2xl bg-emerald-600 px-4 py-2 text-white disabled:opacity-50"
              >
                {syncingAll ? "Syncing all..." : "Search all target suburbs"}
              </button>
            </div>
          </div>

          <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
            Target suburbs: {LOCATIONS.map((item) => item.label).join(", ")}
          </div>

          {message && (
            <div className="mt-4 whitespace-pre-wrap rounded-2xl border bg-slate-50 p-4 text-sm">
              {message}
            </div>
          )}
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-3xl border bg-white p-5 shadow-sm">
            <div className="text-sm text-slate-500">Non-referrers</div>
            <div className="mt-2 text-3xl font-semibold">
              {nonReferrers.length}
            </div>
          </div>

          <div className="rounded-3xl border bg-white p-5 shadow-sm">
            <div className="text-sm text-slate-500">Existing referrers</div>
            <div className="mt-2 text-3xl font-semibold">{existing.length}</div>
          </div>

          <div className="rounded-3xl border bg-white p-5 shadow-sm">
            <div className="text-sm text-slate-500">Total practices found</div>
            <div className="mt-2 text-3xl font-semibold">{prospects.length}</div>
          </div>
        </section>

        <section className="rounded-3xl border bg-white p-6 shadow-sm">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setTab("non-referrers")}
              className={`rounded-2xl px-4 py-2 text-sm ${
                tab === "non-referrers"
                  ? "bg-slate-900 text-white"
                  : "border bg-white"
              }`}
            >
              Non-referrers
            </button>

            <button
              onClick={() => setTab("existing")}
              className={`rounded-2xl px-4 py-2 text-sm ${
                tab === "existing"
                  ? "bg-slate-900 text-white"
                  : "border bg-white"
              }`}
            >
              Existing referrers
            </button>

            <button
              onClick={() => setTab("all")}
              className={`rounded-2xl px-4 py-2 text-sm ${
                tab === "all" ? "bg-slate-900 text-white" : "border bg-white"
              }`}
            >
              All
            </button>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b bg-slate-50">
                  <th className="px-3 py-2 text-left">Practice</th>
                  <th className="px-3 py-2 text-left">Suburb</th>
                  <th className="px-3 py-2 text-left">Rating</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Address</th>
                </tr>
              </thead>

              <tbody>
                {filtered.map((item) => (
                  <tr key={item.id} className="border-b">
                    <td className="px-3 py-2 font-medium">
                      {item.practice_name}
                    </td>
                    <td className="px-3 py-2">
                      {item.suburb || "-"} {item.post_code || ""}
                    </td>
                    <td className="px-3 py-2">
                      {item.google_rating
                        ? `${item.google_rating} (${item.google_user_ratings_total || 0})`
                        : "-"}
                    </td>
                    <td className="px-3 py-2">
                      {item.is_existing_referrer ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs text-emerald-700">
                          Existing referrer
                        </span>
                      ) : (
                        <span className="rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-700">
                          Opportunity
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {item.address || "-"}
                    </td>
                  </tr>
                ))}

                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-4 text-slate-500">
                      No practices found yet. Run a Google Places sync first.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}