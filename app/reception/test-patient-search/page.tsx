// src/app/reception/test-patient-search/page.tsx

"use client";

import { useState } from "react";

type Patient = {
  id: number;
  firstName: string | null;
  lastName: string | null;
  preferredName: string | null;
  dob: string | null;
  mobile: string | null;
  patientNumber: number | null;
  hasHighMedicalAlert: boolean;
};

export default function TestPatientSearchPage() {
  const [query, setQuery] = useState("");
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(false);

  async function searchPatients(value: string) {
    setQuery(value);

    if (value.trim().length < 2) {
      setPatients([]);
      return;
    }

    setLoading(true);

    const response = await fetch(
      `/api/praktika/patient-search?q=${encodeURIComponent(value)}`
    );

    const data = await response.json();

    setPatients(data.patients || []);
    setLoading(false);
  }

  return (
    <main className="p-6 max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Patient Search Test</h1>
        <p className="text-sm text-gray-600">
          Search Praktika patients and cache selected results locally.
        </p>
      </div>

      <input
        className="w-full border rounded-lg p-3"
        value={query}
        onChange={(event) => searchPatients(event.target.value)}
        placeholder="Search patient name..."
      />

      {loading && <p className="text-sm text-gray-500">Searching...</p>}

      <div className="space-y-2">
        {patients.map((patient) => (
          <div
            key={patient.id}
            className="border rounded-xl p-4 bg-white flex justify-between"
          >
            <div>
              <div className="font-medium">
                {patient.firstName} {patient.lastName}
              </div>
              <div className="text-sm text-gray-600">
                Patient #{patient.patientNumber} · DOB {patient.dob || "—"} ·{" "}
                {patient.mobile || "No mobile"}
              </div>
            </div>

            {patient.hasHighMedicalAlert && (
              <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded">
                Medical alert
              </span>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}