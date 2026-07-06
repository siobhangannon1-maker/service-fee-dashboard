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

type PageProps = {
  searchParams?: Promise<{
    view?: string
  }>
}

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

type DisplayRow = {
  id: string
  patientName: string
  providerName: string
  status: string | null
  statusLabel: string
  dateLabel: string
  href?: string
}

function getAestDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: AEST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)
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
    month: "long",
    year: "numeric",
  }).format(new Date(`${todayKey}T12:00:00+10:00`))

  return {
    todayKey,
    startIso,
    endIso: `${endKey}T00:00:00+10:00`,
    label,
  }
}

function ordinalDay(day: number) {
  if (day > 3 && day < 21) return `${day}th`
  if (day % 10 === 1) return `${day}st`
  if (day % 10 === 2) return `${day}nd`
  if (day % 10 === 3) return `${day}rd`
  return `${day}th`
}

function formatGeneratedTimeAest(value: string | null | undefined) {
  if (!value) return "No generated time"

  try {
    const date = new Date(value)

    const weekday = new Intl.DateTimeFormat("en-AU", {
      timeZone: AEST_TIME_ZONE,
      weekday: "long",
    }).format(date)

    const day = Number(
      new Intl.DateTimeFormat("en-AU", {
        timeZone: AEST_TIME_ZONE,
        day: "numeric",
      }).format(date)
    )

    const month = new Intl.DateTimeFormat("en-AU", {
      timeZone: AEST_TIME_ZONE,
      month: "long",
    }).format(date)

    const time = new Intl.DateTimeFormat("en-AU", {
      timeZone: AEST_TIME_ZONE,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(date)

    return `${weekday} ${ordinalDay(day)} ${month} ${time}`
  } catch {
    return "No generated time"
  }
}

function formatAppointmentTimeAsClinicLocal(value: string | null | undefined) {
  if (!value) return null

  const match = String(value).match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/
  )

  if (!match) return formatGeneratedTimeAest(value)

  const [, year, month, day, hour, minute] = match

  const clinicLocalDate = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute)
  )

  const weekday = new Intl.DateTimeFormat("en-AU", {
    weekday: "long",
  }).format(clinicLocalDate)

  const monthName = new Intl.DateTimeFormat("en-AU", {
    month: "long",
  }).format(clinicLocalDate)

  const time = new Intl.DateTimeFormat("en-AU", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(clinicLocalDate)

  return `${weekday} ${ordinalDay(Number(day))} ${monthName} ${time}`
}

function formatQueueDateLabel(
  appointmentTime: string | null | undefined,
  generatedTime: string | null | undefined
) {
  const appointmentLabel = formatAppointmentTimeAsClinicLocal(appointmentTime)

  if (appointmentLabel) {
    return `Appointment: ${appointmentLabel}`
  }

  return `Generated: ${formatGeneratedTimeAest(generatedTime)}`
}

function patientNameFromQueue(item: QueueItem) {
  return [item.patient_first_name, item.patient_last_name]
    .filter(Boolean)
    .join(" ")
    .trim()
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

  return providerNameMappings.get(normalizeProviderName(rawProvider)) || null
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
    if (rawProvider) return cleanDisplayProviderName(rawProvider)
  }

  return "Unmatched provider"
}

function isDraftCompleted(draft: Draft) {
  return Boolean(draft.uploaded_to_praktika_at || draft.emailed_to_referrer_at)
}

