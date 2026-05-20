import Link from "next/link"
import { createClient } from "@supabase/supabase-js"
import { normalizeProviderName } from "@/lib/providers/normalize-provider-name"

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
}

type ProviderNameMapping = {
  provider_id: string
  normalized_provider_name: string
  source_type: string
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

type ProviderSummaryRow = {
  id: string
  name: string
  queue: number
  active: number
  awaiting: number
  ready: number
  completed: number
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

function cleanDisplayProviderName(name: string) {
  return name
    .replace(/\s*\(medical\)\s*/gi, "")
    .replace(/\s*\(dental\)\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim()
}

function getRawProviderName(item: QueueItem) {
  const raw = item.raw_json || {}

  return (
    clean(raw.vchProviderName) ||
    clean(raw.praktika_provider) ||
    clean(raw.vchProvider) ||
    clean(raw.provider) ||
    clean(raw.Provider) ||
    clean(raw.provider_name) ||
    clean(raw.vchPractitioner) ||
    clean(raw.practitioner) ||
    clean(raw.vchResourceName) ||
    clean(raw.vchProviderFirstName) ||
    ""
  )
}

function getMappedProviderId(
  item: QueueItem,
  providerNameMappings: Map<string, string>
) {
  if (item.provider_id) return item.provider_id

  const rawProvider = getRawProviderName(item)
  if (!rawProvider) return null

  const normalizedProvider = normalizeProviderName(rawProvider)

  return providerNameMappings.get(normalizedProvider) || null
}

function providerName(
  providerId: string | null | undefined,
  providerMap: Map<string, string>,
  item?: QueueItem,
  providerNameMappings?: Map<string, string>
) {
  let resolvedProviderId = providerId

  if (!resolvedProviderId && item && providerNameMappings) {
    resolvedProviderId = getMappedProviderId(item, providerNameMappings)
  }

  if (resolvedProviderId && providerMap.has(resolvedProviderId)) {
    return cleanDisplayProviderName(
      providerMap.get(resolvedProviderId) || "Unknown provider"
    )
  }

  if (item) {
    const rawProvider = getRawProviderName(item)

    if (rawProvider) {
      return cleanDisplayProviderName(rawProvider)
    }
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

  const [providersResult, providerMappingsResult, queueResult, draftsResult] =
    await Promise.all([
      supabase
        .from("providers")
        .select("id, name, is_active")
        .order("name", { ascending: true }),

      supabase
        .from("provider_name_mappings")
        .select("provider_id, normalized_provider_name, source_type")
        .in("source_type", [
          "appointments_csv",
          "provider_performance_csv",
          "cancellations_csv",
          "praktika_completed_procedures",
        ]),

      supabase
        .from("report_letter_queue")
        .select(
          "id, provider_id, patient_first_name, patient_last_name, patient_dob, appointment_time, queue_reason, status, report_draft_id, praktika_patient_id, raw_json"
        )
        .neq("status", "completed")
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

  const providers = (providersResult.data || []) as Provider[]

  const providerMap = new Map(
    providers.map((provider) => [
      provider.id,
      provider.name || "Unnamed provider",
    ])
  )

  const providerNameMappings = new Map(
    ((providerMappingsResult.data || []) as ProviderNameMapping[]).map(
      (mapping) => [mapping.normalized_provider_name, mapping.provider_id]
    )
  )

  const queue = (queueResult.data || []) as QueueItem[]
  const drafts = (draftsResult.data || []) as Draft[]

  const activeQueue = queue.filter((item) => item.status !== "completed")
  const queued = activeQueue.filter((item) => item.status === "queued")
  const started = activeQueue.filter((item) => item.status === "started")

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

const providerRows = Array.from(
  activeQueue.reduce((map, item) => {
    const mappedProviderId = getMappedProviderId(item, providerNameMappings)

    const displayName = providerName(
      item.provider_id,
      providerMap,
      item,
      providerNameMappings
    )

    const key = mappedProviderId || displayName

    const providerDrafts = drafts.filter(
      (draft) => draft.provider_id === mappedProviderId
    )

    const existing =
      map.get(key) ||
      ({
        id: key,
        name: displayName,
        queue: 0,
        drafts: providerDrafts.length,
        awaitingApproval: providerDrafts.filter(
          (draft) => draft.status === "awaiting_provider_approval"
        ).length,
        approved: providerDrafts.filter(
          (draft) => draft.status === "approved" && !isDraftCompleted(draft)
        ).length,
      })

    existing.queue += 1

    map.set(key, existing)

    return map
  }, new Map<string, {
    id: string
    name: string
    queue: number
    drafts: number
    awaitingApproval: number
    approved: number
  }>())
)
  .map(([, row]) => row)
  .sort((a, b) => a.name.localeCompare(b.name))

  const unmatchedProviderNames = Array.from(
    new Set(
      activeQueue
        .filter((item) => !getMappedProviderId(item, providerNameMappings))
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

        {queueResult.error ||
        draftsResult.error ||
        providerMappingsResult.error ||
        providersResult.error ? (
          <section className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <div className="font-bold">Dashboard warning</div>

            {providersResult.error ? (
              <div className="mt-1">
                Provider error: {providersResult.error.message}
              </div>
            ) : null}

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

            {providerMappingsResult.error ? (
              <div className="mt-1">
                Provider mapping error: {providerMappingsResult.error.message}
              </div>
            ) : null}
          </section>
        ) : null}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <Card
            title="Active queue"
            value={activeQueue.length}
            helper="All unfinished queue items"
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
            title="Generated today"
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
            title="Completed today"
            value={Math.max(emailed.length, uploaded.length)}
            helper={`${uploaded.length} uploaded, ${emailed.length} emailed`}
            accent="text-emerald-700"
            href={`/report-writing/history?status=completed&fromDate=${todayKey}&toDate=${todayKey}`}
          />
        </section>

        <section className="grid gap-6 lg:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
            <div className="mb-4">
              <h2 className="text-xl font-bold text-slate-950">
                Active queue
              </h2>
              <p className="text-sm text-slate-500">
                All queue items that are not completed yet. Times shown in AEST.
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
                        No active queue items.
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
                        {providerName(
                          item.provider_id,
                          providerMap,
                          item,
                          providerNameMappings
                        )}
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
            <p className="text-sm text-slate-500">Active queue by provider.</p>

            <div className="mt-4 space-y-3">
              {providerRows.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                  No active providers found.
                </div>
              ) : null}

              {providerRows.map((row) => (
                <div
                  key={row.id}
                  className="rounded-xl border border-slate-200 p-3"
                >
                  <div className="font-semibold text-slate-950">
                    {row.name || "Unnamed provider"}
                  </div>

                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-600">
  <div>Queue: {row.queue}</div>
  <div>Drafts: {row.drafts}</div>
  <div>Awaiting Approval: {row.awaitingApproval}</div>
  <div>Approved: {row.approved}</div>
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