import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import Link from "next/link";

export const dynamic = "force-dynamic";

function formatDate(value: string | null) {
  if (!value) return "—";

  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default async function ArchivedAIWorkbenchPage() {
  await requireRole(["super_admin"]);

  const { data: items, error } = await supabaseAdmin
    .from("ai_inbox_items")
    .select("*")
    .not("archived_at", "is", null)
    .order("archived_at", { ascending: false })
    .limit(200);

  if (error) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-semibold">Archived AI Inbox</h1>
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
            Archived AI Inbox
          </h1>

          <p className="mt-1 text-sm text-slate-600">
            Archived Workbench items, sorted by most recently archived.
          </p>
        </div>

        <Link
          href="/ai/workbench"
          className="w-fit rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Back to Workbench
        </Link>
      </div>

      {!items || items.length === 0 ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-8 text-sm text-slate-600 shadow-sm">
          No archived inbox items found.
        </div>
      ) : (
        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="grid grid-cols-12 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <div className="col-span-3">Archived</div>
            <div className="col-span-3">Subject</div>
            <div className="col-span-2">Patient</div>
            <div className="col-span-2">Category</div>
            <div className="col-span-2">Status</div>
          </div>

          <div className="divide-y divide-slate-100">
            {items.map((item) => (
              <Link
                key={item.id}
                href={`/ai/workbench?item=${item.id}`}
                className="grid grid-cols-12 gap-2 px-4 py-4 text-sm hover:bg-slate-50"
              >
                <div className="col-span-3 text-slate-600">
                  {formatDate(item.archived_at)}
                </div>

                <div className="col-span-3">
                  <p className="font-medium text-slate-900">
                    {item.email_subject || item.subject || item.file_name || "Untitled"}
                  </p>
                  <p className="mt-1 truncate text-xs text-slate-500">
                    From: {item.correspondence_sender_name || item.sender_name || "Unknown"}
                  </p>
                </div>

                <div className="col-span-2 text-slate-700">
                  <p>{item.patient_name || "—"}</p>
                  {item.patient_dob ? (
                    <p className="mt-1 text-xs text-slate-500">
                      DOB: {item.patient_dob}
                    </p>
                  ) : null}
                </div>

                <div className="col-span-2 text-slate-600">
                  {item.category || item.workflow_kind || "—"}
                </div>

                <div className="col-span-2">
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
                    Archived
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}