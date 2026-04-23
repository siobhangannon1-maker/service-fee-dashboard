import Link from "next/link";
import { requireAdmin } from "@/lib/requireAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";

type AuditLogRow = {
  id: string;
  created_at: string;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  billing_period_id: string | null;
  provider_id: string | null;
  metadata: {
    patient_name?: string;
    category?: string;
    amount?: number;
    notes?: string;
    reviewer_initials?: string | null;
    review_status?: string | null;
    review_source?: string | null;
  } | null;
};

type Provider = {
  id: string;
  name: string;
};

type BillingPeriod = {
  id: string;
  label: string;
  month: number;
  year: number;
};

type AdminUserRecord = {
  id: string;
  email?: string;
  user_metadata?: {
    full_name?: string;
    name?: string;
  };
};

function formatAction(action: string) {
  switch (action) {
    case "patient_entry_created":
      return "Created";
    case "patient_entry_updated":
      return "Updated";
    case "patient_entry_deleted":
      return "Deleted";
    case "patient_entry_reviewed":
      return "Reviewed and locked";
    case "patient_entry_review_removed":
      return "Review removed";
    case "patient_entry_updated_from_review":
      return "Updated from review page";
    case "patient_entry_deleted_from_review":
      return "Deleted from review page";
    default:
      return action;
  }
}

function formatCategory(category?: string) {
  switch (category) {
    case "lab_implant_materials":
      return "Lab / Implants / Materials";
    case "fees_paid_to_focus":
      return "Patient Fees Paid to Focus";
    case "fees_paid_in_error":
      return "Patient Fees Paid in Error";
    case "fees_owed":
      return "Patient Fees Owed";
    case "paid_to_wrong_provider":
      return "Paid to Wrong Provider";
    default:
      return category || "—";
  }
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatReviewDetails(metadata: AuditLogRow["metadata"]) {
  if (!metadata) return "—";

  const parts: string[] = [];

  if (metadata.reviewer_initials) {
    parts.push(`Reviewed by ${metadata.reviewer_initials}`);
  }

  if (metadata.review_status === "verified_locked") {
    parts.push("Locked");
  }

  if (metadata.review_status === "review_removed") {
    parts.push("Review removed");
  }

  if (metadata.review_source === "review_page") {
    parts.push("Changed in review page");
  }

  return parts.length > 0 ? parts.join(" • ") : "—";
}

const ENTRY_PAGE_PATH = "/patient-entries";

export default async function PatientEntryLogPage() {
  const { supabase } = await requireAdmin();

  const [{ data: logs, error: logsError }, { data: providers }, { data: billingPeriods }] =
    await Promise.all([
      supabase
        .from("audit_log")
        .select("*")
        .eq("entity_type", "patient_financial_entry")
        .order("created_at", { ascending: false })
        .limit(200),
      supabase.from("providers").select("id, name").order("name"),
      supabase
        .from("billing_periods")
        .select("id, label, month, year")
        .order("year", { ascending: false })
        .order("month", { ascending: false }),
    ]);

  if (logsError) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-4 sm:px-6 sm:py-6">
        <div className="mx-auto max-w-7xl">
          <h1 className="text-2xl font-semibold sm:text-3xl">
            Patient Entry Audit Log
          </h1>
          <div className="mt-6 rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">
            Error loading audit log: {logsError.message}
          </div>
        </div>
      </main>
    );
  }

  const typedLogs = (logs || []) as AuditLogRow[];

  const actorIds = Array.from(
    new Set(
      typedLogs
        .map((row) => row.actor_user_id)
        .filter((value): value is string => Boolean(value))
    )
  );

  let userDisplayMap = new Map<string, string>();

  if (actorIds.length > 0) {
    const { data: adminUsers, error: usersError } =
      await supabaseAdmin.auth.admin.listUsers();

    if (!usersError) {
      const matchingUsers = (adminUsers.users || []).filter((user) =>
        actorIds.includes(user.id)
      ) as AdminUserRecord[];

      userDisplayMap = new Map(
        matchingUsers.map((user) => [
          user.id,
          user.user_metadata?.full_name?.trim() ||
            user.user_metadata?.name?.trim() ||
            user.email ||
            user.id,
        ])
      );
    }
  }

  const providerMap = new Map(
    ((providers || []) as Provider[]).map((provider) => [provider.id, provider.name])
  );

  const billingPeriodMap = new Map(
    ((billingPeriods || []) as BillingPeriod[]).map((period) => [
      period.id,
      period.label || `${period.month}/${period.year}`,
    ])
  );

  const rows = typedLogs.map((row) => ({
    ...row,
    actorDisplay: row.actor_user_id
      ? userDisplayMap.get(row.actor_user_id) || row.actor_user_id
      : "—",
    providerName: row.provider_id
      ? providerMap.get(row.provider_id) || "Unknown provider"
      : "—",
    billingPeriodLabel: row.billing_period_id
      ? billingPeriodMap.get(row.billing_period_id) || "Unknown period"
      : "—",
  }));

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-4 sm:px-6 sm:py-6">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold sm:text-3xl">
              Patient Entry Audit Log
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Admin-only history of created, updated, deleted, and reviewed patient entries.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href="/patient-entries/review"
              className="inline-flex rounded-2xl border bg-white px-4 py-3 text-sm font-medium shadow-sm"
            >
              Open Review Page
            </Link>

            <Link
              href={ENTRY_PAGE_PATH}
              className="inline-flex rounded-2xl border bg-white px-4 py-3 text-sm font-medium shadow-sm"
            >
              Open Patient Entries
            </Link>
          </div>
        </div>

        <div className="mt-6 rounded-3xl border bg-white p-4 shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b bg-slate-50">
                  <th className="px-4 py-3 font-medium">When</th>
                  <th className="px-4 py-3 font-medium">Action</th>
                  <th className="px-4 py-3 font-medium">User</th>
                  <th className="px-4 py-3 font-medium">Patient</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium">Amount</th>
                  <th className="px-4 py-3 font-medium">Provider</th>
                  <th className="px-4 py-3 font-medium">Billing Period</th>
                  <th className="px-4 py-3 font-medium">Review</th>
                  <th className="px-4 py-3 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-10 text-center text-slate-500">
                      No audit log entries found.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.id} className="border-b align-top last:border-b-0">
                      <td className="px-4 py-3 whitespace-nowrap">
                        {formatDateTime(row.created_at)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {formatAction(row.action)}
                      </td>
                      <td className="px-4 py-3 break-all">{row.actorDisplay}</td>
                      <td className="px-4 py-3">{row.metadata?.patient_name || "—"}</td>
                      <td className="px-4 py-3">{formatCategory(row.metadata?.category)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {typeof row.metadata?.amount === "number"
                          ? `$${Number(row.metadata.amount).toLocaleString("en-AU", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}`
                          : "—"}
                      </td>
                      <td className="px-4 py-3">{row.providerName}</td>
                      <td className="px-4 py-3">{row.billingPeriodLabel}</td>
                      <td className="px-4 py-3">{formatReviewDetails(row.metadata)}</td>
                      <td className="px-4 py-3">{row.metadata?.notes || "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  );
}