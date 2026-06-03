import { NextResponse } from "next/server";

import {
  getCurrentUserPraktikaSessionMode,
  type PraktikaSessionMode,
} from "@/lib/praktika/hybrid-session-store";
import { praktikaHelperPost } from "@/lib/praktika/helper-job-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  [key: string]: unknown;
};

function clean(value: unknown) {
  return String(value ?? "").trim();
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
    body: [
      {
        parameters: [
          {
            practice_id: Number(practiceId),
            patient_id: Number(patientId),
          },
        ],
        fields: ["patient_referrals"],
      },
    ],
  });
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

    if (!parsed) {
      return NextResponse.json({
        success: true,
        referral: null,
        debug: {
          patientId,
          practiceId,
          referralCount: 0,
          message: "Praktika returned an empty response.",
        },
      });
    }

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
          message:
            referrals.length > 0
              ? "Referral records were found, but none had a provider name."
              : "No patient_referrals records were found in the Praktika response.",
        },
      });
    }

    const provider = latestReferral.party?.provider;

    return NextResponse.json({
      success: true,
      referral: {
        referralId: latestReferral.id || "",
        referralDate: latestReferral.date || "",
        createdDate: latestReferral.createdDate || "",
        referrerName: formatProviderName(latestReferral),
        referrerAddress: "",
        providerId: provider?.id || null,
        providerNumber: provider?.providerNumber || "",
        clinicId: latestReferral.party?.clinicId || null,
        reason: latestReferral.reason || "",
      },
      debug: {
        patientId,
        practiceId,
        referralCount: referrals.length,
        selectedReferralId: latestReferral.id || null,
        selectedReferralDate:
          latestReferral.createdDate || latestReferral.date || null,
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
