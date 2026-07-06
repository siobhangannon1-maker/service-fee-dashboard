import Link from "next/link"
import { cookies } from "next/headers"
import { createServerClient } from "@supabase/ssr"
import { createClient } from "@supabase/supabase-js"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const AEST_TIME_ZONE = "Australia/Brisbane"
const ALLOWED_ROLES = new Set(["super_admin", "admin", "practice_manager"])

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type Provider = {
  id: string
  name: string | null
}

type Profile = {
  id: string
  email: string | null
  role: string | null
  full_name: string | null
}

type Draft = {
  id: string
  provider_id: string | null
  created_by: string | null
  patient_name: string | null
  report_type: string | null
  status: string | null
  created_at: string | null
  sent_for_provider_review_at: string | null
  provider_approved_at: string | null
  uploaded_to_praktika_at: string | null
  emailed_to_referrer_at: string | null
  completed_at: string | null
  drafted_by_name: string | null
  drafted_by_initials: string | null
  approved_by_name: string | null
  approved_by_initials: string | null
}

type QueueItem = {
  id: string
  report_draft_id: string | null
  appointment_time: string | null
}

type SearchParams = Promise<{
  fromDate?: string
  toDate?: string
}>

function formatDate(value: string | null | undefined) {
  if (!value) return "—"

  return new Date(value).toLocaleString("en-AU", {
    timeZone: AEST_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function formatMinutes(minutes: number | null | undefined) {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) {
    return "—"
  }

  const rounded = Math.round(minutes)
  const days = Math.floor(rounded / 1440)
  const hours = Math.floor((rounded % 1440) / 60)
  const mins = rounded % 60

  if (days > 0) {
    return `${days}d ${hours}h ${mins}m`
  }

  if (hours > 0) {
    return `${hours}h ${mins}m`
  }

  return `${mins} min`
}

function average(values: number[]) {
  const valid = values.filter((value) => Number.isFinite(value) && value >= 0)
  if (valid.length === 0) return null

  return valid.reduce((sum, value) => sum + value, 0) / valid.length
}

function median(values: number[]) {
  const valid = values
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b)

  if (valid.length === 0) return null

  const middle = Math.floor(valid.length / 2)

  if (valid.length % 2 === 0) {
    return (valid[middle - 1] + valid[middle]) / 2
  }

  return valid[middle]
}

function MeanMedianCell({ values }: { values: number[] }) {
  const meanValue = average(values)
  const medianValue = median(values)

  if (meanValue === null && medianValue === null) return <>—</>

  return (
    <div className="space-y-0.5">
      <div>Mean: {formatMinutes(meanValue)}</div>
      <div className="text-xs text-slate-500">
        Median: {formatMinutes(medianValue)}
      </div>
    </div>
  )
}

function getDateOnly(date = new Date()) {
  return date.toISOString().slice(0, 10)
}

function getDefaultFromDate() {
  const date = new Date()
  date.setDate(date.getDate() - 7)
  return getDateOnly(date)
}

function normaliseText(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
}

function displayNameFromEmail(email: string | null | undefined) {
  if (!email) return ""

  return email
    .split("@")[0]
    .replace(/[0-9]/g, "")
    .split(/[._-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ")
}

function getProviderName(
  providerId: string | null | undefined,
  providerMap: Map<string, string>
) {
  if (!providerId) return "Unknown provider"
  return providerMap.get(providerId) || "Unknown provider"
}

function getReportTypeLabel(value: string | null | undefined) {
  if (!value) return "Unknown type"

  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function parseNormalTimeToMs(value?: string | null) {
  if (!value) return null

  const ms = new Date(value).getTime()
  if (!Number.isFinite(ms)) return null

  return ms
}

function parseClinicLocalAppointmentToMs(value?: string | null) {
  if (!value) return null

  const match = String(value).match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/
  )

  if (!match) return parseNormalTimeToMs(value)

  const [, year, month, day, hour, minute] = match
  const clinicLocalIso = `${year}-${month}-${day}T${hour}:${minute}:00+10:00`
  const ms = new Date(clinicLocalIso).getTime()

  if (!Number.isFinite(ms)) return null

  return ms
}

function minutesBetweenMs(startMs: number | null, endMs: number | null) {
  if (startMs === null || endMs === null) return null
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null
  if (endMs < startMs) return null

  return (endMs - startMs) / 1000 / 60
}

function minutesBetween(start?: string | null, end?: string | null) {
  return minutesBetweenMs(parseNormalTimeToMs(start), parseNormalTimeToMs(end))
}

function getDraftCompletedAt(draft: Draft) {
  return (
    draft.completed_at ||
    draft.emailed_to_referrer_at ||
    draft.uploaded_to_praktika_at ||
    null
  )
}

function getDraftStartMs(draft: Draft, queueByDraftId: Map<string, QueueItem>) {
  const queueItem = queueByDraftId.get(draft.id)
  const appointmentMs = parseClinicLocalAppointmentToMs(
    queueItem?.appointment_time
  )

  if (appointmentMs !== null) return appointmentMs

  return parseNormalTimeToMs(draft.created_at)
}

function isCompletedDraft(draft: Draft) {
  return Boolean(getDraftCompletedAt(draft))
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
            practice_manager users.
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

  const [providersResult, profilesResult, draftsResult, queueResult] =
    await Promise.all([
      serviceSupabase.from("providers").select("id, name"),

      serviceSupabase
        .from("profiles")
        .select("id, email, role, full_name")
        .eq("role", "typist")
        .order("full_name", { ascending: true }),

      serviceSupabase
        .from("report_drafts")
        .select(
          "id, provider_id, created_by, patient_name, report_type, status, created_at, sent_for_provider_review_at, provider_approved_at, uploaded_to_praktika_at, emailed_to_referrer_at, completed_at, drafted_by_name, drafted_by_initials, approved_by_name, approved_by_initials"
        )
        .gte("created_at", startIso)
        .lt("created_at", endIso)
        .order("created_at", { ascending: true }),

      serviceSupabase
        .from("report_letter_queue")
        .select("id, report_draft_id, appointment_time")
        .not("report_draft_id", "is", null),
    ])

  const providers = (providersResult.data || []) as Provider[]
  const typistProfiles = (profilesResult.data || []) as Profile[]
  const drafts = (draftsResult.data || []) as Draft[]
  const queueItems = (queueResult.data || []) as QueueItem[]

  const providerMap = new Map(
    providers.map((provider) => [
      provider.id,
      provider.name || "Unnamed provider",
    ])
  )

  const queueByDraftId = new Map(
    queueItems
      .filter((item) => item.report_draft_id)
      .map((item) => [item.report_draft_id as string, item])
  )

  const typistKeyById = new Map<string, string>()
  const typistKeyByName = new Map<string, string>()

  const typistRowsMap = new Map<
    string,
    {
      key: string
      name: string
      email: string
      drafted: number
      sentForReview: number
      approvedDirectly: number
      approvedTotal: number
      completed: number
      writeToReviewValues: number[]
      writeToApprovalValues: number[]
      reviewToApprovalValues: number[]
      startToCompleteValues: number[]
      firstActivity: string | null
      lastActivity: string | null
    }
  >()

  for (const profile of typistProfiles) {
    const name =
      profile.full_name ||
      displayNameFromEmail(profile.email) ||
      profile.email ||
      "Unnamed typist"

    const key = normaliseText(name)

    if (!typistRowsMap.has(key)) {
      typistRowsMap.set(key, {
        key,
        name,
        email: profile.email || "",
        drafted: 0,
        sentForReview: 0,
        approvedDirectly: 0,
        approvedTotal: 0,
        completed: 0,
        writeToReviewValues: [],
        writeToApprovalValues: [],
        reviewToApprovalValues: [],
        startToCompleteValues: [],
        firstActivity: null,
        lastActivity: null,
      })
    }

    typistKeyById.set(profile.id, key)

    if (profile.full_name) {
      typistKeyByName.set(normaliseText(profile.full_name), key)
    }
  }

  function getTypistKeyForDraft(draft: Draft) {
    if (draft.created_by && typistKeyById.has(draft.created_by)) {
      return typistKeyById.get(draft.created_by) || null
    }

    const draftedByKey = typistKeyByName.get(normaliseText(draft.drafted_by_name))
    if (draftedByKey) return draftedByKey

    return null
  }

  const draftToCompletedMinutes: number[] = []
  const writeToReviewMinutes: number[] = []
  const writeToApprovalMinutes: number[] = []
  const reviewToApprovalMinutes: number[] = []

  const letterTypeRowsMap = new Map<
    string,
    {
      typist: string
      letterType: string
      drafted: number
      sentForReview: number
      approved: number
      completed: number
      writeToReviewValues: number[]
      writeToApprovalValues: number[]
      reviewToApprovalValues: number[]
      startToCompleteValues: number[]
    }
  >()

  for (const draft of drafts) {
    const typistKey = getTypistKeyForDraft(draft)
    if (!typistKey) continue

    const typistRow = typistRowsMap.get(typistKey)
    if (!typistRow) continue

    const createdAt = draft.created_at
    const sentForReviewAt = draft.sent_for_provider_review_at
    const approvedAt = draft.provider_approved_at
    const completedAt = getDraftCompletedAt(draft)

    typistRow.drafted += 1

    if (sentForReviewAt) typistRow.sentForReview += 1
    if (approvedAt) typistRow.approvedTotal += 1
    if (approvedAt && !sentForReviewAt) typistRow.approvedDirectly += 1
    if (completedAt) typistRow.completed += 1

    const writeToReview = minutesBetween(createdAt, sentForReviewAt)
    const writeToApproval = minutesBetween(createdAt, approvedAt)
    const reviewToApproval = minutesBetween(sentForReviewAt, approvedAt)

    const startMs = getDraftStartMs(draft, queueByDraftId)
    const completedMs = parseNormalTimeToMs(completedAt)
    const startToComplete = minutesBetweenMs(startMs, completedMs)

    if (writeToReview !== null) {
      writeToReviewMinutes.push(writeToReview)
      typistRow.writeToReviewValues.push(writeToReview)
    }

    if (writeToApproval !== null) {
      writeToApprovalMinutes.push(writeToApproval)
      typistRow.writeToApprovalValues.push(writeToApproval)
    }

    if (reviewToApproval !== null) {
      reviewToApprovalMinutes.push(reviewToApproval)
      typistRow.reviewToApprovalValues.push(reviewToApproval)
    }

    if (startToComplete !== null) {
      draftToCompletedMinutes.push(startToComplete)
      typistRow.startToCompleteValues.push(startToComplete)
    }

    const activityDates = [
      createdAt,
      sentForReviewAt,
      approvedAt,
      completedAt,
    ].filter(Boolean) as string[]

    for (const activityDate of activityDates) {
      if (
        !typistRow.firstActivity ||
        new Date(activityDate) < new Date(typistRow.firstActivity)
      ) {
        typistRow.firstActivity = activityDate
      }

      if (
        !typistRow.lastActivity ||
        new Date(activityDate) > new Date(typistRow.lastActivity)
      ) {
        typistRow.lastActivity = activityDate
      }
    }

    const letterType = getReportTypeLabel(draft.report_type)
    const typeKey = `${typistKey}::${letterType}`

    const typeRow =
      letterTypeRowsMap.get(typeKey) ||
      ({
        typist: typistRow.name,
        letterType,
        drafted: 0,
        sentForReview: 0,
        approved: 0,
        completed: 0,
        writeToReviewValues: [],
        writeToApprovalValues: [],
        reviewToApprovalValues: [],
        startToCompleteValues: [],
      } as {
        typist: string
        letterType: string
        drafted: number
        sentForReview: number
        approved: number
        completed: number
        writeToReviewValues: number[]
        writeToApprovalValues: number[]
        reviewToApprovalValues: number[]
        startToCompleteValues: number[]
      })

    typeRow.drafted += 1
    if (sentForReviewAt) typeRow.sentForReview += 1
    if (approvedAt) typeRow.approved += 1
    if (completedAt) typeRow.completed += 1
    if (writeToReview !== null) typeRow.writeToReviewValues.push(writeToReview)
    if (writeToApproval !== null) typeRow.writeToApprovalValues.push(writeToApproval)
    if (reviewToApproval !== null) typeRow.reviewToApprovalValues.push(reviewToApproval)
    if (startToComplete !== null) typeRow.startToCompleteValues.push(startToComplete)

    letterTypeRowsMap.set(typeKey, typeRow)
  }

  const typistRows = Array.from(typistRowsMap.values()).sort(
    (a, b) =>
      b.completed - a.completed ||
      b.drafted - a.drafted ||
      a.name.localeCompare(b.name)
  )

  const letterTypeRows = Array.from(letterTypeRowsMap.values()).sort(
    (a, b) =>
      a.typist.localeCompare(b.typist) ||
      b.completed - a.completed ||
      a.letterType.localeCompare(b.letterType)
  )

  const providerRows = Array.from(
    drafts.reduce((map, draft) => {
      const key = draft.provider_id || "unknown"
      const existing =
        map.get(key) ||
        ({
          provider: getProviderName(draft.provider_id, providerMap),
          drafted: 0,
          sentForReview: 0,
          approved: 0,
          completed: 0,
          reviewToApprovalValues: [],
        } as {
          provider: string
          drafted: number
          sentForReview: number
          approved: number
          completed: number
          reviewToApprovalValues: number[]
        })

      existing.drafted += 1
      if (draft.sent_for_provider_review_at) existing.sentForReview += 1
      if (draft.provider_approved_at) existing.approved += 1
      if (isCompletedDraft(draft)) existing.completed += 1

      const reviewToApproval = minutesBetween(
        draft.sent_for_provider_review_at,
        draft.provider_approved_at
      )

      if (reviewToApproval !== null) {
        existing.reviewToApprovalValues.push(reviewToApproval)
      }

      map.set(key, existing)
      return map
    }, new Map<string, {
      provider: string
      drafted: number
      sentForReview: number
      approved: number
      completed: number
      reviewToApprovalValues: number[]
    }>())
  )
    .map(([, row]) => row)
    .sort(
      (a, b) => b.completed - a.completed || a.provider.localeCompare(b.provider)
    )

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-950">
              Typist Productivity
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Typist productivity, provider review timing, and letter type
              workflow performance.
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

        {providersResult.error ||
        profilesResult.error ||
        draftsResult.error ||
        queueResult.error ? (
          <section className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <div className="font-bold">Productivity warning</div>
            {providersResult.error ? (
              <div className="mt-1">Provider error: {providersResult.error.message}</div>
            ) : null}
            {profilesResult.error ? (
              <div className="mt-1">Profile error: {profilesResult.error.message}</div>
            ) : null}
            {draftsResult.error ? (
              <div className="mt-1">Draft error: {draftsResult.error.message}</div>
            ) : null}
            {queueResult.error ? (
              <div className="mt-1">Queue error: {queueResult.error.message}</div>
            ) : null}
          </section>
        ) : null}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <KpiCard title="Drafted" value={drafts.length} helper="Letters created in this period" />
          <KpiCard
            title="Sent for review"
            value={drafts.filter((draft) => draft.sent_for_provider_review_at).length}
            helper="Sent to provider for approval"
          />
          <KpiCard
            title="Approved"
            value={drafts.filter((draft) => draft.provider_approved_at).length}
            helper="Approved by typist or provider"
          />
          <KpiCard
            title="Approved directly"
            value={drafts.filter((draft) => draft.provider_approved_at && !draft.sent_for_provider_review_at).length}
            helper="Approved without provider review"
          />
          <KpiCard
            title="Completed"
            value={drafts.filter((draft) => isCompletedDraft(draft)).length}
            helper="Workflow completed, uploaded, or emailed"
          />
        </section>

        <section className="grid gap-4 md:grid-cols-4">
          <KpiCard
            title="Write → review"
            value={formatMinutes(average(writeToReviewMinutes))}
            helper={`Median ${formatMinutes(median(writeToReviewMinutes))}`}
          />
          <KpiCard
            title="Write → approved"
            value={formatMinutes(average(writeToApprovalMinutes))}
            helper={`Median ${formatMinutes(median(writeToApprovalMinutes))}`}
          />
          <KpiCard
            title="Review → approved"
            value={formatMinutes(average(reviewToApprovalMinutes))}
            helper={`Median ${formatMinutes(median(reviewToApprovalMinutes))}`}
          />
          <KpiCard
            title="Appointment/generated → complete"
            value={formatMinutes(average(draftToCompletedMinutes))}
            helper={`Median ${formatMinutes(median(draftToCompletedMinutes))}`}
          />
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-5">
            <h2 className="text-xl font-bold text-slate-950">
              Typist summary
            </h2>
            <p className="text-sm text-slate-500">
              Only users whose profile role is typist are shown.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="p-3">Typist</th>
                  <th className="p-3">Drafted</th>
                  <th className="p-3">Sent for review</th>
                  <th className="p-3">Approved directly</th>
                  <th className="p-3">Approved total</th>
                  <th className="p-3">Completed</th>
                  <th className="p-3">Write → review</th>
                  <th className="p-3">Write → approved</th>
                  <th className="p-3">Review → approved</th>
                  <th className="p-3">Appointment/generated → complete</th>
                  <th className="p-3">First activity</th>
                  <th className="p-3">Last activity</th>
                </tr>
              </thead>

              <tbody>
                {typistRows.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="p-6 text-center text-slate-500">
                      No typist profiles found.
                    </td>
                  </tr>
                ) : null}

                {typistRows.map((row) => (
                  <tr key={row.key} className="border-t align-top">
                    <td className="p-3">
                      <div className="font-semibold text-slate-950">{row.name}</div>
                      {row.email ? <div className="text-xs text-slate-500">{row.email}</div> : null}
                    </td>
                    <td className="p-3">{row.drafted}</td>
                    <td className="p-3">{row.sentForReview}</td>
                    <td className="p-3">{row.approvedDirectly}</td>
                    <td className="p-3">{row.approvedTotal}</td>
                    <td className="p-3 font-semibold text-emerald-700">{row.completed}</td>
                    <td className="p-3"><MeanMedianCell values={row.writeToReviewValues} /></td>
                    <td className="p-3"><MeanMedianCell values={row.writeToApprovalValues} /></td>
                    <td className="p-3"><MeanMedianCell values={row.reviewToApprovalValues} /></td>
                    <td className="p-3"><MeanMedianCell values={row.startToCompleteValues} /></td>
                    <td className="p-3 text-slate-500">{formatDate(row.firstActivity)}</td>
                    <td className="p-3 text-slate-500">{formatDate(row.lastActivity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-5">
            <h2 className="text-xl font-bold text-slate-950">
              Letter type performance by typist
            </h2>
            <p className="text-sm text-slate-500">
              Mean and median workflow timing by report type and typist.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="p-3">Typist</th>
                  <th className="p-3">Letter type</th>
                  <th className="p-3">Drafted</th>
                  <th className="p-3">Sent for review</th>
                  <th className="p-3">Approved</th>
                  <th className="p-3">Completed</th>
                  <th className="p-3">Write → review</th>
                  <th className="p-3">Write → approved</th>
                  <th className="p-3">Review → approved</th>
                  <th className="p-3">Appointment/generated → complete</th>
                </tr>
              </thead>

              <tbody>
                {letterTypeRows.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="p-6 text-center text-slate-500">
                      No letter type productivity found for this date range.
                    </td>
                  </tr>
                ) : null}

                {letterTypeRows.map((row) => (
                  <tr key={`${row.typist}-${row.letterType}`} className="border-t align-top">
                    <td className="p-3 font-semibold text-slate-950">{row.typist}</td>
                    <td className="p-3">{row.letterType}</td>
                    <td className="p-3">{row.drafted}</td>
                    <td className="p-3">{row.sentForReview}</td>
                    <td className="p-3">{row.approved}</td>
                    <td className="p-3 font-semibold text-emerald-700">{row.completed}</td>
                    <td className="p-3"><MeanMedianCell values={row.writeToReviewValues} /></td>
                    <td className="p-3"><MeanMedianCell values={row.writeToApprovalValues} /></td>
                    <td className="p-3"><MeanMedianCell values={row.reviewToApprovalValues} /></td>
                    <td className="p-3"><MeanMedianCell values={row.startToCompleteValues} /></td>
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
                  <th className="p-3">Drafted</th>
                  <th className="p-3">Sent for review</th>
                  <th className="p-3">Approved</th>
                  <th className="p-3">Completed</th>
                  <th className="p-3">Review → approved</th>
                </tr>
              </thead>

              <tbody>
                {providerRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-slate-500">
                      No provider activity found for this date range.
                    </td>
                  </tr>
                ) : null}

                {providerRows.map((row) => (
                  <tr key={row.provider} className="border-t align-top">
                    <td className="p-3 font-semibold text-slate-950">{row.provider}</td>
                    <td className="p-3">{row.drafted}</td>
                    <td className="p-3">{row.sentForReview}</td>
                    <td className="p-3">{row.approved}</td>
                    <td className="p-3 font-semibold text-emerald-700">{row.completed}</td>
                    <td className="p-3"><MeanMedianCell values={row.reviewToApprovalValues} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  )
}