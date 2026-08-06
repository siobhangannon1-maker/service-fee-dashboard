import { cookies } from "next/headers"
import { createServerClient } from "@supabase/ssr"
import { createClient } from "@supabase/supabase-js"

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export type AuditActorRole =
  | "provider"
  | "typist"
  | "admin"
  | "staff"
  | "unknown"

export type AuditActor = {
  actorUserId: string | null
  actorFullName: string
  actorEmail: string | null
  actorInitials: string
  actorRole: AuditActorRole
  rawProfileRole: string | null
}

function makeReadableNameFromEmail(email?: string | null) {
  const localPart = String(email || "")
    .trim()
    .toLowerCase()
    .split("@")[0]

  if (!localPart) return ""

  return localPart
    .replace(/[0-9]/g, "")
    .replace(/[._-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function getInitials(name?: string | null, email?: string | null) {
  if (name) {
    const parts = name.trim().split(/\s+/).filter(Boolean)
    const initials = parts.map((part) => part[0]).join("")

    if (initials) return initials.slice(0, 3).toUpperCase()
  }

  if (email) return email.slice(0, 2).toUpperCase()

  return "?"
}

export function normaliseAuditActorRole(value: unknown): AuditActorRole {
  const role = String(value || "").trim().toLowerCase()

  if (role === "provider" || role === "provider_readonly") return "provider"
  if (role === "typist") return "typist"
  if (role === "admin" || role === "super_admin") return "admin"

  if (
    role === "staff" ||
    role === "practice_manager" ||
    role === "billing_staff"
  ) {
    return "staff"
  }

  return "unknown"
}

export async function getAuditActor(): Promise<AuditActor> {
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
        actorRole: "unknown",
        rawProfileRole: null,
      }
    }

    const email = user.email || null

    const { data: profile, error: profileError } = await serviceSupabase
      .from("profiles")
      .select("full_name, email, role")
      .eq("id", user.id)
      .maybeSingle()

    if (profileError) {
      console.warn("Could not load audit actor profile:", profileError)
    }

    const profileFullName = String(profile?.full_name || "").trim()
    const metadataFullName = String(user.user_metadata?.full_name || "").trim()
    const metadataName = String(user.user_metadata?.name || "").trim()
    const fallbackName = makeReadableNameFromEmail(email)

    const fullName =
      profileFullName ||
      metadataFullName ||
      metadataName ||
      fallbackName ||
      email ||
      "Unknown user"

    const resolvedEmail = profile?.email || email
    const rawProfileRole = String(profile?.role || "").trim() || null

    return {
      actorUserId: user.id,
      actorFullName: fullName,
      actorEmail: resolvedEmail,
      actorInitials: getInitials(fullName, resolvedEmail),
      actorRole: normaliseAuditActorRole(rawProfileRole),
      rawProfileRole,
    }
  } catch (error) {
    console.error("Failed to get audit actor:", error)

    return {
      actorUserId: null,
      actorFullName: "Unknown user",
      actorEmail: null,
      actorInitials: "?",
      actorRole: "unknown",
      rawProfileRole: null,
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
  reportDraftId?: string | null
  providerId?: string | null
  patientName?: string | null
  action: string
  details?: Record<string, unknown>
}) {
  const actor = await getAuditActor()

  const queueId = typeof details?.queueId === "string" ? details.queueId : null
  const entityType = reportDraftId ? "report_draft" : "report_letter_queue"
  const entityId = reportDraftId || queueId

  if (!entityId) {
    console.warn("Audit event skipped because no entity ID was provided.", {
      action,
      patientName,
      providerId,
      details,
    })
    return
  }

  const { error } = await serviceSupabase
    .from("report_writing_audit_events")
    .insert({
      actor_full_name: actor.actorFullName,
      actor_initials: actor.actorInitials,
      actor_email: actor.actorEmail,
      action,
      entity_type: entityType,
      entity_id: entityId,
      provider_id: providerId || null,
      patient_name: patientName || null,
      details: {
        ...(details || {}),
        actorUserId: actor.actorUserId,
        actorRole: actor.actorRole,
        rawProfileRole: actor.rawProfileRole,
      },
    })

  if (error) {
    console.error("Failed to create report audit event:", error)
  }
}
