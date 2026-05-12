import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createPraktikaPatientFromInboxItem } from "@/lib/ai/brain/praktikaNewPatient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getInitials(name?: string | null, email?: string | null) {
  const cleanName = String(name || "").trim();

  if (cleanName) {
    return cleanName
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("");
  }

  const cleanEmail = String(email || "").trim();
  if (cleanEmail) return cleanEmail.slice(0, 2).toUpperCase();

  return "AI";
}

function splitName(value: string) {
  const parts = String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };

  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1],
  };
}

function normaliseEmail(value: any) {
  return String(value || "").trim().toLowerCase();
}

function getSafePatientEmail({
  requestedEmail,
  extractedPatientEmail,
  senderEmail,
}: {
  requestedEmail?: string | null;
  extractedPatientEmail?: string | null;
  senderEmail?: string | null;
}) {
  const requested = normaliseEmail(requestedEmail);
  const extracted = normaliseEmail(extractedPatientEmail);
  const sender = normaliseEmail(senderEmail);

  const candidate = requested || extracted;

  if (!candidate) return null;
  if (sender && candidate === sender) return null;

  return candidate;
}

function suggestedPatientDetails(item: any) {
  const fromExtracted = {
    firstName: String(item.extracted_patient_first_name || "").trim(),
    lastName: String(item.extracted_patient_last_name || "").trim(),
  };

  const fromPatientName = splitName(String(item.patient_name || ""));

  const safeEmail = getSafePatientEmail({
    extractedPatientEmail: item.extracted_patient_email,
    senderEmail: item.sender_email,
  });

  return {
    firstName: fromExtracted.firstName || fromPatientName.firstName,
    lastName: fromExtracted.lastName || fromPatientName.lastName,
    dob: String(item.extracted_patient_dob || item.patient_dob || "").trim(),
    mobile: String(item.extracted_patient_mobile || "").trim(),
    email: safeEmail || "",
    referrerName: String(
      item.correspondence_author_name ||
        item.extracted_referrer_name ||
        item.correspondence_sender_name ||
        "",
    ).trim(),
    referrerPractice: String(item.extracted_referrer_practice || "").trim(),
    referrerProviderNumber: String(
      item.extracted_referrer_provider_number || "",
    ).trim(),
    referrerAddress: String(item.extracted_referrer_address || "").trim(),
    referralReason: String(
      item.extracted_referral_reason || item.summary || "",
    ).trim(),
  };
}

export async function POST(request: Request) {
  try {
    const { user } = await requireRole(["super_admin"]);
    const body = await request.json();

    const inboxItemId = String(body.inboxItemId || "").trim();
    const dryRun = Boolean(body.dryRun);

    if (!inboxItemId) {
      return NextResponse.json(
        { ok: false, error: "Missing inboxItemId." },
        { status: 400 },
      );
    }

    const { data: item, error: itemError } = await supabaseAdmin
      .from("ai_inbox_items")
      .select("*")
      .eq("id", inboxItemId)
      .single();

    if (itemError || !item) {
      return NextResponse.json(
        { ok: false, error: itemError?.message || "Inbox item not found." },
        { status: 404 },
      );
    }

    const suggested = suggestedPatientDetails(item);

    if (dryRun) {
      const missing = [];
      if (!suggested.firstName) missing.push("first name");
      if (!suggested.lastName) missing.push("last name");
      if (!suggested.dob) missing.push("DOB");
      if (!suggested.mobile) missing.push("mobile");

      return NextResponse.json(
        {
          ok: true,
          dryRun: true,
          suggested,
          missing,
          item,
        },
        {
          headers: { "Cache-Control": "no-store" },
        },
      );
    }

    let fullName: string | null = null;

    if (user?.id) {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle();

      fullName = profile?.full_name || null;
    }

    const safeEmail = getSafePatientEmail({
      requestedEmail: body.email,
      extractedPatientEmail: item.extracted_patient_email,
      senderEmail: item.sender_email,
    });

    const result = await createPraktikaPatientFromInboxItem({
      input: {
        inboxItemId,
        firstName: String(body.firstName || suggested.firstName || "").trim(),
        lastName: String(body.lastName || suggested.lastName || "").trim(),
        dob: String(body.dob || suggested.dob || "").trim(),
        mobile: String(body.mobile || suggested.mobile || "").trim(),
        email: safeEmail,
        partyId: body.partyId ? String(body.partyId).trim() : null,
        referralDate: body.referralDate
          ? String(body.referralDate).trim()
          : null,
        referralReason: String(
          body.referralReason || suggested.referralReason || "",
        ).trim(),
        referralNotes: String(body.referralNotes || "").trim(),
        createReferral: body.createReferral !== false,
        fileAttachments: body.fileAttachments !== false,
      },
      actor: {
        userId: user?.id || null,
        email: user?.email || null,
        fullName,
        initials: getInitials(fullName, user?.email || null),
      },
    });

    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "New patient creation failed.",
      },
      {
        status: 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}