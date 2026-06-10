import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import {
  getCurrentUserPraktikaSessionMode,
  type PraktikaSessionMode,
} from "@/lib/praktika/hybrid-session-store";
import { praktikaHelperPost } from "@/lib/praktika/helper-job-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type PraktikaReferral = {
  id?: string | number;
  date?: string;
  createdDate?: string;
  reason?: string;
  party?: {
    id?: string | number;
    clinicId?: string | number;
    provider?: {
      id?: string | number;
      title?: string;
      firstName?: string;
      lastName?: string;
      providerNumber?: string;
    };
  };
  providerId?: string | number;
  [key: string]: unknown;
};

type ReportReferrer = {
  id?: string;
  name?: string | null;
  address?: string | null;
  praktika_referrer_id?: string | null;
  practice_name?: string | null;
  phone?: string | null;
  email?: string | null;
  is_active?: boolean | null;
  raw_json?: Record<string, unknown> | null;
  praktika_referrer_key?: string | null;
};

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function normaliseName(value: unknown) {
  return clean(value)
    .toLowerCase()
    .replace(/^dr\.?\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normaliseKey(value: unknown) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, "");
}

function getReferralSortDate(referral: PraktikaReferral) {
  return new Date(
    clean(referral.createdDate) || clean(referral.date) || "1900-01-01",
  ).getTime();
}

function formatProviderName(referral: PraktikaReferral) {
  const provider = referral.party?.provider;

  return [provider?.title, provider?.firstName, provider?.lastName]
    .map(clean)
    .filter(Boolean)
    .join(" ");
}

function formatReferrerAddress(referrer: ReportReferrer | null) {
  if (!referrer) return "";

  const practiceName = clean(referrer.practice_name);
  const address = clean(referrer.address);

  if (!practiceName) return address;
  if (!address) return practiceName;

  const firstLine = address.split(/\n+/)[0]?.trim().toLowerCase();

  if (firstLine === practiceName.toLowerCase()) {
    return address;
  }

  return [practiceName, address].filter(Boolean).join("\n");
}

function isOwnPracticeText(value: unknown) {
  const text = clean(value).toLowerCase();

  return (
    text.includes("focus dental specialists") ||
    text.includes("focus dental")
  );
}

function isOwnPracticeReferrer(referrer: ReportReferrer) {
  return isOwnPracticeText(
    [
      referrer.name,
      referrer.practice_name,
      referrer.address,
      JSON.stringify(referrer.raw_json || {}),
    ]
      .map(clean)
      .join(" "),
  );
}

function rawJsonContainsExactValue(value: unknown, target: string): boolean {
  const cleanTarget = clean(target);
  if (!cleanTarget) return false;

  if (value === null || typeof value === "undefined") return false;

  if (typeof value === "string" || typeof value === "number") {
    return clean(value) === cleanTarget;
  }

  if (Array.isArray(value)) {
    return value.some((item) => rawJsonContainsExactValue(item, cleanTarget));
  }

  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((nested) =>
      rawJsonContainsExactValue(nested, cleanTarget),
    );
  }

  return false;
}

function rawJsonContainsNormalisedValue(value: unknown, target: string): boolean {
  const cleanTarget = normaliseKey(target);
  if (!cleanTarget) return false;

  if (value === null || typeof value === "undefined") return false;

  if (typeof value === "string" || typeof value === "number") {
    return normaliseKey(value) === cleanTarget;
  }

  if (Array.isArray(value)) {
    return value.some((item) =>
      rawJsonContainsNormalisedValue(item, cleanTarget),
    );
  }

  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((nested) =>
      rawJsonContainsNormalisedValue(nested, cleanTarget),
    );
  }

  return false;
}

function extractPatientReferrals(parsed: any): PraktikaReferral[] {
  const found: PraktikaReferral[] = [];

  function walk(value: any) {
    if (!value) return;

    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }

    if (typeof value !== "object") return;

    if (Array.isArray(value.patient_referrals)) {
      found.push(...value.patient_referrals);
    }

    for (const nested of Object.values(value)) {
      if (nested && typeof nested === "object") walk(nested);
    }
  }

  walk(parsed);

  const unique = new Map<string, PraktikaReferral>();

  for (const referral of found) {
    const key = clean(referral.id) || JSON.stringify(referral).slice(0, 300);

    if (!unique.has(key)) {
      unique.set(key, referral);
    }
  }

  return Array.from(unique.values());
}

