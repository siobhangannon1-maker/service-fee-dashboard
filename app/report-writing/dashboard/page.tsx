import Link from "next/link"
import { createClient } from "@supabase/supabase-js"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const AEST_TIME_ZONE = "Australia/Brisbane"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type Provider = {
  id: string
  name: string | null
  is_active?: boolean | null
  archived?: boolean | null
}

type QueueItem = {
  id: string
  provider_id: string | null
  patient_first_name: string | null
  patient_last_name: string | null
  patient_dob: string | null
  appointment_time: string | null
  queue_reason: string | null
  status: string | null
  report_draft_id?: string | null
  praktika_patient_id?: string | null
  raw_json?: Record<string, unknown> | null
}

type Draft = {
  id: string
  provider_id: string | null
  patient_name: string | null
  patient_dob: string | null
  report_type: string | null
  status: string | null
  created_at: string | null
  uploaded_to_praktika_at?: string | null
  emailed_to_referrer_at?: string | null
}

function getAestDateKey(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: AEST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })

  return formatter.format(date)
}

function getTodayRangeAest() {
  const todayKey = getAestDateKey()
  const startIso = `${todayKey}T00:00:00+10:00`
  const endDate = new Date(`${todayKey}T00:00:00+10:00`)
  endDate.setDate(endDate.getDate() + 1)

  const endKey = getAestDateKey(endDate)

  const label = new Intl.DateTimeFormat("en-AU", {
    timeZone: AEST_TIME_ZONE,
    weekday: "long",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${todayKey}T12:00:00+10:00`))

  return {
    todayKey,
    startIso,
    endIso: `${endKey}T00:00:00+10:00`,
    label,
  }
}

function patientNameFromQueue(item: QueueItem) {
  return [item.patient_first_name, item.patient_last_name]
    .filter(Boolean)
    .join(" ")
    .trim()
}

function formatTimeAest(value: string | null | undefined) {
  if (!value) return "No time"

  try {
    return new Intl.DateTimeFormat("en-AU", {
      timeZone: AEST_TIME_ZONE,
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(value))
  } catch {
    return "No time"
  }
}

function clean(value: unknown) {
  return String(value ?? "").trim()
}

function getRawProviderName(item: QueueItem) {
  const raw = item.raw_json || {}

  return (
    clean(raw.praktika_provider) ||
    clean(raw.vchProvider) ||
    clean(raw.provider) ||
    clean(raw.Provider) ||
    clean(raw.provider_name) ||
    clean(raw.vchPractitioner) ||
    clean(raw.practitioner) ||
    ""
  )
}

function providerName(
  providerId: string | null | undefined,
  providerMap: Map<string, string>,
  item?: QueueItem
) {
  if (providerId && providerMap.has(providerId)) {
    return providerMap.get(providerId) || "Unknown provider"
  }

  if (item) {
    const rawProvider = getRawProviderName(item)

    if (rawProvider) return rawProvider
  }

  return "Unmatched provider"
}

function isDraftCompleted(draft: Draft) {
  return Boolean(draft.uploaded_to_praktika_at || draft.emailed_to_referrer_at)
}

function getStatusBadgeClass(status: string | null | undefined) {
  if (status === "completed") return "bg-emerald-100 text-emerald-700"
  if (status === "started") return "bg-amber-100 text-amber-700"
  if (status === "queued") return "bg-blue-100 text-blue-700"
  if (status === "awaiting_provider_approval") {
    return "bg-purple-100 text-purple-700"
  }
  if (status === "approved") return "bg-emerald-100 text-emerald-700"
  return "bg-slate-200 text-slate-700"
}

function Card({
  title,
  value,
  helper,
  accent,
  href,
}: {
  title: string
  value: number
  helper: string
  accent?: string
  href?: string
}) {
  const card = (
    <div
      className={[
        "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition",
        href ? "hover:border-blue-300 hover:shadow-md" : "",
      ].join(" ")}
    >
      <div className="text-sm font-semibold text-slate-500">{title}</div>
      <div
        className={["mt-2 text-4xl font-bold", accent || "text-slate-950"].join(
          " "
        )}
      >
        {value}
      </div>
      <div className="mt-2 text-sm text-slate-500">{helper}</div>
      {href ? (
        <div className="mt-3 text-xs font-semibold text-blue-700">
          View details →
        </div>
      ) : null}
    </div>
  )

  if (!href) return card

  return (
    <Link href={href} className="block">
      {card}
    </Link>
  )
}

export default async function ReportWritingDashboardPage() {
  const { todayKey, startIso, endIso, label } = getTodayRangeAest()

  const [providersResult, queueResult, draftsResult] = await Promise.all([
    supabase
      .from("providers")
      .select("id, name, is_active, archived")
      .order("name", { ascending: true }),

    supabase
      .from("report_letter_queue")
      .select(
        "id, provider_id, patient_first_name, patient_last_name, patient_dob, appointment_time, queue_reason, status, report_draft_id, praktika_patient_id, raw_json"
      )
      .gte("appointment_time", startIso)
      .lt("appointment_time", endIso)
      .order("appointment_time", { ascending: true }),

    supabase
      .from("report_drafts")
      .select(
        "id, provider_id, patient_name, patient_dob, report_type, status, created_at, uploaded_to_praktika_at, emailed_to_referrer_at"
      )
      .gte("created_at", startIso)
      .lt("created_at", endIso)
      .order("created_at", { ascending: false }),
  ])

  const providers = ((providersResult.data || []) as Provider[]).filter(
    (provider) => provider.archived !== true && provider.is_active !== false
  )

  const providerMap = new Map(
    providers.map((provider) => [
      provider.id,
      provider.name || "Unnamed provider",
    ])
  )

  const queue = (queueResult.data || []) as QueueItem[]
  const drafts = (draftsResult.data || []) as Draft[]

  const activeQueue = queue.filter((item) => item.status !== "completed")
  const queued = queue.filter((item) => item.status === "queued")
  const started = queue.filter((item) => item.status === "started")
  const completedQueue = queue.filter((item) => item.status === "completed")

  const generatedDrafts = drafts.length
  const awaitingApproval = drafts.filter(
    (draft) => draft.status === "awaiting_provider_approval"
  )
  const readyToSend = drafts.filter(
    (draft) => draft.status === "approved" && !isDraftCompleted(draft)
  )
  const uploaded = drafts.filter((draft) =>
    Boolean(draft.uploaded_to_praktika_at)
  )
  const emailed = drafts.filter((draft) => Boolean(draft.emailed_to_referrer_at))

  const providerRows = providers.map((provider) => {
    const providerQueue = queue.filter((item) => item.provider_id === provider.id)
    const providerDrafts = drafts.filter(
      (draft) => draft.provider_id === provider.id
    )

    return {
      provider,
      queue: providerQueue.length,
      active: providerQueue.filter((item) => item.status !== "completed").length,
      awaiting: providerDrafts.filter(
        (draft) => draft.status === "awaiting_provider_approval"
      ).length,
      ready: providerDrafts.filter(
        (draft) => draft.status === "approved" && !isDraftCompleted(draft)
      ).length,
      completed: providerDrafts.filter(isDraftCompleted).length,
    }
  })

  const unmatchedProviderNames = Array.from(
    new Set(
      queue
        .filter((item) => !item.provider_id)
        .map(getRawProviderName)
        .filter(Boolean)
    )
  )

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-950">
              Report Writing Dashboard
            </h1>
            <p className="mt-1 text-slate-600">
              {label} · AEST · {todayKey}
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              href="/report-writing/typist"
              className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white"
            >
              Typist Portal
            </Link>

            <Link
              href="/report-writing/history"
              className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700"
            >
              History / Archive
            </Link>
          </div>
        </header>

        {unmatchedProviderNames.length > 0 ? (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <div className="font-bold">Provider mapping notice</div>
            <p className="mt-1">
              Some queue items are not linked to an internal provider. Raw
              Praktika provider names are shown below until they are mapped.
            </p>
            <div className="mt-2">
              {unmatchedProviderNames.slice(0, 8).join(", ")}
              {unmatchedProviderNames.length > 8 ? "…" : ""}
            </div>
          </section>
        ) : null}

        {queueResult.error || draftsResult.error ? (
          <section className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <div className="font-bold">Dashboard warning</div>
            {queueResult.error ? (
              <div className="mt-1">
                Queue error: {queueResult.error.message}
              </div>
            ) : null}
            {draftsResult.error ? (
              <div className="mt-1">
                Draft error: {draftsResult.error.message}
              </div>
            ) : null}
          </section>
        ) : null}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <Card
            title="Today’s queue"
            value={queue.length}
            helper={`${activeQueue.length} still active`}
            href="/report-writing/typist"
          />
          <Card
            title="Queued"
            value={queued.length}
            helper="Not yet started"
            accent="text-blue-700"
          />
          <Card
            title="In progress"
            value={started.length}
            helper="Started by typist"
            accent="text-amber-700"
          />
          <Card
            title="Generated"
            value={generatedDrafts}
            helper="Drafts created today"
            href={`/report-writing/history?fromDate=${todayKey}&toDate=${todayKey}`}
          />
          <Card
            title="Awaiting approval"
            value={awaitingApproval.length}
            helper="Provider review needed"
            accent="text-purple-700"
            href={`/report-writing/history?status=awaiting&fromDate=${todayKey}&toDate=${todayKey}`}
          />
          <Card
            title="Completed"
            value={Math.max(completedQueue.length, emailed.length, uploaded.length)}
            helper={`${uploaded.length} uploaded, ${emailed.length} emailed`}
            accent="text-emerald-700"
            href={`/report-writing/history?status=completed&fromDate=${todayKey}&toDate=${todayKey}`}
          />
        </section>

        <section className="grid gap-6 lg:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
            <div className="mb-4">
              <h2 className="text-xl font-bold text-slate-950">
                Today’s active queue
              </h2>
              <p className="text-sm text-slate-500">
                Queue items that are not completed yet. Times shown in AEST.
              </p>
            </div>

            <div className="overflow-hidden rounded-xl border border-slate-200">
              <table className="w-full border-collapse text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="p-3">Time</th>
                    <th className="p-3">Patient</th>
                    <th className="p-3">Provider</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Reason</th>
                  </tr>
                </thead>

                <tbody>
                  {activeQueue.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-6 text-center text-slate-500">
                        No active queue items for today.
                      </td>
                    </tr>
                  ) : null}

                  {activeQueue.map((item) => (
                    <tr key={item.id} className="border-t border-slate-100">
                      <td className="whitespace-nowrap p-3 text-slate-600">
                        {formatTimeAest(item.appointment_time)}
                      </td>

                      <td className="p-3">
                        <div className="font-semibold text-slate-950">
                          {patientNameFromQueue(item) || "Unnamed patient"}
                        </div>
                        <div className="text-xs text-slate-500">
                          DOB: {item.patient_dob || "Not available"}
                        </div>
                      </td>

                      <td className="p-3 text-slate-600">
                        {providerName(item.provider_id, providerMap, item)}
                      </td>

                      <td className="p-3">
                        <span
                          className={[
                            "rounded-full px-3 py-1 text-xs font-semibold",
                            getStatusBadgeClass(item.status),
                          ].join(" ")}
                        >
                          {item.status || "unknown"}
                        </span>
                      </td>

                      <td className="p-3 text-slate-500">
                        {item.queue_reason || "Typist Letter"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-xl font-bold text-slate-950">
              Provider summary
            </h2>
            <p className="text-sm text-slate-500">
              Today’s queue and completion status by provider.
            </p>

            <div className="mt-4 space-y-3">
              {providerRows.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                  No active providers found.
                </div>
              ) : null}

              {providerRows.map((row) => (
                <div
                  key={row.provider.id}
                  className="rounded-xl border border-slate-200 p-3"
                >
                  <div className="font-semibold text-slate-950">
                    {row.provider.name || "Unnamed provider"}
                  </div>

                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-600">
                    <div>Queue: {row.queue}</div>
                    <div>Active: {row.active}</div>
                    <div>Awaiting: {row.awaiting}</div>
                    <div>Ready: {row.ready}</div>
                    <div className="col-span-2 text-emerald-700">
                      Completed: {row.completed}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-xl font-bold text-slate-950">
              Awaiting provider approval
            </h2>

            <div className="mt-4 space-y-3">
              {awaitingApproval.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                  No letters awaiting approval today.
                </div>
              ) : null}

              {awaitingApproval.map((draft) => (
                <div key={draft.id} className="rounded-xl border p-3">
                  <div className="font-semibold">
                    {draft.patient_name || "Unnamed patient"}
                  </div>
                  <div className="text-sm text-slate-500">
                    {providerName(draft.provider_id, providerMap)} ·{" "}
                    {draft.report_type || "report"}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-xl font-bold text-slate-950">
              Ready to send / complete
            </h2>

            <div className="mt-4 space-y-3">
              {readyToSend.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                  No approved letters waiting to be completed today.
                </div>
              ) : null}

              {readyToSend.map((draft) => (
                <div key={draft.id} className="rounded-xl border p-3">
                  <div className="font-semibold">
                    {draft.patient_name || "Unnamed patient"}
                  </div>
                  <div className="text-sm text-slate-500">
                    {providerName(draft.provider_id, providerMap)} ·{" "}
                    {draft.report_type || "report"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
