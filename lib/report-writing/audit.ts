import { cookies } from "next/headers"
import { createServerClient } from "@supabase/ssr"
import { createClient } from "@supabase/supabase-js"

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function getInitials(name?: string | null, email?: string | null) {
  if (name) {
    const parts = name.trim().split(/\s+/).filter(Boolean)
    const initials = parts.map((part) => part[0]).join("")
    if (initials) return initials.slice(0, 3).toUpperCase()
  }

  if (email) return email.slice(0, 2).toUpperCase()

  return "?"
}

export async function getAuditActor() {
  try {
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
        actorUserId: null,
        actorFullName: "Unknown user",
        actorEmail: null,
        actorInitials: "?",
      }
    }

    const fullName =
      user.user_metadata?.full_name ||
      user.user_metadata?.name ||
      user.email ||
      "Unknown user"

    return {
      actorUserId: user.id,
      actorFullName: fullName,
      actorEmail: user.email || null,
      actorInitials: getInitials(fullName, user.email),
    }
  } catch {
    return {
      actorUserId: null,
      actorFullName: "Unknown user",
      actorEmail: null,
      actorInitials: "?",
    }
  }
}

export async function createReportAuditEvent({
  reportDraftId,
  providerId,
  patientName,
  action,
  details,
}: {
  reportDraftId: string
  providerId?: string | null
  patientName?: string | null
  action: string
  details?: Record<string, unknown>
}) {
  const actor = await getAuditActor()

  await serviceSupabase.from("report_writing_audit_events").insert({
    report_draft_id: reportDraftId,
    provider_id: providerId || null,
    patient_name: patientName || null,
    actor_user_id: actor.actorUserId,
    actor_full_name: actor.actorFullName,
    actor_initials: actor.actorInitials,
    actor_email: actor.actorEmail,
    action,
    details: details || {},
  })
}