async function fetchReferralsFromPraktika({
  patientId,
  practiceId,
  mode,
}: {
  patientId: string;
  practiceId: string;
  mode: PraktikaSessionMode;
}) {
  return await praktikaHelperPost<any>({
    mode,
    jobType: "report_writing_latest_referral",
    path: "/php/forms/db_getFormData.php",
    contentType: "json",
    referer:
      "https://praktika.praktika.net.au/v2/patient-directory/patient-search",
    priority: 30,
    timeoutMs: 300_000,
    body: [
      {
        parameters: [
          {
            practice_id: Number(practiceId),
            patient_id: Number(patientId),
          },
        ],
        // Praktika can return [] if only patient_referrals is requested.
        // This broader patient payload reliably includes referrals.
        fields: [
          "patient_id",
          "patient_title",
          "patient_firstname",
          "patient_lastname",
          "patient_fullname",
          "patient_preferredname",
          "patient_shortname",
          "patient_gender",
          "patient_dob",
          "patient_birthdate",
          "patient_preferredproviderid",
          "patient_referrals",
        ],
      },
    ],
  });
}

const REFERRER_SELECT =
  "id, name, address, praktika_referrer_id, practice_name, phone, email, is_active, raw_json, praktika_referrer_key";

async function addReferrerCandidates(
  map: Map<string, ReportReferrer>,
  data: ReportReferrer[] | null,
) {
  for (const referrer of data || []) {
    if (!referrer.id) continue;
    map.set(referrer.id, referrer);
  }
}

