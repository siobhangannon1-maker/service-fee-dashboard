import PageLayout from "@/components/ui/PageLayout";
import { requireRole } from "@/lib/auth";

type TrendRow = {
  id: string;
  user_id: string;
  score: number;
  created_at: string;
  communication_competencies:
    | {
        name: string;
      }[]
    | null;
};

export default async function CommunicationTrendsPage() {
  const { supabase } = await requireRole([
    "super_admin",
    "admin",
    "practice_manager",
  ]);

  const { data, error } = await supabase
    .from("communication_skill_score_history")
    .select(
      `
      id,
      user_id,
      score,
      created_at,
      communication_competencies (
        name
      )
      `
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as TrendRow[];

  const grouped = groupCompetencies(rows);

  return (
    <PageLayout
      eyebrow="Communication Excellence"
      title="Competency Trends"
      description="Historical communication competency trends across the practice."
    >
      <section className="space-y-6">
        {grouped.map((group) => (
          <div
            key={group.name}
            className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">
                  {group.name}
                </h2>

                <p className="mt-2 text-sm text-slate-500">
                  {group.count} score events recorded
                </p>
              </div>

              <div className="text-right">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Average
                </div>

                <div className="mt-1 text-3xl font-semibold text-slate-950">
                  {group.averageScore}%
                </div>
              </div>
            </div>

            <div className="mt-5 overflow-x-auto rounded-2xl border border-slate-200">
              <table className="min-w-full divide-y divide-slate-100 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-slate-600">
                      Date
                    </th>

                    <th className="px-4 py-3 text-right font-semibold text-slate-600">
                      Score
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100 bg-white">
                  {group.rows.map((row) => (
                    <tr key={row.id}>
                      <td className="px-4 py-3 text-slate-600">
                        {formatDateTime(row.created_at)}
                      </td>

                      <td className="px-4 py-3 text-right font-semibold text-slate-950">
                        {row.score}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </section>
    </PageLayout>
  );
}

function groupCompetencies(rows: TrendRow[]) {
  const map = new Map<
    string,
    {
      name: string;
      rows: TrendRow[];
      count: number;
      total: number;
    }
  >();

  for (const row of rows) {
    const competency = getFirstRelatedRow(
      row.communication_competencies
    );

    const name = competency?.name || "Unknown competency";

    const existing = map.get(name) ?? {
      name,
      rows: [],
      count: 0,
      total: 0,
    };

    existing.rows.push(row);
    existing.count += 1;
    existing.total += Number(row.score || 0);

    map.set(name, existing);
  }

  return Array.from(map.values())
    .map((group) => ({
      ...group,
      averageScore: Math.round(group.total / group.count),
    }))
    .sort((a, b) => a.averageScore - b.averageScore);
}

function getFirstRelatedRow<T>(
  value: T[] | null | undefined
): T | null {
  return Array.isArray(value) ? value[0] ?? null : null;
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