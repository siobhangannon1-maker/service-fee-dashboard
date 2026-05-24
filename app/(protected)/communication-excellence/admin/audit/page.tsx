import PageLayout from "@/components/ui/PageLayout";
import { requireRole } from "@/lib/auth";

type AuditRow = {
  id: string;
  created_at: string;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, any>;
};

type ProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
};

const COMMUNICATION_ACTIONS = [
  "communication_module_created",
  "communication_module_updated",
  "communication_quiz_question_created",
  "communication_quiz_question_deleted",
  "communication_module_competency_linked",
  "communication_module_competency_unlinked",
  "communication_training_assigned",
  "communication_training_attempted",
  "communication_training_completed",
  "communication_microlearning_assigned",
"communication_microlearning_completed",
"communication_scenario_created",
"communication_scenario_updated",
"communication_scenario_competency_linked",
"communication_scenario_competency_unlinked",
"communication_scenario_started",
"communication_scenario_completed",
"communication_practice_rule_created",
"communication_practice_rule_updated",
];

export default async function CommunicationAuditPage() {
  const { supabase } = await requireRole([
    "super_admin",
    "admin",
    "practice_manager",
  ]);

  const { data: auditData, error: auditError } = await supabase
    .from("audit_log")
    .select(
      "id, created_at, actor_user_id, action, entity_type, entity_id, metadata"
    )
    .in("action", COMMUNICATION_ACTIONS)
    .order("created_at", { ascending: false })
    .limit(200);

  if (auditError) {
    throw new Error(auditError.message);
  }

  const auditRows = (auditData ?? []) as AuditRow[];

  const actorIds = Array.from(
    new Set(
      auditRows
        .map((row) => row.actor_user_id)
        .filter((value): value is string => Boolean(value))
    )
  );

  const { data: profilesData } =
    actorIds.length > 0
      ? await supabase
          .from("profiles")
          .select("id, full_name, email")
          .in("id", actorIds)
      : { data: [] };

  const profiles = (profilesData ?? []) as ProfileRow[];
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));

  return (
    <PageLayout
      eyebrow="Communication Excellence"
      title="Audit History"
      description="Review Communication Excellence module, quiz, assignment and completion history."
    >
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">
              Recent activity
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Showing the latest 200 Communication Excellence audit events.
            </p>
          </div>

          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">
            {auditRows.length} events
          </div>
        </div>

        <div className="mt-6 overflow-x-auto rounded-2xl border border-slate-200">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-slate-600">
                  Date
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600">
                  Actor
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600">
                  Action
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600">
                  Entity
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600">
                  Details
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100 bg-white">
              {auditRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-8 text-center text-slate-500"
                  >
                    No Communication Excellence audit events yet.
                  </td>
                </tr>
              ) : (
                auditRows.map((row) => {
                  const actor = row.actor_user_id
                    ? profileById.get(row.actor_user_id)
                    : null;

                  return (
                    <tr key={row.id} className="align-top hover:bg-slate-50">
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                        {formatDateTime(row.created_at)}
                      </td>

                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                        {actor?.full_name || actor?.email || "Unknown"}
                      </td>

                      <td className="px-4 py-3">
                        <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 ring-1 ring-blue-200">
                          {formatAction(row.action)}
                        </span>
                      </td>

                      <td className="px-4 py-3 text-slate-600">
                        <div>{row.entity_type}</div>
                        {row.entity_id ? (
                          <div className="mt-1 max-w-[180px] truncate text-xs text-slate-400">
                            {row.entity_id}
                          </div>
                        ) : null}
                      </td>

                      <td className="min-w-[280px] px-4 py-3">
                        <MetadataBlock metadata={row.metadata || {}} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </PageLayout>
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

function formatAction(action: string) {
  return action
    .replace(/^communication_/, "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function MetadataBlock({ metadata }: { metadata: Record<string, any> }) {
  const entries = Object.entries(metadata);

  if (entries.length === 0) {
    return <span className="text-slate-400">—</span>;
  }

  return (
    <div className="space-y-1">
      {entries.slice(0, 6).map(([key, value]) => (
        <div key={key} className="grid grid-cols-[120px_1fr] gap-3 text-xs">
          <div className="font-semibold text-slate-500">{key}</div>
          <div className="break-words text-slate-700">
            {formatMetadataValue(value)}
          </div>
        </div>
      ))}

      {entries.length > 6 ? (
        <div className="text-xs text-slate-400">
          +{entries.length - 6} more field(s)
        </div>
      ) : null}
    </div>
  );
}

function formatMetadataValue(value: any) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}