async function findReportReferrerForReferral(referral: PraktikaReferral) {
  const provider = referral.party?.provider;
  const providerName = formatProviderName(referral);
  const providerNameNoTitle = providerName.replace(/^Dr\.?\s+/i, "").trim();

  const providerNumber = clean(provider?.providerNumber);
  const providerId = clean(provider?.id);
  const referralProviderId = clean(referral.providerId);
  const partyId = clean(referral.party?.id);
  const clinicId = clean(referral.party?.clinicId);

  const firstName = clean(provider?.firstName);
  const lastName = clean(provider?.lastName);

  const candidateMap = new Map<string, ReportReferrer>();
  const lookupErrors: string[] = [];

  async function safeLookup(label: string, queryBuilder: any) {
    const { data, error } = await queryBuilder;

    if (error) {
      lookupErrors.push(`${label}: ${error.message}`);
      return;
    }

    await addReferrerCandidates(candidateMap, data as ReportReferrer[] | null);
  }

  /*
    IMPORTANT:
    Do NOT query provider_number as a column. Your report_referrers schema does
    not have a provider_number column. Provider number matching must happen via
    raw_json or praktika_referrer_key.
  */

  const possibleExactIds = [
    partyId,
    providerId,
    referralProviderId,
    clinicId,
    providerNumber,
  ].filter(Boolean);

  if (possibleExactIds.length > 0) {
    await safeLookup(
      "praktika_referrer_id in possible ids",
      supabase
        .from("report_referrers")
        .select(REFERRER_SELECT)
        .eq("is_active", true)
        .in("praktika_referrer_id", possibleExactIds)
        .limit(50),
    );

    await safeLookup(
      "praktika_referrer_key in possible ids",
      supabase
        .from("report_referrers")
        .select(REFERRER_SELECT)
        .eq("is_active", true)
        .in("praktika_referrer_key", possibleExactIds)
        .limit(50),
    );
  }

  if (providerNumber) {
    await safeLookup(
      "praktika_referrer_key ilike provider number",
      supabase
        .from("report_referrers")
        .select(REFERRER_SELECT)
        .eq("is_active", true)
        .ilike("praktika_referrer_key", `%${providerNumber}%`)
        .limit(50),
    );
  }

  if (providerNameNoTitle) {
    await safeLookup(
      "name ilike full provider name",
      supabase
        .from("report_referrers")
        .select(REFERRER_SELECT)
        .eq("is_active", true)
        .ilike("name", `%${providerNameNoTitle}%`)
        .limit(50),
    );
  }

  if (lastName) {
    await safeLookup(
      "name ilike last name",
      supabase
        .from("report_referrers")
        .select(REFERRER_SELECT)
        .eq("is_active", true)
        .ilike("name", `%${lastName}%`)
        .limit(80),
    );
  }

  if (firstName && lastName) {
    await safeLookup(
      "name ilike first name",
      supabase
        .from("report_referrers")
        .select(REFERRER_SELECT)
        .eq("is_active", true)
        .ilike("name", `%${firstName}%`)
        .limit(80),
    );
  }

  const targetName = normaliseName(providerName);
  const targetNameNoTitle = normaliseName(providerNameNoTitle);

  const scored = Array.from(candidateMap.values())
    .map((referrer) => {
      const referrerName = normaliseName(referrer.name);
      const rawJson = referrer.raw_json || {};
      const praktikaReferrerId = clean(referrer.praktika_referrer_id);
      const praktikaReferrerKey = clean(referrer.praktika_referrer_key);

      let score = 0;
      const reasons: string[] = [];

      function add(points: number, reason: string) {
        score += points;
        reasons.push(reason);
      }

      if (partyId && praktikaReferrerId === partyId) {
        add(300, "praktika_referrer_id matches referral party id");
      }

      if (providerId && praktikaReferrerId === providerId) {
        add(260, "praktika_referrer_id matches provider id");
      }

      if (referralProviderId && praktikaReferrerId === referralProviderId) {
        add(230, "praktika_referrer_id matches referral providerId");
      }

      if (clinicId && praktikaReferrerId === clinicId) {
        add(180, "praktika_referrer_id matches clinic id");
      }

      if (providerNumber && praktikaReferrerId === providerNumber) {
        add(300, "praktika_referrer_id matches provider number");
      }

      for (const value of [partyId, providerId, referralProviderId, clinicId, providerNumber]) {
        if (!value) continue;
        if (praktikaReferrerKey && praktikaReferrerKey.includes(value)) {
          add(160, `praktika_referrer_key contains ${value}`);
        }
      }

      if (providerNumber && rawJsonContainsExactValue(rawJson, providerNumber)) {
        add(220, "raw_json contains exact provider number");
      }

      if (clinicId && rawJsonContainsExactValue(rawJson, clinicId)) {
        add(160, "raw_json contains exact clinic id");
      }

      if (partyId && rawJsonContainsExactValue(rawJson, partyId)) {
        add(160, "raw_json contains exact party id");
      }

      if (providerId && rawJsonContainsExactValue(rawJson, providerId)) {
        add(140, "raw_json contains exact provider id");
      }

      if (
        targetName &&
        (referrerName === targetName || referrerName === targetNameNoTitle)
      ) {
        add(120, "name exact match");
      }

      if (targetNameNoTitle && referrerName.includes(targetNameNoTitle)) {
        add(80, "name contains provider name");
      }

      if (targetNameNoTitle && targetNameNoTitle.includes(referrerName)) {
        add(50, "provider name contains row name");
      }

      if (firstName && referrerName.includes(firstName.toLowerCase())) {
        add(20, "first name match");
      }

      if (lastName && referrerName.includes(lastName.toLowerCase())) {
        add(35, "last name match");
      }

      if (
        providerNameNoTitle &&
        rawJsonContainsNormalisedValue(rawJson, providerNameNoTitle)
      ) {
        add(70, "raw_json contains provider name");
      }

      if (clean(referrer.practice_name)) add(25, "has practice name");
      if (clean(referrer.address)) add(35, "has address");

      if (isOwnPracticeReferrer(referrer)) {
        add(-1000, "excluded own practice");
      }

      if (!clean(referrer.practice_name) && !clean(referrer.address)) {
        add(-40, "no practice/address");
      }

      return { referrer, score, reasons };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const matched = scored[0] || null;

  return {
    matchedReferrer: matched?.referrer || null,
    debug: {
      lookupErrors,
      candidateCount: candidateMap.size,
      topCandidates: scored.slice(0, 5).map((item) => ({
        id: item.referrer.id,
        name: item.referrer.name,
        practice_name: item.referrer.practice_name,
        hasAddress: Boolean(clean(item.referrer.address)),
        praktika_referrer_id: item.referrer.praktika_referrer_id,
        praktika_referrer_key: item.referrer.praktika_referrer_key,
        score: item.score,
        reasons: item.reasons,
        isOwnPractice: isOwnPracticeReferrer(item.referrer),
      })),
    },
  };
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const patientId = clean(body.patientId);

    if (!patientId) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Missing patientId. The selected queue item may not have a Praktika patient ID linked.",
        },
        { status: 400 },
      );
    }

    const mode = await getCurrentUserPraktikaSessionMode();
    const practiceId = clean(process.env.PRAKTIKA_PRACTICE_ID) || "1181";

    const parsed = await fetchReferralsFromPraktika({
      patientId,
      practiceId,
      mode,
    });

    const referrals = extractPatientReferrals(parsed);

    const latestReferral = referrals
      .filter((referral) => formatProviderName(referral))
      .sort((a, b) => getReferralSortDate(b) - getReferralSortDate(a))[0];

    if (!latestReferral) {
      return NextResponse.json({
        success: true,
        referral: null,
        debug: {
          patientId,
          practiceId,
          referralCount: referrals.length,
          parsedPreview: JSON.stringify(parsed).slice(0, 1500),
          message:
            referrals.length > 0
              ? "Referral records were found, but none had a provider name at party.provider."
              : "No patient_referrals records were found in the Praktika response.",
        },
      });
    }

    const provider = latestReferral.party?.provider;
    const { matchedReferrer, debug: matchDebug } =
      await findReportReferrerForReferral(latestReferral);

    const referrerAddress = matchedReferrer
      ? formatReferrerAddress(matchedReferrer)
      : "";

    return NextResponse.json({
      success: true,
      referral: {
        referralId: latestReferral.id || "",
        referralDate: latestReferral.date || "",
        createdDate: latestReferral.createdDate || "",
        referrerName: formatProviderName(latestReferral),
        referrerAddress,
        providerId: provider?.id || null,
        providerNumber: provider?.providerNumber || "",
        clinicId: latestReferral.party?.clinicId || null,
        partyId: latestReferral.party?.id || null,
        referralProviderId: latestReferral.providerId || null,
        reason: latestReferral.reason || "",
      },
      debug: {
        patientId,
        practiceId,
        referralCount: referrals.length,
        selectedReferralId: latestReferral.id || null,
        selectedReferralDate:
          latestReferral.createdDate || latestReferral.date || null,
        selectedReferralClinicId: latestReferral.party?.clinicId || null,
        selectedReferralPartyId: latestReferral.party?.id || null,
        selectedReferralProviderId: latestReferral.providerId || null,
        selectedProviderId: provider?.id || null,
        selectedProviderNumber: provider?.providerNumber || null,
        reportReferrerMatched: matchedReferrer
          ? {
              id: matchedReferrer.id,
              name: matchedReferrer.name,
              practice_name: matchedReferrer.practice_name,
              hasAddress: Boolean(clean(matchedReferrer.address)),
              praktika_referrer_id: matchedReferrer.praktika_referrer_id,
              praktika_referrer_key: matchedReferrer.praktika_referrer_key,
            }
          : null,
        matchDebug,
        message: matchedReferrer
          ? referrerAddress
            ? "Matched referral provider to report_referrers and found practice/address."
            : "Matched referral provider to report_referrers, but the matched row has no practice/address."
          : "No matching active report_referrers row was found for the referral provider using your current schema.",
      },
    });
  } catch (error) {
    console.error("Latest Praktika referral lookup failed:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Latest Praktika referral lookup failed.",
      },
      { status: 500 },
    );
  }
}
