import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

const ALLOWED_ROLES = [
  "billing_staff",
  "practice_manager",
  "admin",
  "super_admin",
];

const CAN_UNLOCK_ROLES = ["practice_manager", "admin", "super_admin"];

type ProfileRow = {
  id: string;
  full_name: string | null;
  role: string | null;
};

type PatientFinancialEntry = {
  id: string;
  provider_id: string;
  related_provider_id: string | null;
  billing_period_id: string | null;
  patient_name: string;
  entry_date: string;
  category: string;
  amount: number;
  notes: string | null;
  deleted_at?: string | null;
  is_verified?: boolean;
  verified_at?: string | null;
  verified_by?: string | null;
  verified_by_initials?: string | null;
  is_review_locked?: boolean;
};

function normaliseRole(role: string | null | undefined) {
  return String(role || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/-/g, "_");
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) return "?";

  if (parts.length === 1) {
    const first = parts[0].replace(/[^a-zA-Z]/g, "");
    return first ? first.slice(0, 2).toUpperCase() : "?";
  }

  const first = parts[0].replace(/[^a-zA-Z]/g, "");
  const second = parts[1].replace(/[^a-zA-Z]/g, "");

  if (!first && !second) return "?";
  if (!first) return second.slice(0, 2).toUpperCase() || "?";
  if (!second) return first.slice(0, 2).toUpperCase() || "?";

  return `${first[0]}${second[0]}`.toUpperCase();
}