function getStatusLabel(status: string | null | undefined) {
  switch (status) {
    case "queued":
      return "Queued"

    case "started":
      return "In progress"

    case "draft":
      return "Draft"

    case "edited_by_typist":
      return "Edited by typist"

    case "awaiting_provider_approval":
      return "Awaiting provider approval"

    case "approved":
      return "Approved"

    case "uploaded_to_praktika":
      return "Uploaded to Praktika"

    case "completed":
      return "Completed"

    default:
      if (!status) return "Unknown"

      return status
        .replace(/_/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase())
  }
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

function getReportLabel(reportType: string | null | undefined) {
  return reportType?.replace(/_/g, " ") || "report"
}

function Card({
  title,
  value,
  helper,
  accent,
  href,
  active,
}: {
  title: string
  value: number
  helper: string
  accent?: string
  href: string
  active?: boolean
}) {
  return (
    <Link href={href} className="block">
      <div
        className={[
          "rounded-2xl border bg-white p-5 shadow-sm transition hover:border-blue-300 hover:shadow-md",
          active ? "border-blue-400 ring-2 ring-blue-100" : "border-slate-200",
        ].join(" ")}
      >
        <div className="text-sm font-semibold text-slate-500">{title}</div>
        <div
          className={[
            "mt-2 text-4xl font-bold",
            accent || "text-slate-950",
          ].join(" ")}
        >
          {value}
        </div>
        <div className="mt-2 text-sm text-slate-500">{helper}</div>
        <div className="mt-3 text-xs font-semibold text-blue-700">
          Show list →
        </div>
      </div>
    </Link>
  )
}

function queueToRows({
  items,
  draftById,
  providerMap,
  providerNameMappings,
}: {
  items: QueueItem[]
  draftById: Map<string, Draft>
  providerMap: Map<string, string>
  providerNameMappings: Map<string, string>
}): DisplayRow[] {
  return items.map((item) => {
    const linkedDraft = item.report_draft_id
      ? draftById.get(item.report_draft_id)
      : null

    return {
      id: item.id,
      patientName: patientNameFromQueue(item) || "Unnamed patient",
      providerName: providerName(
        item.provider_id,
        providerMap,
        item,
        providerNameMappings
      ),
      status: item.status,
      statusLabel: getStatusLabel(item.status),
      dateLabel: formatQueueDateLabel(
        item.appointment_time,
        linkedDraft?.created_at || null
      ),
      href: linkedDraft?.id
        ? `/report-writing/typist?draftId=${linkedDraft.id}`
        : undefined,
    }
  })
}

function draftsToRows({
  drafts,
  providerMap,
}: {
  drafts: Draft[]
  providerMap: Map<string, string>
}): DisplayRow[] {
  return drafts.map((draft) => ({
    id: draft.id,
    patientName: draft.patient_name || "Unnamed patient",
    providerName: `${providerName(draft.provider_id, providerMap)} · ${getReportLabel(
      draft.report_type
    )}`,
    status: draft.status,
    statusLabel: getStatusLabel(draft.status),
    dateLabel: `Generated: ${formatGeneratedTimeAest(draft.created_at)}`,
    href: `/report-writing/typist?draftId=${draft.id}`,
  }))
}

function RowCard({ row }: { row: DisplayRow }) {
  const content = (
    <div className="grid gap-3 p-3 md:grid-cols-[1fr_220px_140px]">
      <div>
        <div className="font-semibold text-slate-950">{row.patientName}</div>
        <div className="mt-1 text-xs text-slate-500">{row.dateLabel}</div>
      </div>

      <div className="text-sm text-slate-600">{row.providerName}</div>

      <div>
        <span
          className={[
            "rounded-full px-3 py-1 text-xs font-semibold",
            getStatusBadgeClass(row.status),
          ].join(" ")}
        >
          {row.statusLabel}
        </span>
      </div>
    </div>
  )

  if (!row.href) {
    return <div className="border-t border-slate-100">{content}</div>
  }

  return (
    <Link
      href={row.href}
      className="block border-t border-slate-100 hover:bg-slate-50"
    >
      {content}
    </Link>
  )
}

export default async function ReportWritingDashboardPage({
  searchParams,
}: PageProps) {
  const resolvedSearchParams = await searchParams
  const selectedView = resolvedSearchParams?.view || "active"
  const { todayKey, startIso, endIso, label } = getTodayRangeAest()

  const [providersResult, providerMappingsResult, queueResult, draftsResult] =
    await Promise.all([
      supabase
        .from("providers")
        .select("id, name, is_active")
        .eq("is_active", true)
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
  const queue = (queueResult.data || []) as QueueItem[]
  const drafts = (draftsResult.data || []) as Draft[]

  const activeProviderIds = new Set(providers.map((provider) => provider.id))

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

  const activeQueue = queue.filter((item) => item.status !== "completed")
  const queued = activeQueue.filter((item) => item.status === "queued")
  const started = activeQueue.filter((item) => item.status === "started")

  const generatedDrafts = drafts
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
  const completedToday = drafts.filter((draft) => isDraftCompleted(draft))

  const draftById = new Map(drafts.map((draft) => [draft.id, draft]))

  const selectedRows =
    selectedView === "queued"
      ? queueToRows({
          items: queued,
          draftById,
          providerMap,
          providerNameMappings,
        })
      : selectedView === "in-progress"
        ? queueToRows({
            items: started,
            draftById,
            providerMap,
            providerNameMappings,
          })
        : selectedView === "generated"
          ? draftsToRows({ drafts: generatedDrafts, providerMap })
          : selectedView === "awaiting"
            ? draftsToRows({ drafts: awaitingApproval, providerMap })
            : selectedView === "approved"
              ? draftsToRows({ drafts: readyToSend, providerMap })
              : selectedView === "completed"
                ? draftsToRows({ drafts: completedToday, providerMap })
                : queueToRows({
                    items: activeQueue,
                    draftById,
                    providerMap,
                    providerNameMappings,
                  })

  const selectedTitle =
    selectedView === "queued"
      ? "Queued items"
      : selectedView === "in-progress"
        ? "In progress items"
        : selectedView === "generated"
          ? "Generated today"
          : selectedView === "awaiting"
            ? "Awaiting approval"
            : selectedView === "approved"
              ? "Approved / ready"
              : selectedView === "completed"
                ? "Completed today"
                : "Active queue"

  const providerRows = providers
    .map((provider) => {
      const providerQueue = activeQueue.filter((item) => {
        const mappedProviderId = getMappedProviderId(item, providerNameMappings)
        return mappedProviderId === provider.id
      })

      const providerDrafts = drafts.filter(
        (draft) => draft.provider_id === provider.id
      )

      return {
        id: provider.id,
        name: cleanDisplayProviderName(provider.name || "Unnamed provider"),
        queue: providerQueue.length,
        drafts: providerDrafts.length,
        awaitingApproval: providerDrafts.filter(
          (draft) => draft.status === "awaiting_provider_approval"
        ).length,
        approved: providerDrafts.filter(
          (draft) => draft.status === "approved" && !isDraftCompleted(draft)
        ).length,
        completed: providerDrafts.filter((draft) => isDraftCompleted(draft))
          .length,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  const unmatchedProviderNames = Array.from(
    new Set(
      activeQueue
        .filter((item) => {
          const mappedProviderId = getMappedProviderId(
            item,
            providerNameMappings
          )

          return mappedProviderId && !activeProviderIds.has(mappedProviderId)
        })
        .map((item) =>
          providerName(item.provider_id, providerMap, item, providerNameMappings)
        )
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
            <p className="mt-1 text-slate-600">{label} · AEST</p>
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
              Some queue items are linked to providers that are not currently
              active.
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

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-7">
          <Card
  title="Active queue"
  value={activeQueue.length}
  helper="All unfinished queue items"
  href="/report-writing/dashboard?view=active"
  active={selectedView === "active"}
/>

<Card
  title="Queued"
  value={queued.length}
  helper="Not yet started"
  accent="text-blue-700"
  href="/report-writing/dashboard?view=queued"
  active={selectedView === "queued"}
/>

<Card
  title="In progress"
  value={started.length}
  helper="Started by typist"
  accent="text-amber-700"
  href="/report-writing/dashboard?view=in-progress"
  active={selectedView === "in-progress"}
/>

<Card
  title="Generated"
  value={generatedDrafts.length}
  helper="Drafts created today"
  href="/report-writing/dashboard?view=generated"
  active={selectedView === "generated"}
/>

<Card
  title="Awaiting approval"
  value={awaitingApproval.length}
  helper="Provider review needed"
  accent="text-purple-700"
  href="/report-writing/dashboard?view=awaiting"
  active={selectedView === "awaiting"}
/>

<Card
  title="Approved"
  value={readyToSend.length}
  helper="Ready to complete"
  accent="text-green-700"
  href="/report-writing/dashboard?view=approved"
  active={selectedView === "approved"}
/>

<Card
  title="Completed"
  value={completedToday.length}
  helper={`${uploaded.length} uploaded, ${emailed.length} emailed`}
  accent="text-emerald-700"
  href="/report-writing/dashboard?view=completed"
  active={selectedView === "completed"}
/>
        </section>

        <section className="grid gap-6 lg:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
            <div className="mb-4">
              <h2 className="text-xl font-bold text-slate-950">
                {selectedTitle}
              </h2>
            </div>

            <div className="max-h-[560px] overflow-auto rounded-xl border border-slate-200">
              <div className="sticky top-0 z-10 grid gap-3 bg-slate-50 p-3 text-xs font-semibold uppercase text-slate-500 md:grid-cols-[1fr_220px_140px]">
                <div>Patient</div>
                <div>Provider</div>
                <div>Status</div>
              </div>

              {selectedRows.length === 0 ? (
                <div className="p-6 text-center text-sm text-slate-500">
                  No items in this list.
                </div>
              ) : null}

              {selectedRows.map((row) => (
                <RowCard key={row.id} row={row} />
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-xl font-bold text-slate-950">
              Provider summary
            </h2>
            <p className="text-sm text-slate-500">
              Active providers only.
            </p>

            <div className="mt-4 max-h-[560px] space-y-3 overflow-auto pr-1">
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
                    <div>Awaiting: {row.awaitingApproval}</div>
                    <div>Approved: {row.approved}</div>
                    <div>Completed: {row.completed}</div>
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