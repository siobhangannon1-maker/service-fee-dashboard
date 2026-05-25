import { revalidatePath } from "next/cache";
import Link from "next/link";
import PageLayout from "@/components/ui/PageLayout";
import { requireRole } from "@/lib/auth";

type SyncRunRow = {
  id: string;
  status: string;
  sync_type: string;
  started_at: string;
  finished_at: string | null;
  imported_count: number;
  skipped_count: number;
  error_count: number;
  notes: string | null;
};

type ImportedCallRow = {
  id: string;
  external_call_id: string;
  import_status: string;
  call_started_at: string | null;
  call_direction: string | null;
  caller_number: string | null;
  callee_number: string | null;
  duration_seconds: number | null;
  call_review_id: string | null;
  created_at: string;
};

async function runMockMaxotelSync() {
  "use server";

  const { supabase, user } = await requireRole([
    "super_admin",
    "admin",
    "practice_manager",
  ]);

  const { data: syncRun, error: syncError } = await supabase
    .from("communication_maxotel_sync_runs")
    .insert({
      status: "running",
      sync_type: "manual_mock",
      started_by: user.id,
      notes: "Manual mock sync run for testing MaxoTel sync architecture.",
      metadata: {
        source: "mock",
      },
    })
    .select("id")
    .single();

  if (syncError) throw new Error(syncError.message);

  const syncRunId = syncRun.id;

  const { data: mappings, error: mappingError } = await supabase
    .from("communication_maxotel_location_mappings")
    .select("*")
    .eq("import_enabled", true)
    .order("created_at", { ascending: true });

  if (mappingError) {
    await markSyncFailed({
      supabase,
      syncRunId,
      message: mappingError.message,
    });
    throw new Error(mappingError.message);
  }

  const firstMapping = mappings?.[0] ?? null;

  const mockCalls = [
    {
      external_call_id: `mock-${new Date().toISOString().slice(0, 10)}-001`,
      call_direction: "inbound",
      caller_number: "0400000001",
      callee_number: firstMapping?.extension_number || "101",
      duration_seconds: 242,
      call_started_at: new Date().toISOString(),
      maxotel_location_mapping_id: firstMapping?.id ?? null,
      reviewed_user_id: firstMapping?.fallback_user_id ?? null,
      raw_payload: {
        source: "mock",
        note: "This is a fake MaxoTel call record for testing sync infrastructure.",
      },
    },
    {
      external_call_id: `mock-${new Date().toISOString().slice(0, 10)}-002`,
      call_direction: "outbound",
      caller_number: firstMapping?.extension_number || "101",
      callee_number: "0400000002",
      duration_seconds: 385,
      call_started_at: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
      maxotel_location_mapping_id: firstMapping?.id ?? null,
      reviewed_user_id: firstMapping?.fallback_user_id ?? null,
      raw_payload: {
        source: "mock",
        note: "Second fake MaxoTel call record for duplicate-prevention testing.",
      },
    },
  ];

  let importedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const call of mockCalls) {
    const { data: existing, error: existingError } = await supabase
      .from("communication_maxotel_imported_calls")
      .select("id")
      .eq("external_call_id", call.external_call_id)
      .maybeSingle();

    if (existingError) {
      errorCount += 1;
      continue;
    }

    if (existing) {
      skippedCount += 1;
      continue;
    }

    const { error: insertError } = await supabase
      .from("communication_maxotel_imported_calls")
      .insert({
        sync_run_id: syncRunId,
        ...call,
        import_status: "imported_metadata_only",
      });

    if (insertError) {
      errorCount += 1;
    } else {
      importedCount += 1;
    }
  }

  const finalStatus = errorCount > 0 ? "completed_with_errors" : "completed";

  const { error: updateError } = await supabase
    .from("communication_maxotel_sync_runs")
    .update({
      status: finalStatus,
      finished_at: new Date().toISOString(),
      imported_count: importedCount,
      skipped_count: skippedCount,
      error_count: errorCount,
      metadata: {
        source: "mock",
        mapping_used: firstMapping?.id ?? null,
      },
    })
    .eq("id", syncRunId);

  if (updateError) throw new Error(updateError.message);

  await supabase.from("audit_log").insert({
    action: "communication_maxotel_mock_sync_run",
    entity_type: "communication_maxotel_sync_run",
    entity_id: syncRunId,
    actor_user_id: user.id,
    metadata: {
      imported_count: importedCount,
      skipped_count: skippedCount,
      error_count: errorCount,
      status: finalStatus,
    },
  });

  revalidatePath("/communication-excellence/admin/integrations/maxotel/sync");
}

