"use client";

import { useEffect, useState } from "react";

type Clinician = {
  id: string;
  clinician_key: string;
  display_name: string;
  role: string | null;
  keywords: string[] | null;
  referring_practitioner_keywords: string[] | null;
  default_trello_board_id: string | null;
  general_list_id: string | null;
  urgent_list_id: string | null;
  radiology_results_list_id: string | null;
  pathology_results_list_id: string | null;
  is_active: boolean;
};

type FormState = {
  id: string;
  clinician_key: string;
  display_name: string;
  role: string;
  keywords: string;
  referring_practitioner_keywords: string;
  default_trello_board_id: string;
  general_list_id: string;
  urgent_list_id: string;
  radiology_results_list_id: string;
  pathology_results_list_id: string;
  is_active: boolean;
};

const emptyForm: FormState = {
  id: "",
  clinician_key: "",
  display_name: "",
  role: "",
  keywords: "",
  referring_practitioner_keywords: "",
  default_trello_board_id: "",
  general_list_id: "",
  urgent_list_id: "",
  radiology_results_list_id: "",
  pathology_results_list_id: "",
  is_active: true,
};

function splitAliases(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinAliases(value: string[] | null | undefined) {
  return Array.isArray(value) ? value.join(", ") : "";
}

function makeClinicianKey(name: string) {
  return name
    .toLowerCase()
    .replace(/^dr\s+/i, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export default function ProviderTrelloSettingsClient() {
  const [clinicians, setClinicians] = useState<Clinician[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [message, setMessage] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  async function loadClinicians() {
    try {
      setLoading(true);
      setMessage("");

      const response = await fetch("/api/ai/brain/clinicians", {
        method: "GET",
        cache: "no-store",
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Could not load providers.");
      }

      setClinicians(Array.isArray(result.clinicians) ? result.clinicians : []);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not load providers.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadClinicians();
  }, []);

  function editClinician(clinician: Clinician) {
    setMessage(
      `Editing ${clinician.display_name}. Make changes above, then click Save provider changes.`,
    );

    setForm({
      id: clinician.id || "",
      clinician_key: clinician.clinician_key || "",
      display_name: clinician.display_name || "",
      role: clinician.role || "",
      keywords: joinAliases(clinician.keywords),
      referring_practitioner_keywords: joinAliases(
        clinician.referring_practitioner_keywords,
      ),
      default_trello_board_id: clinician.default_trello_board_id || "",
      general_list_id: clinician.general_list_id || "",
      urgent_list_id: clinician.urgent_list_id || "",
      radiology_results_list_id: clinician.radiology_results_list_id || "",
      pathology_results_list_id: clinician.pathology_results_list_id || "",
      is_active: clinician.is_active !== false,
    });
  }

  function resetForm() {
    setForm(emptyForm);
    setDeleteId(null);
    setMessage("");
  }

  async function saveClinician() {
    if (!form.display_name.trim()) {
      setMessage("Provider name is required.");
      return;
    }

    const clinicianKey =
      form.clinician_key.trim() || makeClinicianKey(form.display_name);

    try {
      setBusy(true);
      setMessage("");

      const response = await fetch("/api/ai/brain/clinicians", {
        method: form.id ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: form.id || undefined,
          clinician_key: clinicianKey,
          display_name: form.display_name.trim(),
          role: form.role.trim() || null,
          keywords: splitAliases(form.keywords),
          referring_practitioner_keywords: splitAliases(
            form.referring_practitioner_keywords,
          ),
          default_trello_board_id:
            form.default_trello_board_id.trim() || null,
          general_list_id: form.general_list_id.trim() || null,
          urgent_list_id: form.urgent_list_id.trim() || null,
          radiology_results_list_id:
            form.radiology_results_list_id.trim() || null,
          pathology_results_list_id:
            form.pathology_results_list_id.trim() || null,
          is_active: form.is_active,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Could not save provider.");
      }

      setMessage(form.id ? "Provider updated." : "Provider added.");
      setForm(emptyForm);
      await loadClinicians();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not save provider.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function deleteClinician(id: string) {
    try {
      setBusy(true);
      setMessage("");

      const response = await fetch("/api/ai/brain/clinicians", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Could not delete provider.");
      }

      setMessage("Provider deleted.");
      setDeleteId(null);

      if (form.id === id) {
        setForm(emptyForm);
      }

      await loadClinicians();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not delete provider.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6 text-slate-900">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Provider Trello Routing</h1>
          <p className="mt-1 text-sm text-slate-500">
            Add provider aliases and Trello board/list IDs. The AI Reception
            brain uses these to route items to the correct clinician board.
          </p>
        </div>

        {message ? (
          <div className="mb-4 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            {message}
          </div>
        ) : null}

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold">
            {form.id ? `Edit provider: ${form.display_name}` : "Add provider"}
          </h2>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium">Provider display name</span>
              <input
                value={form.display_name}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    display_name: event.target.value,
                    clinician_key:
                      current.clinician_key ||
                      makeClinicianKey(event.target.value),
                  }))
                }
                placeholder="Dr Benjamin Fu"
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium">Provider key</span>
              <input
                value={form.clinician_key}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    clinician_key: event.target.value,
                  }))
                }
                placeholder="benjamin_fu"
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium">Role</span>
              <input
                value={form.role}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    role: event.target.value,
                  }))
                }
                placeholder="Provider"
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </label>

            <label className="flex items-center gap-2 pt-7 text-sm">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    is_active: event.target.checked,
                  }))
                }
              />
              Active
            </label>

            <label className="block md:col-span-2">
              <span className="text-sm font-medium">Aliases / keywords</span>
              <input
                value={form.keywords}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    keywords: event.target.value,
                  }))
                }
                placeholder="benjamin fu, ben fu, dr ben fu, dr b fu"
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
              <p className="mt-1 text-xs text-slate-500">
                Separate aliases with commas.
              </p>
            </label>

            <label className="block md:col-span-2">
              <span className="text-sm font-medium">
                Referring practitioner aliases
              </span>
              <input
                value={form.referring_practitioner_keywords}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    referring_practitioner_keywords: event.target.value,
                  }))
                }
                placeholder="dr william huynh, dr will huynh, dr w huynh"
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium">Trello board ID</span>
              <input
                value={form.default_trello_board_id}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    default_trello_board_id: event.target.value,
                  }))
                }
                placeholder="Board ID"
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium">General list ID</span>
              <input
                value={form.general_list_id}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    general_list_id: event.target.value,
                  }))
                }
                placeholder="General list ID"
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium">Urgent list ID</span>
              <input
                value={form.urgent_list_id}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    urgent_list_id: event.target.value,
                  }))
                }
                placeholder="Urgent list ID"
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium">Radiology list ID</span>
              <input
                value={form.radiology_results_list_id}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    radiology_results_list_id: event.target.value,
                  }))
                }
                placeholder="Radiology list ID"
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium">Pathology list ID</span>
              <input
                value={form.pathology_results_list_id}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    pathology_results_list_id: event.target.value,
                  }))
                }
                placeholder="Pathology list ID"
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={saveClinician}
              disabled={busy}
              className="rounded-full bg-slate-950 px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {form.id ? "Save provider changes" : "Save provider"}
            </button>

            <button
              type="button"
              onClick={resetForm}
              disabled={busy}
              className="rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-medium text-slate-700 disabled:opacity-50"
            >
              Clear
            </button>
          </div>
        </section>

        <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">Configured providers</h2>

            <button
              type="button"
              onClick={loadClinicians}
              disabled={busy || loading}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 disabled:opacity-50"
            >
              Reload
            </button>
          </div>

          {loading ? (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
              Loading providers...
            </div>
          ) : null}

          {!loading ? (
            <div className="mt-4 space-y-3">
              {clinicians.map((clinician) => (
                <div
                  key={clinician.id}
                  className="rounded-2xl border border-slate-200 p-4"
                >
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="font-bold">
                        {clinician.display_name}
                      </div>

                      <div className="text-sm text-slate-500">
                        {clinician.clinician_key}
                      </div>

                      <div className="mt-2 text-xs text-slate-500">
                        Aliases: {joinAliases(clinician.keywords) || "None"}
                      </div>

                      <div className="mt-1 text-xs text-slate-500">
                        Referrer aliases:{" "}
                        {joinAliases(
                          clinician.referring_practitioner_keywords,
                        ) || "None"}
                      </div>

                      <div className="mt-2 grid gap-1 text-xs text-slate-500 md:grid-cols-2">
                        <div>
                          Board:{" "}
                          {clinician.default_trello_board_id || "Not set"}
                        </div>
                        <div>
                          General: {clinician.general_list_id || "Not set"}
                        </div>
                        <div>
                          Urgent: {clinician.urgent_list_id || "Not set"}
                        </div>
                        <div>
                          Radiology:{" "}
                          {clinician.radiology_results_list_id || "Not set"}
                        </div>
                        <div>
                          Pathology:{" "}
                          {clinician.pathology_results_list_id || "Not set"}
                        </div>
                      </div>

                      <div className="mt-2 text-xs">
                        <span
                          className={`rounded-full px-2 py-1 ${
                            clinician.is_active
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {clinician.is_active ? "Active" : "Inactive"}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => editClinician(clinician)}
                        disabled={busy}
                        className="rounded-full border border-slate-200 px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
                      >
                        Edit
                      </button>

                      {deleteId === clinician.id ? (
                        <>
                          <button
                            type="button"
                            onClick={() => deleteClinician(clinician.id)}
                            disabled={busy}
                            className="rounded-full border border-red-200 bg-red-600 px-4 py-2 text-sm text-white disabled:opacity-50"
                          >
                            Confirm delete
                          </button>

                          <button
                            type="button"
                            onClick={() => setDeleteId(null)}
                            disabled={busy}
                            className="rounded-full border border-slate-200 px-4 py-2 text-sm disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setDeleteId(clinician.id)}
                          disabled={busy}
                          className="rounded-full border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 hover:bg-red-100 disabled:opacity-50"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {clinicians.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-sm text-slate-500">
                  No providers configured yet.
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}