async function writePatientEntryReviewAuditLog(params: {
  action: string;
  actorUserId: string;
  entry: PatientFinancialEntry;
  reviewerInitials?: string | null;
  reviewStatus?: string | null;
}) {
  const { action, actorUserId, entry, reviewerInitials, reviewStatus } = params;

  await supabaseAdmin.from("audit_log").insert({
    actor_user_id: actorUserId,
    action,
    entity_type: "patient_financial_entry",
    entity_id: entry.id,
    billing_period_id: entry.billing_period_id,
    provider_id: entry.provider_id,
    metadata: {
      patient_name: entry.patient_name,
      category: entry.category,
      amount: entry.amount,
      notes: entry.notes,
      reviewer_initials: reviewerInitials || null,
      review_status: reviewStatus,
      review_source: "review_page",
    },
  });
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, role")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json(
        { error: "Profile not found." },
        { status: 403 },
      );
    }

    const typedProfile = profile as ProfileRow;
    const profileRole = normaliseRole(typedProfile.role);

    if (!profileRole || !ALLOWED_ROLES.includes(profileRole)) {
      return NextResponse.json(
        { error: "You do not have permission to review entries." },
        { status: 403 },
      );
    }

    const body = await request.json();

    const entryId =
      typeof body.entryId === "string" && body.entryId.length > 0
        ? body.entryId
        : "";

    const action =
      body.action === "unlock"
        ? "unlock"
        : body.action === "update"
          ? "update"
          : "review";

    if (!entryId) {
      return NextResponse.json({ error: "Missing entry ID." }, { status: 400 });
    }

    if (action === "unlock" && !CAN_UNLOCK_ROLES.includes(profileRole)) {
      return NextResponse.json(
        { error: "Only managers and admins can unlock reviewed entries." },
        { status: 403 },
      );
    }

    const { data: existingEntry, error: entryError } = await supabaseAdmin
      .from("patient_financial_entries")
      .select("*")
      .eq("id", entryId)
      .is("deleted_at", null)
      .single();

    if (entryError || !existingEntry) {
      return NextResponse.json({ error: "Entry not found." }, { status: 404 });
    }

    const entry = existingEntry as PatientFinancialEntry;

    if (action === "update") {
      if (entry.is_review_locked) {
        return NextResponse.json(
          { error: "This entry is reviewed and locked, so it cannot be edited." },
          { status: 400 },
        );
      }

      const amount = Number(body.amount);

      if (!body.provider_id || typeof body.provider_id !== "string") {
        return NextResponse.json(
          { error: "Provider is required." },
          { status: 400 },
        );
      }

      if (!body.patient_name || typeof body.patient_name !== "string") {
        return NextResponse.json(
          { error: "Patient name is required." },
          { status: 400 },
        );
      }

      if (!body.entry_date || typeof body.entry_date !== "string") {
        return NextResponse.json(
          { error: "Date is required." },
          { status: 400 },
        );
      }

      if (!body.category || typeof body.category !== "string") {
        return NextResponse.json(
          { error: "Category is required." },
          { status: 400 },
        );
      }

      if (Number.isNaN(amount)) {
        return NextResponse.json(
          { error: "Amount must be valid." },
          { status: 400 },
        );
      }

      if (
        body.category === "paid_to_wrong_provider" &&
        (!body.related_provider_id ||
          typeof body.related_provider_id !== "string")
      ) {
        return NextResponse.json(
          { error: "Please select the provider actually owed." },
          { status: 400 },
        );
      }

      const payload = {
        provider_id: body.provider_id,
        related_provider_id:
          body.category === "paid_to_wrong_provider"
            ? body.related_provider_id
            : null,
        patient_name: body.patient_name.trim(),
        entry_date: body.entry_date,
        category: body.category,
        amount,
        notes:
          typeof body.notes === "string" && body.notes.trim()
            ? body.notes.trim()
            : null,
      };

      const { data: updatedEntry, error: updateError } = await supabaseAdmin
        .from("patient_financial_entries")
        .update(payload)
        .eq("id", entryId)
        .select("*")
        .single();

      if (updateError || !updatedEntry) {
        return NextResponse.json(
          { error: updateError?.message || "Failed to update entry." },
          { status: 500 },
        );
      }

      await writePatientEntryReviewAuditLog({
        action: "patient_entry_updated_from_review",
        actorUserId: user.id,
        entry: {
          ...entry,
          ...payload,
          amount,
        },
        reviewStatus: "updated_before_lock",
      });

      return NextResponse.json({ entry: updatedEntry });
    }

    if (action === "review") {
      if (entry.is_review_locked) {
        return NextResponse.json(
          { error: "This entry is already reviewed and locked." },
          { status: 400 },
        );
      }

      const displayName = typedProfile.full_name?.trim() || user.email || user.id;
      const initials = getInitials(displayName);

      const { data: updatedEntry, error: updateError } = await supabaseAdmin
        .from("patient_financial_entries")
        .update({
          is_verified: true,
          verified_at: new Date().toISOString(),
          verified_by: user.id,
          verified_by_initials: initials,
          is_review_locked: true,
        })
        .eq("id", entryId)
        .select("*")
        .single();

      if (updateError || !updatedEntry) {
        return NextResponse.json(
          {
            error:
              updateError?.message || "Failed to review and lock this entry.",
          },
          { status: 500 },
        );
      }

      await writePatientEntryReviewAuditLog({
        action: "patient_entry_reviewed",
        actorUserId: user.id,
        entry,
        reviewerInitials: initials,
        reviewStatus: "verified_locked",
      });

      return NextResponse.json({ entry: updatedEntry });
    }

    const { data: updatedEntry, error: updateError } = await supabaseAdmin
      .from("patient_financial_entries")
      .update({
        is_verified: false,
        verified_at: null,
        verified_by: null,
        verified_by_initials: null,
        is_review_locked: false,
      })
      .eq("id", entryId)
      .select("*")
      .single();

    if (updateError || !updatedEntry) {
      return NextResponse.json(
        { error: updateError?.message || "Failed to unlock this entry." },
        { status: 500 },
      );
    }

    await writePatientEntryReviewAuditLog({
      action: "patient_entry_review_removed",
      actorUserId: user.id,
      entry,
      reviewerInitials: entry.verified_by_initials || null,
      reviewStatus: "review_removed",
    });

    return NextResponse.json({ entry: updatedEntry });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Review action failed.",
      },
      { status: 500 },
    );
  }
}