export default async function MaxotelSyncPage() {
  const { supabase } = await requireRole([
    "super_admin",
    "admin",
    "practice_manager",
  ]);

  const [runsResult, importedCallsResult] = await Promise.all([
    supabase
      .from("communication_maxotel_sync_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(20),

    supabase
      .from("communication_maxotel_imported_calls")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  if (runsResult.error) throw new Error(runsResult.error.message);
  if (importedCallsResult.error) {
    throw new Error(importedCallsResult.error.message);
  }

  const runs = (runsResult.data ?? []) as SyncRunRow[];
  const importedCalls = (importedCallsResult.data ?? []) as ImportedCallRow[];

  const totalImported = importedCalls.length;
  const metadataOnly = importedCalls.filter(
    (call) => call.import_status === "imported_metadata_only"
  ).length;
  const reviewed = importedCalls.filter((call) => call.call_review_id).length;

  return (
    <PageLayout
      eyebrow="Communication Excellence"
      title="MaxoTel Sync"
      description="Safe sync dashboard for testing imports, duplicate prevention and future scheduled MaxoTel call syncing."
    >
      <div className="flex flex-wrap gap-3">
        <Link
          href="/communication-excellence/admin/integrations/maxotel"
          className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
        >
          ← Back to MaxoTel settings
        </Link>

        <Link
          href="/communication-excellence/admin/integrations/maxotel/locations"
          className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
        >
          Location mappings
        </Link>

        <Link
          href="/communication-excellence/admin/integrations/maxotel/import-call"
          className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
        >
          Import test call
        </Link>
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        <MetricCard title="Imported calls" value={String(totalImported)} />
        <MetricCard title="Metadata only" value={String(metadataOnly)} />
        <MetricCard title="Reviewed" value={String(reviewed)} />
      </section>

      <section className="rounded-3xl border border-blue-200 bg-blue-50 p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">
              Manual mock sync
            </h2>

            <p className="mt-2 text-sm leading-6 text-slate-700">
              This creates fake MaxoTel call metadata and tests duplicate
              prevention. It does not call the live MaxoTel API.
            </p>
          </div>

          <form action={runMockMaxotelSync}>
            <button className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white">
              Run mock sync
            </button>
          </form>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">Sync runs</h2>

        <div className="mt-5 overflow-x-auto rounded-2xl border border-slate-200">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <TableHead label="Started" />
                <TableHead label="Status" />
                <TableHead label="Type" />
                <TableHead label="Imported" align="right" />
                <TableHead label="Skipped" align="right" />
                <TableHead label="Errors" align="right" />
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100 bg-white">
              {runs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    No sync runs yet.
                  </td>
                </tr>
              ) : (
                runs.map((run) => (
                  <tr key={run.id}>
                    <TableCell>{formatDateTime(run.started_at)}</TableCell>
                    <TableCell>
                      <StatusBadge label={run.status} />
                    </TableCell>
                    <TableCell>{formatLabel(run.sync_type)}</TableCell>
                    <TableCell align="right">{run.imported_count}</TableCell>
                    <TableCell align="right">{run.skipped_count}</TableCell>
                    <TableCell align="right">{run.error_count}</TableCell>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">
          Imported call metadata
        </h2>

        <div className="mt-5 overflow-x-auto rounded-2xl border border-slate-200">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <TableHead label="Call ID" />
                <TableHead label="Time" />
                <TableHead label="Direction" />
                <TableHead label="Caller" />
                <TableHead label="Callee" />
                <TableHead label="Duration" align="right" />
                <TableHead label="Status" />
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100 bg-white">
              {importedCalls.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    No imported calls yet.
                  </td>
                </tr>
              ) : (
                importedCalls.map((call) => (
                  <tr key={call.id}>
                    <TableCell>{call.external_call_id}</TableCell>
                    <TableCell>
                      {call.call_started_at
                        ? formatDateTime(call.call_started_at)
                        : "—"}
                    </TableCell>
                    <TableCell>{formatLabel(call.call_direction || "—")}</TableCell>
                    <TableCell>{call.caller_number || "—"}</TableCell>
                    <TableCell>{call.callee_number || "—"}</TableCell>
                    <TableCell align="right">
                      {call.duration_seconds
                        ? `${Math.round(call.duration_seconds / 60)} min`
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge label={formatLabel(call.import_status)} />
                    </TableCell>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </PageLayout>
  );
}

async function markSyncFailed({
  supabase,
  syncRunId,
  message,
}: {
  supabase: any;
  syncRunId: string;
  message: string;
}) {
  await supabase
    .from("communication_maxotel_sync_runs")
    .update({
      status: "failed",
      finished_at: new Date().toISOString(),
      error_count: 1,
      notes: message,
    })
    .eq("id", syncRunId);
}

function MetricCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </div>

      <div className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
        {value}
      </div>
    </div>
  );
}

function TableHead({
  label,
  align = "left",
}: {
  label: string;
  align?: "left" | "right";
}) {
  return (
    <th
      className={[
        "px-4 py-3 font-semibold text-slate-600",
        align === "right" ? "text-right" : "text-left",
      ].join(" ")}
    >
      {label}
    </th>
  );
}

function TableCell({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <td
      className={[
        "whitespace-nowrap px-4 py-3 text-slate-700",
        align === "right" ? "text-right" : "text-left",
      ].join(" ")}
    >
      {children}
    </td>
  );
}

function StatusBadge({ label }: { label: string }) {
  return (
    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold capitalize text-slate-600">
      {label}
    </span>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-AU", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatLabel(value: string) {
  if (!value || value === "—") return "—";
  return value.replaceAll("_", " ");
}