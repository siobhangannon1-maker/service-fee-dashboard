import Link from "next/link"
import { cookies } from "next/headers"
import { createServerClient } from "@supabase/ssr"
import { createClient } from "@supabase/supabase-js"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const ALLOWED_ROLES = new Set(["super_admin", "admin", "provider_manager"])

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type AuditEvent = {
  id: string
  actor_full_name: string | null
  actor_initials: string | null
  actor_email: string | null
  action: string
  entity_type: string | null
  entity_id: string | null
  provider_id: string | null
  patient_name: string | null
  details: Record<string, unknown> | null
  created_at: string | null
}

type Provider = {
  id: string
  name: string | null
}

type SearchParams = Promise<{
  fromDate?: string
  toDate?: string
}>

function formatDate(value: string | null | undefined) {
  if (!value) return "—"

  return new Date(value).toLocaleString("en-AU", {
    timeZone: "Australia/Brisbane",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function formatMinutes(minutes: number | null | undefined) {
  if (!minutes || !Number.isFinite(minutes)) return "—"

  if (minutes < 60) return `${Math.round(minutes)} min`

  const hours = Math.floor(minutes / 60)
  const mins = Math.round(minutes % 60)

  return `${hours}h ${mins}m`
}

function getDateOnly(date = new Date()) {
  return date.toISOString().slice(0, 10)
}

function getDefaultFromDate() {
  const date = new Date()
  date.setDate(date.getDate() - 7)
  return getDateOnly(date)
}

function getActorName(event: AuditEvent) {
  return (
    event.actor_full_name ||
    event.actor_email ||
    event.actor_initials ||
    "Unknown user"
  )
}

function getProviderName(
  providerId: string | null | undefined,
  providerMap: Map<string, string>
) {
  if (!providerId) return "Unknown provider"
  return providerMap.get(providerId) || "Unknown provider"
}

function getDetailsString(value: unknown) {
  return typeof value === "string" ? value : ""
}

function minutesBetween(start?: string | null, end?: string | null) {
  if (!start || !end) return null

  const startMs = new Date(start).getTime()
  const endMs = new Date(end).getTime()

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null
  if (endMs < startMs) return null

  return (endMs - startMs) / 1000 / 60
}

function average(values: number[]) {
  const valid = values.filter((value) => Number.isFinite(value) && value >= 0)
  if (valid.length === 0) return null

  return valid.reduce((sum, value) => sum + value, 0) / valid.length
}

async function getCurrentUserRole() {
  const cookieStore = await cookies()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll() {},
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return {
      userId: null,
      role: null,
    }
  }

  const { data: profile } = await serviceSupabase
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .maybeSingle()

  if (profile?.role) {
    return {
      userId: user.id,
      role: String(profile.role),
    }
  }

  const { data: userRole } = await serviceSupabase
    .from("user_roles")
    .select("user_id, role")
    .eq("user_id", user.id)
    .maybeSingle()

  return {
    userId: user.id,
    role: userRole?.role ? String(userRole.role) : null,
  }
}

function KpiCard({
  title,
  value,
  helper,
}: {
  title: string
  value: string | number
  helper: string
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </div>
      <div className="mt-2 text-3xl font-bold text-slate-950">{value}</div>
      <div className="mt-2 text-sm text-slate-500">{helper}</div>
    </div>
  )
}

export default async function ReportWritingProductivityPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const params = await searchParams

  const fromDate = params.fromDate || getDefaultFromDate()
  const toDate = params.toDate || getDateOnly()

  const access = await getCurrentUserRole()

  if (!access.userId || !access.role || !ALLOWED_ROLES.has(access.role)) {
    return (
      <main className="min-h-screen bg-slate-100 p-6">
        <div className="mx-auto max-w-3xl rounded-2xl border border-red-200 bg-red-50 p-6 text-red-800">
          <h1 className="text-2xl font-bold">Access denied</h1>
          <p className="mt-2 text-sm">
            This productivity page is only available to super_admin, admin, and
            provider_manager users.
          </p>
          <Link
            href="/report-writing/dashboard"
            className="mt-4 inline-block rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
          >
            Back to dashboard
          </Link>
        </div>
      </main>
    )
  }

  const startIso = `${fromDate}T00:00:00+10:00`
  const end = new Date(`${toDate}T00:00:00+10:00`)
  end.setDate(end.getDate() + 1)
  const endIso = end.toISOString()

  const [eventsResult, providersResult] = await Promise.all([
    serviceSupabase
      .from("report_writing_audit_events")
      .select("*")
      .gte("created_at", startIso)
      .lt("created_at", endIso)
      .order("created_at", { ascending: true }),

    serviceSupabase.from("providers").select("id, name"),
  ])

  const events = ((eventsResult.data || []) as AuditEvent[]).filter(
    (event) => event.created_at
  )

  const providers = (providersResult.data || []) as Provider[]

  const providerMap = new Map(
    providers.map((provider) => [
      provider.id,
      provider.name || "Unnamed provider",
    ])
  )

  const startedEvents = events.filter(
    (event) => event.action === "Started queue item"
  )

  const draftCreatedEvents = events.filter(
    (event) =>
      event.action === "Created draft report" ||
      event.action === "Created and approved report"
  )

  const approvedEvents = events.filter(
    (event) =>
      event.action === "Approved report" ||
      event.action === "Created and approved report"
  )

  const uploadedEvents = events.filter(
    (event) => event.action === "Uploaded report to Praktika"
  )

  const emailedEvents = events.filter(
    (event) => event.action === "Secure PDF emailed to referrer"
  )

  const completedEvents = events.filter(
    (event) =>
      event.action === "Completed queue item" ||
      event.action === "Secure PDF emailed to referrer" ||
      event.action === "Uploaded report to Praktika"
  )

  const eventsByDraftId = new Map<string, AuditEvent[]>()
  const queueStartByQueueId = new Map<string, AuditEvent>()

  for (const event of events) {
    if (event.entity_type === "report_draft" && event.entity_id) {
      const existing = eventsByDraftId.get(event.entity_id) || []
      existing.push(event)
      eventsByDraftId.set(event.entity_id, existing)
    }

    if (event.action === "Started queue item") {
      const queueId = event.entity_id || getDetailsString(event.details?.queueId)
      if (queueId) queueStartByQueueId.set(queueId, event)
    }
  }

  const draftToCompletedMinutes: number[] = []
  const startToCompletedMinutes: number[] = []

  for (const draftEvents of eventsByDraftId.values()) {
    const firstDraftEvent = draftEvents.find(
      (event) =>
        event.action === "Created draft report" ||
        event.action === "Created and approved report"
    )

    const completeEvent = draftEvents.find(
      (event) =>
        event.action === "Secure PDF emailed to referrer" ||
        event.action === "Uploaded report to Praktika" ||
        event.action === "Completed queue item"
    )

    const draftToComplete = minutesBetween(
      firstDraftEvent?.created_at,
      completeEvent?.created_at
    )

    if (draftToComplete !== null) draftToCompletedMinutes.push(draftToComplete)

    const queueId = getDetailsString(completeEvent?.details?.queueId)
    const startEvent = queueId ? queueStartByQueueId.get(queueId) : null

    const startToComplete = minutesBetween(
      startEvent?.created_at,
      completeEvent?.created_at
    )

    if (startToComplete !== null) startToCompletedMinutes.push(startToComplete)
  }

  const typistRows = Array.from(
    events.reduce((map, event) => {
      const key = event.actor_email || event.actor_full_name || "unknown"
      const existing =
        map.get(key) ||
        ({
          name: getActorName(event),
          email: event.actor_email || "",
          started: 0,
          drafted: 0,
          approved: 0,
          uploaded: 0,
          emailed: 0,
          completed: 0,
          firstActivity: event.created_at,
          lastActivity: event.created_at,
        } as {
          name: string
          email: string
          started: number
          drafted: number
          approved: number
          uploaded: number
          emailed: number
          completed: number
          firstActivity: string | null
          lastActivity: string | null
        })

      if (event.action === "Started queue item") existing.started += 1

      if (
        event.action === "Created draft report" ||
        event.action === "Created and approved report"
      ) {
        existing.drafted += 1
      }

      if (
        event.action === "Approved report" ||
        event.action === "Created and approved report"
      ) {
        existing.approved += 1
      }

      if (event.action === "Uploaded report to Praktika") {
        existing.uploaded += 1
        existing.completed += 1
      }

      if (event.action === "Secure PDF emailed to referrer") {
        existing.emailed += 1
        existing.completed += 1
      }

      if (
        existing.firstActivity &&
        event.created_at &&
        new Date(event.created_at) < new Date(existing.firstActivity)
      ) {
        existing.firstActivity = event.created_at
      }

      if (
        existing.lastActivity &&
        event.created_at &&
        new Date(event.created_at) > new Date(existing.lastActivity)
      ) {
        existing.lastActivity = event.created_at
      }

      map.set(key, existing)
      return map
    }, new Map<string, {
      name: string
      email: string
      started: number
      drafted: number
      approved: number
      uploaded: number
      emailed: number
      completed: number
      firstActivity: string | null
      lastActivity: string | null
    }>())
  )
    .map(([, row]) => row)
    .sort((a, b) => b.completed - a.completed || b.drafted - a.drafted)

  const providerRows = Array.from(
    events.reduce((map, event) => {
      const key = event.provider_id || "unknown"
      const existing =
        map.get(key) ||
        ({
          provider: getProviderName(event.provider_id, providerMap),
          started: 0,
          drafted: 0,
          approved: 0,
          uploaded: 0,
          emailed: 0,
          completed: 0,
        } as {
          provider: string
          started: number
          drafted: number
          approved: number
          uploaded: number
          emailed: number
          completed: number
        })

      if (event.action === "Started queue item") existing.started += 1

      if (
        event.action === "Created draft report" ||
        event.action === "Created and approved report"
      ) {
        existing.drafted += 1
      }

      if (
        event.action === "Approved report" ||
        event.action === "Created and approved report"
      ) {
        existing.approved += 1
      }

      if (event.action === "Uploaded report to Praktika") {
        existing.uploaded += 1
        existing.completed += 1
      }

      if (event.action === "Secure PDF emailed to referrer") {
        existing.emailed += 1
        existing.completed += 1
      }

      map.set(key, existing)
      return map
    }, new Map<string, {
      provider: string
      started: number
      drafted: number
      approved: number
      uploaded: number
      emailed: number
      completed: number
    }>())
  )
    .map(([, row]) => row)
    .sort((a, b) => b.completed - a.completed || a.provider.localeCompare(b.provider))

  const recentEvents = [...events]
    .sort(
      (a, b) =>
        new Date(b.created_at || "").getTime() -
        new Date(a.created_at || "").getTime()
    )
    .slice(0, 30)

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-950">
              Typist Productivity
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Audit-based productivity metrics for report writing.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              href="/report-writing/dashboard"
              className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700"
            >
              Dashboard
            </Link>

            <Link
              href="/report-writing/typist"
              className="rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white"
            >
              Typist Portal
            </Link>
          </div>
        </header>

        <form className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="grid gap-4 md:grid-cols-3">
            <label>
              <div className="mb-1 text-xs font-semibold uppercase text-slate-500">
                From date
              </div>
              <input
                type="date"
                name="fromDate"
                defaultValue={fromDate}
                className="w-full rounded-xl border border-slate-300 p-3"
              />
            </label>

            <label>
              <div className="mb-1 text-xs font-semibold uppercase text-slate-500">
                To date
              </div>
              <input
                type="date"
                name="toDate"
                defaultValue={toDate}
                className="w-full rounded-xl border border-slate-300 p-3"
              />
            </label>

            <div className="flex items-end">
              <button
                type="submit"
                className="w-full rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white"
              >
                Apply filters
              </button>
            </div>
          </div>
        </form>

        {eventsResult.error || providersResult.error ? (
          <section className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <div className="font-bold">Productivity warning</div>

            {eventsResult.error ? (
              <div className="mt-1">Audit error: {eventsResult.error.message}</div>
            ) : null}

            {providersResult.error ? (
              <div className="mt-1">
                Provider error: {providersResult.error.message}
              </div>
            ) : null}
          </section>
        ) : null}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <KpiCard
            title="Started"
            value={startedEvents.length}
            helper="Queue items started"
          />
          <KpiCard
            title="Drafted"
            value={draftCreatedEvents.length}
            helper="Drafts created"
          />
          <KpiCard
            title="Approved"
            value={approvedEvents.length}
            helper="Letters approved"
          />
          <KpiCard
            title="Uploaded"
            value={uploadedEvents.length}
            helper="Uploaded to Praktika"
          />
          <KpiCard
            title="Emailed"
            value={emailedEvents.length}
            helper="Secure PDFs emailed"
          />
          <KpiCard
            title="Avg draft → complete"
            value={formatMinutes(average(draftToCompletedMinutes))}
            helper="Based on linked draft audit events"
          />
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <KpiCard
            title="Completed actions"
            value={completedEvents.length}
            helper="Uploaded and/or emailed completion events"
          />
          <KpiCard
            title="Avg start → complete"
            value={formatMinutes(average(startToCompletedMinutes))}
            helper="Only where queue start can be linked"
          />
          <KpiCard
            title="Active users"
            value={typistRows.length}
            helper="Users with audit activity in this period"
          />
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-5">
            <h2 className="text-xl font-bold text-slate-950">
              Typist summary
            </h2>
            <p className="text-sm text-slate-500">
              Activity grouped by Supabase Auth user.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="p-3">Typist</th>
                  <th className="p-3">Started</th>
                  <th className="p-3">Drafted</th>
                  <th className="p-3">Approved</th>
                  <th className="p-3">Uploaded</th>
                  <th className="p-3">Emailed</th>
                  <th className="p-3">Completed</th>
                  <th className="p-3">First activity</th>
                  <th className="p-3">Last activity</th>
                </tr>
              </thead>

              <tbody>
                {typistRows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="p-6 text-center text-slate-500">
                      No audit events found for this date range.
                    </td>
                  </tr>
                ) : null}

                {typistRows.map((row) => (
                  <tr key={row.email || row.name} className="border-t">
                    <td className="p-3">
                      <div className="font-semibold text-slate-950">
  {row.name.includes("@")
    ? row.name
        .split("@")[0]
        .replace(/[0-9]/g, "")
        .split(/[._]/)
        .filter(Boolean)
        .map(
          (part) =>
            part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
        )
        .join(" ")
    : row.name}
</div>
                    </td>
                    <td className="p-3">{row.started}</td>
                    <td className="p-3">{row.drafted}</td>
                    <td className="p-3">{row.approved}</td>
                    <td className="p-3">{row.uploaded}</td>
                    <td className="p-3">{row.emailed}</td>
                    <td className="p-3 font-semibold text-emerald-700">
                      {row.completed}
                    </td>
                    <td className="p-3 text-slate-500">
                      {formatDate(row.firstActivity)}
                    </td>
                    <td className="p-3 text-slate-500">
                      {formatDate(row.lastActivity)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-5">
            <h2 className="text-xl font-bold text-slate-950">
              Provider workload
            </h2>
            <p className="text-sm text-slate-500">
              Report-writing activity grouped by provider.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="p-3">Provider</th>
                  <th className="p-3">Started</th>
                  <th className="p-3">Drafted</th>
                  <th className="p-3">Approved</th>
                  <th className="p-3">Uploaded</th>
                  <th className="p-3">Emailed</th>
                  <th className="p-3">Completed</th>
                </tr>
              </thead>

              <tbody>
                {providerRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-slate-500">
                      No provider activity found for this date range.
                    </td>
                  </tr>
                ) : null}

                {providerRows.map((row) => (
                  <tr key={row.provider} className="border-t">
                    <td className="p-3 font-semibold text-slate-950">
                      {row.provider}
                    </td>
                    <td className="p-3">{row.started}</td>
                    <td className="p-3">{row.drafted}</td>
                    <td className="p-3">{row.approved}</td>
                    <td className="p-3">{row.uploaded}</td>
                    <td className="p-3">{row.emailed}</td>
                    <td className="p-3 font-semibold text-emerald-700">
                      {row.completed}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-5">
            <h2 className="text-xl font-bold text-slate-950">
              Recent audit events
            </h2>
            <p className="text-sm text-slate-500">
              Latest report-writing audit activity in this date range.
            </p>
          </div>

          <div className="space-y-2 p-4">
            {recentEvents.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                No recent audit events.
              </div>
            ) : null}

            {recentEvents.map((event) => (
              <div
                key={event.id}
                className="rounded-xl border border-slate-200 p-3 text-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-slate-950">
                      {event.action}
                    </div>
                    <div className="mt-1 text-slate-500">
                      {event.patient_name || "No patient recorded"} ·{" "}
                      {getProviderName(event.provider_id, providerMap)}
                    </div>
                    <div className="mt-1 text-xs text-slate-400">
                      {getActorName(event)}
                    </div>
                  </div>

                  <div className="text-xs font-semibold text-slate-500">
                    {formatDate(event.created_at)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}