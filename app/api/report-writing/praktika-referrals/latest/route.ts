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
  isCompleted?: boolean;
  isSuccessful?: boolean;
  statusId?: string | number;
  statusHistory?: unknown[];
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
  praktika_clinic_id?: string | null;
  practice_name?: string | null;
  phone?: string | null;
  email?: string | null;
  is_active?: boolean | null;
  raw_json?: Record<string, unknown> | null;
  praktika_referrer_key?: string | null;
};

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function normaliseName(value: unknown): string {
  return clean(value)
    .toLowerCase()
    .replace(/^dr\.?\s+/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normaliseText(value: unknown): string {
  return clean(value)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getReferralSortDate(referral: PraktikaReferral): number {
  const dateValue =
    clean(referral.createdDate) ||
    clean(referral.date) ||
    "1900-01-01";

  const timestamp = new Date(dateValue).getTime();

  return Number.isFinite(timestamp) ? timestamp : 0;
}

function formatProviderName(referral: PraktikaReferral): string {
  const provider = referral.party?.provider;

  return [
    provider?.title,
    provider?.firstName,
    provider?.lastName,
  ]
    .map(clean)
    .filter(Boolean)
    .join(" ");
}

function formatReferrerAddress(
  referrer: ReportReferrer | null,
): string {
  if (!referrer) {
    return "";
  }

  const practiceName = clean(referrer.practice_name);
  const address = clean(referrer.address);

  if (!practiceName) {
    return address;
  }

  if (!address) {
    return practiceName;
  }

  const firstAddressLine =
    address.split(/\n+/)[0]?.trim().toLowerCase() || "";

  if (firstAddressLine === practiceName.toLowerCase()) {
    return address;
  }

  return [practiceName, address].filter(Boolean).join("\n");
}

function isOwnPracticeText(value: unknown): boolean {
  const text = clean(value).toLowerCase();

  return (
    text.includes("focus dental specialists") ||
    text.includes("focus dental")
  );
}

function isOwnPracticeReferrer(
  referrer: ReportReferrer,
): boolean {
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

function extractPatientReferrals(
  parsed: unknown,
): PraktikaReferral[] {
  const found: PraktikaReferral[] = [];

  function walk(value: unknown) {
    if (!value) {
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item);
      }

      return;
    }

    if (typeof value !== "object") {
      return;
    }

    const object = value as Record<string, unknown>;

    if (Array.isArray(object.patient_referrals)) {
      found.push(
        ...(object.patient_referrals as PraktikaReferral[]),
      );
    }

    for (const nested of Object.values(object)) {
      if (nested && typeof nested === "object") {
        walk(nested);
      }
    }
  }

  walk(parsed);

  const unique = new Map<string, PraktikaReferral>();

  for (const referral of found) {
    const key =
      clean(referral.id) ||
      JSON.stringify(referral).slice(0, 300);

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
  return await praktikaHelperPost<unknown>({
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

const REFERRER_SELECT = [
  "id",
  "name",
  "address",
  "praktika_referrer_id",
  "praktika_clinic_id",
  "practice_name",
  "phone",
  "email",
  "is_active",
  "raw_json",
  "praktika_referrer_key",
].join(", ");

async function findReportReferrerForReferral(
  referral: PraktikaReferral,
) {
  const provider = referral.party?.provider;

  const providerName = formatProviderName(referral);
  const providerNameNormalised = normaliseName(providerName);

  const providerId = clean(provider?.id);
  const providerNumber = clean(provider?.providerNumber);
  const referralProviderId = clean(referral.providerId);
  const partyId = clean(referral.party?.id);
  const clinicId = clean(referral.party?.clinicId);

  const lookupErrors: string[] = [];

  /*
    Primary lookup:
    The referral's clinic ID now matches report_referrers.praktika_clinic_id.

    We still query by provider name as well so another provider at the same
    clinic cannot be selected.
  */
  if (clinicId && providerNameNormalised) {
    const providerNameWithoutTitle = providerName.replace(
      /^Dr\.?\s+/i,
      "",
    );

    const { data, error } = await supabase
      .from("report_referrers")
      .select(REFERRER_SELECT)
      .eq("is_active", true)
      .eq("praktika_clinic_id", clinicId)
      .ilike("name", `%${providerNameWithoutTitle}%`)
      .limit(20);

    if (error) {
      lookupErrors.push(
        `clinic id and provider lookup: ${error.message}`,
      );
    } else {
      const exactProviderMatches = (
        (data || []) as ReportReferrer[]
      )
        .filter(
          (row) =>
            !isOwnPracticeReferrer(row) &&
            normaliseName(row.name) === providerNameNormalised,
        )
        .sort((a, b) => {
          const aCompleteness =
            Number(Boolean(clean(a.practice_name))) +
            Number(Boolean(clean(a.address)));

          const bCompleteness =
            Number(Boolean(clean(b.practice_name))) +
            Number(Boolean(clean(b.address)));

          return bCompleteness - aCompleteness;
        });

      if (exactProviderMatches.length > 0) {
        return {
          matchedReferrer: exactProviderMatches[0],
          debug: {
            strategy: "exact_provider_and_praktika_clinic_id",
            clinicId,
            providerName,
            lookupErrors,
            candidateCount: exactProviderMatches.length,
            topCandidates: exactProviderMatches.map((row) => ({
              id: row.id,
              name: row.name,
              practice_name: row.practice_name,
              praktika_clinic_id: row.praktika_clinic_id,
              hasAddress: Boolean(clean(row.address)),
            })),
          },
        };
      }

      const clinicCandidates = (
        (data || []) as ReportReferrer[]
      ).filter((row) => !isOwnPracticeReferrer(row));

      if (clinicCandidates.length === 1) {
        return {
          matchedReferrer: clinicCandidates[0],
          debug: {
            strategy: "single_praktika_clinic_id_candidate",
            clinicId,
            providerName,
            lookupErrors,
            candidateCount: 1,
            topCandidates: clinicCandidates.map((row) => ({
              id: row.id,
              name: row.name,
              practice_name: row.practice_name,
              praktika_clinic_id: row.praktika_clinic_id,
              hasAddress: Boolean(clean(row.address)),
            })),
          },
        };
      }
    }
  }

  /*
    Secondary lookup:
    Retrieve name candidates and score them. Clinic ID receives the strongest
    score, so once the referrer sync has populated the new field, the correct
    clinic wins decisively.
  */
  const providerNameWithoutTitle = providerName.replace(
    /^Dr\.?\s+/i,
    "",
  );

  const { data: candidates, error: candidateError } =
    await supabase
      .from("report_referrers")
      .select(REFERRER_SELECT)
      .eq("is_active", true)
      .ilike("name", `%${providerNameWithoutTitle}%`)
      .limit(100);

  if (candidateError) {
    lookupErrors.push(
      `provider name candidate lookup: ${candidateError.message}`,
    );
  }

  const scored = (
    (candidates || []) as ReportReferrer[]
  )
    .map((referrer) => {
      let score = 0;
      const reasons: string[] = [];

      function add(points: number, reason: string) {
        score += points;
        reasons.push(reason);
      }

      const rowProviderName = normaliseName(referrer.name);
      const rowClinicId = clean(
        referrer.praktika_clinic_id,
      );

      if (
        clinicId &&
        rowClinicId &&
        clinicId === rowClinicId
      ) {
        add(1000, "exact Praktika clinic ID");
      }

      if (
        providerNameNormalised &&
        rowProviderName === providerNameNormalised
      ) {
        add(300, "exact provider name");
      }

      if (
        providerNameNormalised &&
        rowProviderName.includes(providerNameNormalised)
      ) {
        add(100, "provider name contains referral name");
      }

      if (
        providerId &&
        clean(referrer.praktika_referrer_id) === providerId
      ) {
        add(250, "praktika_referrer_id matches provider ID");
      }

      if (
        partyId &&
        clean(referrer.praktika_referrer_id) === partyId
      ) {
        add(250, "praktika_referrer_id matches party ID");
      }

      if (
        referralProviderId &&
        clean(referrer.praktika_referrer_id) ===
          referralProviderId
      ) {
        add(
          220,
          "praktika_referrer_id matches referral provider ID",
        );
      }

      const key = clean(referrer.praktika_referrer_key);

      for (const value of [
        providerNumber,
        providerId,
        referralProviderId,
        partyId,
      ]) {
        if (value && key.includes(value)) {
          add(
            120,
            `praktika_referrer_key contains ${value}`,
          );
        }
      }

      if (clean(referrer.practice_name)) {
        add(20, "has practice name");
      }

      if (clean(referrer.address)) {
        add(30, "has address");
      }

      if (isOwnPracticeReferrer(referrer)) {
        add(-2000, "excluded own practice");
      }

      return {
        referrer,
        score,
        reasons,
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const top = scored[0] || null;
  const second = scored[1] || null;

  /*
    Do not silently select a provider-name tie.

    Before this update, Hawthorne and TC Dental both received the same score
    and the first database row was returned. Now a tied name-only result is
    treated as ambiguous.
  */
  const ambiguous =
    Boolean(top && second) && top!.score === second!.score;

  return {
    matchedReferrer: ambiguous
      ? null
      : top?.referrer || null,
    debug: {
      strategy: ambiguous
        ? "ambiguous_name_only_match"
        : "scored_fallback",
      clinicId,
      providerName,
      lookupErrors,
      candidateCount: scored.length,
      ambiguous,
      topCandidates: scored.slice(0, 10).map((item) => ({
        id: item.referrer.id,
        name: item.referrer.name,
        practice_name: item.referrer.practice_name,
        praktika_clinic_id:
          item.referrer.praktika_clinic_id,
        hasAddress: Boolean(clean(item.referrer.address)),
        score: item.score,
        reasons: item.reasons,
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

    const mode =
      await getCurrentUserPraktikaSessionMode();

    const practiceId =
      clean(process.env.PRAKTIKA_PRACTICE_ID) || "1181";

    const parsed = await fetchReferralsFromPraktika({
      patientId,
      practiceId,
      mode,
    });

    const referrals = extractPatientReferrals(parsed);

    const latestReferral = referrals
      .filter((referral) => formatProviderName(referral))
      .sort(
        (a, b) =>
          getReferralSortDate(b) -
          getReferralSortDate(a),
      )[0];

    if (!latestReferral) {
      return NextResponse.json({
        success: true,
        referral: null,
        debug: {
          patientId,
          practiceId,
          referralCount: referrals.length,
          message:
            referrals.length > 0
              ? "Referral records were found, but none had a provider name at party.provider."
              : "No patient_referrals records were found in the Praktika response.",
        },
      });
    }

    const provider = latestReferral.party?.provider;

    const {
      matchedReferrer,
      debug: matchDebug,
    } = await findReportReferrerForReferral(
      latestReferral,
    );

    const referrerAddress = matchedReferrer
      ? formatReferrerAddress(matchedReferrer)
      : "";

    return NextResponse.json({
      success: true,
      referral: {
        referralId: latestReferral.id || "",
        referralDate: latestReferral.date || "",
        createdDate: latestReferral.createdDate || "",
        referrerName:
          formatProviderName(latestReferral),
        referrerPracticeName:
          matchedReferrer?.practice_name || "",
        referrerAddress,
        providerId: provider?.id || null,
        providerNumber:
          provider?.providerNumber || "",
        clinicId:
          latestReferral.party?.clinicId || null,
        partyId:
          latestReferral.party?.id || null,
        referralProviderId:
          latestReferral.providerId || null,
        reason: latestReferral.reason || "",
        isCompleted:
          latestReferral.isCompleted ?? null,
        isSuccessful:
          latestReferral.isSuccessful ?? null,
      },
      debug: {
        patientId,
        practiceId,
        referralCount: referrals.length,
        selectedReferralRaw: latestReferral,
        selectedReferralId:
          latestReferral.id || null,
        selectedReferralDate:
          latestReferral.createdDate ||
          latestReferral.date ||
          null,
        selectedReferralClinicId:
          latestReferral.party?.clinicId || null,
        selectedReferralPartyId:
          latestReferral.party?.id || null,
        selectedReferralProviderId:
          latestReferral.providerId || null,
        selectedProviderId:
          provider?.id || null,
        selectedProviderNumber:
          provider?.providerNumber || null,
        reportReferrerMatched: matchedReferrer
          ? {
              id: matchedReferrer.id,
              name: matchedReferrer.name,
              practice_name:
                matchedReferrer.practice_name,
              address: matchedReferrer.address,
              praktika_clinic_id:
                matchedReferrer.praktika_clinic_id,
              praktika_referrer_id:
                matchedReferrer.praktika_referrer_id,
              praktika_referrer_key:
                matchedReferrer.praktika_referrer_key,
            }
          : null,
        matchDebug,
        message: matchedReferrer
          ? referrerAddress
            ? "Matched the referral provider and Praktika clinic ID to report_referrers."
            : "Matched the referral provider and clinic, but the report_referrers row has no address."
          : matchDebug.ambiguous
            ? "Multiple report_referrers rows matched the provider, but none had the referral clinic ID. Run the referrer sync again."
            : "No matching active report_referrers row was found.",
      },
    });
  } catch (error) {
    console.error(
      "Latest Praktika referral lookup failed:",
      error,
    );

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