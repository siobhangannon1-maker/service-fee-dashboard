import { NextRequest, NextResponse } from "next/server";

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
};

const PRAKTIKA_FORM_DATA_URL =
  "https://praktika.praktika.net.au/php/forms/db_getFormData.php";

const PRAKTIKA_PRACTICE_ID = Number(process.env.PRAKTIKA_PRACTICE_ID || 1181);

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

function getPraktikaCookieFromRequest(request: NextRequest) {
  // Development fallback only.
  // Example env value:
  // PRAKTIKA_COOKIE="PHPSESSID=...; UAT=..."
  if (process.env.PRAKTIKA_COOKIE) {
    return process.env.PRAKTIKA_COOKIE;
  }

  // Optional proxy fallback if you already pass a Praktika cookie internally.
  // Do not expose this publicly to browsers.
  return request.headers.get("x-praktika-cookie") || "";
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const patientId = clean(body.patientId);

    if (!patientId) {
      return NextResponse.json(
        { success: false, error: "Missing patientId." },
        { status: 400 },
      );
    }

    const praktikaCookie = getPraktikaCookieFromRequest(request);

    if (!praktikaCookie) {
      return NextResponse.json(
        {
          success: false,
          error:
            "No Praktika session cookie available. Wire this route into the same Praktika session/auth helper used by your existing Praktika clinical-notes endpoint.",
        },
        { status: 401 },
      );
    }

    const praktikaResponse = await fetch(PRAKTIKA_FORM_DATA_URL, {
      method: "POST",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json",
        Cookie: praktikaCookie,
        Origin: "https://praktika.praktika.net.au",
        Referer: "https://praktika.praktika.net.au/v2/scheduler",
      },
      body: JSON.stringify([
        {
          parameters: [
            {
              practice_id: PRAKTIKA_PRACTICE_ID,
              patient_id: Number(patientId),
            },
          ],
          fields: ["patient_referrals"],
        },
      ]),
      cache: "no-store",
    });

    const text = await praktikaResponse.text();

    let data: any;

    try {
      data = JSON.parse(text);
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: "Praktika returned a non-JSON response.",
          preview: text.slice(0, 300),
        },
        { status: 502 },
      );
    }

    if (!praktikaResponse.ok) {
      return NextResponse.json(
        {
          success: false,
          error: `Praktika request failed with status ${praktikaResponse.status}.`,
          data,
        },
        { status: 502 },
      );
    }

    const referrals = Array.isArray(data?.patient_referrals)
      ? (data.patient_referrals as PraktikaReferral[])
      : [];

    const latestReferral = referrals
      .filter((referral) => formatProviderName(referral))
      .sort((a, b) => getReferralSortDate(b) - getReferralSortDate(a))[0];

    if (!latestReferral) {
      return NextResponse.json({ success: true, referral: null });
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
