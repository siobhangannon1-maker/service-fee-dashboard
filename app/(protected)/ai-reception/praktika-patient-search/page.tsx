"use client";

import { useState } from "react";

type Patient = {
  id: number;
  title: string | null;
  firstName: string;
  lastName: string;
  preferredName: string;
  dob: string | null;
  mobile: string | null;
  statusId: number;
  dateJoined: string | null;
  patientNumber: number | null;
  isNewPatient: boolean;
  isBadPatient: boolean;
  hasHighMedicalAlert: boolean;
  practiceId: number;
  matchScore: number;
  matchReason: string;
};

export default function PraktikaPatientSearchPage() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dob, setDob] = useState("");
  const [mobile, setMobile] = useState("");

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [patients, setPatients] = useState<Patient[]>([]);

  async function searchPatients() {
    try {
      setBusy(true);
      setMessage("");
      setPatients([]);

      const response = await fetch("/api/ai/brain/praktika/search-patient", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({
          firstName,
          lastName,
          dob,
          mobile,
        }),
      });

      const text = await response.text();

      let result: any = null;

      try {
        result = JSON.parse(text);
      } catch {
        throw new Error(
          `API did not return JSON. Status ${response.status}. Response starts with: ${text.slice(
            0,
            200,
          )}`,
        );
      }

      if (!response.ok) {
        throw new Error(result.error || "Patient search failed.");
      }

      setPatients(Array.isArray(result.patients) ? result.patients : []);
      setMessage("Patient search completed.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Patient search failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6 text-slate-900">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-3xl font-bold">Praktika Patient Search</h1>

        <p className="mt-2 text-sm text-slate-500">
          Read-only patient matching using Praktika patient directory search.
        </p>

        <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="grid gap-4 md:grid-cols-4">
            <label className="block">
              <span className="text-sm font-medium">First name</span>
              <input
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium">Last name</span>
              <input
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium">DOB</span>
              <input
                value={dob}
                onChange={(event) => setDob(event.target.value)}
                placeholder="YYYY-MM-DD"
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium">Mobile</span>
              <input
                value={mobile}
                onChange={(event) => setMobile(event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
          </div>

          <button
            type="button"
            onClick={searchPatients}
            disabled={busy}
            className="mt-5 rounded-full bg-slate-950 px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? "Searching..." : "Search Praktika patients"}
          </button>
        </section>

        {message ? (
          <div className="mt-5 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
            {message}
          </div>
        ) : null}

        <section className="mt-6 space-y-4">
          {patients.map((patient) => (
            <div
              key={`${patient.practiceId}-${patient.id}`}
              className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="text-xl font-bold">
                    {patient.title ? `${patient.title} ` : ""}
                    {patient.firstName} {patient.lastName}
                  </div>

                  <div className="mt-1 text-sm text-slate-500">
                    Patient #{patient.patientNumber || "N/A"} · ID {patient.id}
                  </div>

                  <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
                    <div>DOB: {patient.dob || "Not recorded"}</div>
                    <div>Mobile: {patient.mobile || "Not recorded"}</div>
                    <div>Date joined: {patient.dateJoined || "Not recorded"}</div>
                    <div>Practice ID: {patient.practiceId}</div>
                  </div>

                  <div className="mt-3 text-sm text-slate-600">
                    Match reason: {patient.matchReason}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium">
                    Score {Math.round(patient.matchScore * 100)}%
                  </span>

                  {patient.isNewPatient ? (
                    <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700">
                      New patient
                    </span>
                  ) : (
                    <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700">
                      Existing patient
                    </span>
                  )}

                  {patient.hasHighMedicalAlert ? (
                    <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-medium text-red-700">
                      Medical alert
                    </span>
                  ) : null}

                  {patient.isBadPatient ? (
                    <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-medium text-red-700">
                      Warning flag
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          ))}

          {patients.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
              No patient search results yet.
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}