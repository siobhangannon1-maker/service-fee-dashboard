import Link from "next/link";

import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function formatDate(value: string | null) {
  if (!value) return "—";

  try {
    return new Intl.DateTimeFormat("en-AU", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function percent(value: number | null) {
  if (typeof value !== "number") return "—";
  return `${Math.round(value * 100)}%`;
}

export default async function ClassificationV2Page() {
  await requireRole(["super_admin"]);

  const { data: results, error } = await supabaseAdmin
    .from("ai_classification_v2_results")
    .select(
      `
      *,
      ai_inbox_items (
        id,
        email_subject,
        subject,
        patient_name,
        patient_dob,
        category,
        workflow_kind,
        assigned_clinician_name,
        created_at
      )
      `,
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-semibold">Classification V2</h1>
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error.message}
        </div>
      </main>
    );
  }

  return (
    <main className="space-y-6 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Classification Engine V2
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Shadow-mode results from the new classifier. Use this page to compare
            V2 behaviour before switching automation over.
          </p>
        </div>

        <Link
          href="/ai/workbench"
          className="w-fit rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Back to Workbench
        </Link>
      </div>

      {!results || results.length === 0 ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-8 text-sm text-slate-600 shadow-sm">
          No V2 classification results yet. Run V2 from an inbox item first.
        </div>
      ) : (
        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="grid grid-cols-12 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <div className="col-span-2">Date</div>
            <div className="col-span-3">Item</div>
            <div className="col-span-2">V2 workflow</div>
            <div className="col-span-2">Provider</div>
            <div className="col-span-1">Confidence</div>
            <div className="col-span-2">Actions</div>
          </div>

          <div className="divide-y divide-slate-100">
            {results.map((result: any) => {
              const item = result.ai_inbox_items;

              return (
                <section
                  key={result.id}
                  className="grid grid-cols-12 gap-3 px-4 py-4 text-sm"
                >
                  <div className="col-span-2 text-slate-600">
                    {formatDate(result.created_at)}
                  </div>

                  <div className="col-span-3">
                    <p className="font-medium text-slate-900">
                      {item?.email_subject || item?.subject || "Untitled"}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {item?.patient_name || "No patient"}{" "}
                      {item?.patient_dob ? `· DOB ${item.patient_dob}` : ""}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      V1: {item?.workflow_kind || item?.category || "—"}
                    </p>
                  </div>

                  <div className="col-span-2">
                    <p className="font-medium text-slate-900">
                      {result.workflow_kind || "—"}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {result.primary_category || "—"}
                    </p>
                  </div>

                  <div className="col-span-2 text-slate-700">
                    <p>{result.internal_focus_clinician_name || "—"}</p>
                    {result.internal_focus_clinician_reason ? (
                      <p className="mt-1 line-clamp-2 text-xs text-slate-500">
                        {result.internal_focus_clinician_reason}
                      </p>
                    ) : null}
                  </div>

                  <div className="col-span-1 text-slate-700">
                    {percent(result.confidence)}
                  </div>

                  <div className="col-span-2 space-y-2">
                    {item?.id ? (
                      <Link
                        href={`/ai/workbench?item=${item.id}`}
                        className="inline-flex rounded-2xl border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Open item
                      </Link>
                    ) : null}

                    <details className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                      <summary className="cursor-pointer text-xs font-medium text-slate-700">
                        Evidence
                      </summary>
                      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-xs text-slate-600">
                        {JSON.stringify(
                          {
                            evidence: result.evidence,
                            risks: result.risks,
                            missing_information: result.missing_information,
                            recommended_next_step:
                              result.recommended_next_step,
                          },
                          null,
                          2,
                        )}
                      </pre>
                    </details>
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}
    </main>
  );
}
