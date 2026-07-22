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

type PraktikaReferralRow = {
  vchProvider?: string | null;
  vchClinic?: string | null;
  vchStreetAddress?: string | null;
  vchSuburb?: string | null;
  vchPostCode?: string | null;
  vchState?: string | null;
  vchEmail?: string | null;
  iReferralCount?: string | number | null;
  mnyTotalReceived?: string | number | null;
  totalIncoming?: string | number | null;
  totalOutgoing?: string | number | null;
  [key: string]: unknown;
};

type PraktikaClinic = {
  id?: string | number | null;
  name?: string | null;
  abn?: string | null;
  streetaddress?: string | null;
  suburb?: string | null;
  postcode?: string | null;
  state?: string | null;
  phone?: string | null;
  fax?: string | null;
  email?: string | null;
  website?: string | null;
  notes?: string | null;
  total_count?: string | number | null;
  [key: string]: unknown;
};

type ClinicDirectoryResponse = {
  customer_referral_clinics?: PraktikaClinic[];
  [key: string]: unknown;
};

type ReferrerImportRow = {
  praktika_referrer_key: string;
  praktika_clinic_id: string | null;
  name: string;
  practice_name: string | null;
  address: string | null;
  email: string | null;
  is_active: boolean;
  raw_json: Record<string, unknown>;
  synced_at: string;
  updated_at: string;
};

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function cleanEmail(value: unknown): string | null {
  const email = clean(value).toLowerCase();

  if (!email || !email.includes("@")) {
    return null;
  }

  return email;
}

function normaliseText(value: unknown): string {
  return clean(value)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normaliseCompact(value: unknown): string {
  return normaliseText(value).replace(/\s+/g, "");
}

function normalisePostcode(value: unknown): string {
  return clean(value).replace(/\D/g, "");
}

function buildReferralAddress(row: PraktikaReferralRow): string {
  const street = clean(row.vchStreetAddress);
  const suburb = clean(row.vchSuburb);
  const state = clean(row.vchState);
  const postcode = clean(row.vchPostCode);

  const suburbLine = [suburb, state, postcode].filter(Boolean).join(" ");

  return [street, suburbLine].filter(Boolean).join("\n");
}

function buildClinicAddress(clinic: PraktikaClinic): string {
  const street = clean(clinic.streetaddress);
  const suburb = clean(clinic.suburb);
  const state = clean(clinic.state);
  const postcode = clean(clinic.postcode);

  const suburbLine = [suburb, state, postcode].filter(Boolean).join(" ");

  return [street, suburbLine].filter(Boolean).join("\n");
}

function buildPraktikaKey(row: PraktikaReferralRow): string {
  return [
    clean(row.vchProvider).toLowerCase(),
    clean(row.vchClinic).toLowerCase(),
    clean(row.vchStreetAddress).toLowerCase(),
    clean(row.vchSuburb).toLowerCase(),
    clean(row.vchPostCode).toLowerCase(),
  ]
    .filter(Boolean)
    .join("|");
}

function extractClinicRows(parsed: unknown): PraktikaClinic[] {
  if (!parsed) {
    return [];
  }

  if (Array.isArray(parsed)) {
    const directClinics = parsed.filter(
      (item) =>
        item &&
        typeof item === "object" &&
        ("streetaddress" in item || "total_count" in item) &&
        "name" in item,
    );

    if (directClinics.length > 0) {
      return directClinics as PraktikaClinic[];
    }

    for (const item of parsed) {
      const nested = extractClinicRows(item);

      if (nested.length > 0) {
        return nested;
      }
    }

    return [];
  }

  if (typeof parsed !== "object") {
    return [];
  }

  const object = parsed as ClinicDirectoryResponse;

  if (Array.isArray(object.customer_referral_clinics)) {
    return object.customer_referral_clinics;
  }

  for (const value of Object.values(object)) {
    const nested = extractClinicRows(value);

    if (nested.length > 0) {
      return nested;
    }
  }

  return [];
}

function scoreClinicMatch(
  referralRow: PraktikaReferralRow,
  clinic: PraktikaClinic,
): {
  score: number;
  reasons: string[];
} {
  const reasons: string[] = [];
  let score = 0;

  function add(points: number, reason: string) {
    score += points;
    reasons.push(reason);
  }

  const referralClinicName = normaliseText(referralRow.vchClinic);
  const directoryClinicName = normaliseText(clinic.name);

  const referralStreet = normaliseCompact(referralRow.vchStreetAddress);
  const directoryStreet = normaliseCompact(clinic.streetaddress);

  const referralSuburb = normaliseText(referralRow.vchSuburb);
  const directorySuburb = normaliseText(clinic.suburb);

  const referralPostcode = normalisePostcode(referralRow.vchPostCode);
  const directoryPostcode = normalisePostcode(clinic.postcode);

  const referralEmail = clean(referralRow.vchEmail).toLowerCase();
  const directoryEmail = clean(clinic.email).toLowerCase();

  if (
    referralClinicName &&
    directoryClinicName &&
    referralClinicName === directoryClinicName
  ) {
    add(500, "exact clinic name");
  }

  if (
    referralClinicName &&
    directoryClinicName &&
    (referralClinicName.includes(directoryClinicName) ||
      directoryClinicName.includes(referralClinicName))
  ) {
    add(180, "similar clinic name");
  }

  if (
    referralStreet &&
    directoryStreet &&
    referralStreet === directoryStreet
  ) {
    add(350, "exact street address");
  }

  if (
    referralStreet &&
    directoryStreet &&
    (referralStreet.includes(directoryStreet) ||
      directoryStreet.includes(referralStreet))
  ) {
    add(160, "similar street address");
  }

  if (
    referralSuburb &&
    directorySuburb &&
    referralSuburb === directorySuburb
  ) {
    add(100, "exact suburb");
  }

  if (
    referralPostcode &&
    directoryPostcode &&
    referralPostcode === directoryPostcode
  ) {
    add(120, "exact postcode");
  }

  if (
    referralEmail &&
    directoryEmail &&
    referralEmail === directoryEmail
  ) {
    add(250, "exact email");
  }

  return {
    score,
    reasons,
  };
}

function findClinicForReferralRow(
  referralRow: PraktikaReferralRow,
  clinics: PraktikaClinic[],
): {
  clinic: PraktikaClinic | null;
  score: number;
  reasons: string[];
  alternatives: Array<{
    id: string;
    name: string;
    score: number;
    reasons: string[];
  }>;
} {
  const referralClinicName = normaliseText(referralRow.vchClinic);

  const likelyClinics = referralClinicName
    ? clinics.filter((clinic) => {
        const clinicName = normaliseText(clinic.name);

        return (
          clinicName === referralClinicName ||
          clinicName.includes(referralClinicName) ||
          referralClinicName.includes(clinicName)
        );
      })
    : [];

  const candidates = likelyClinics.length > 0 ? likelyClinics : clinics;

  const scored = candidates
    .map((clinic) => {
      const result = scoreClinicMatch(referralRow, clinic);

      return {
        clinic,
        score: result.score,
        reasons: result.reasons,
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const top = scored[0] || null;
  const second = scored[1] || null;

  /*
    Require a strong match.

    An exact clinic name alone scores 500 and is accepted. If there are
    duplicate clinic names, the address/suburb/postcode/email increases the
    correct row's score.

    Do not save an ID when two candidates remain tied.
  */
  const isStrongEnough = Boolean(top && top.score >= 450);
  const isUnambiguous = Boolean(
    top && (!second || top.score > second.score),
  );

  return {
    clinic: isStrongEnough && isUnambiguous ? top!.clinic : null,
    score: top?.score || 0,
    reasons: top?.reasons || [],
    alternatives: scored.slice(0, 5).map((item) => ({
      id: clean(item.clinic.id),
      name: clean(item.clinic.name),
      score: item.score,
      reasons: item.reasons,
    })),
  };
}

async function fetchReferralReport({
  practiceId,
  mode,
}: {
  practiceId: string;
  mode: PraktikaSessionMode;
}): Promise<PraktikaReferralRow[]> {
  const today = new Date().toISOString().slice(0, 10);

  const parsed = await praktikaHelperPost<unknown>({
    mode,
    jobType: "sync_report_referrers",
    path: "/php/json/db_reportingDataWarehouse.php",
    contentType: "form",
    referer: "https://praktika.praktika.net.au/v2/reports/referrals",
    priority: 30,
    timeoutMs: 300_000,
    body: {
      sReportName: "referrals",
      iPracticeId: practiceId,
      sFromDate: "2000-01-01",
      sToDate: today,
      sMode: "PROVIDER_IN",
    },
  });

  if (!Array.isArray(parsed)) {
    throw new Error(
      "Praktika did not return a valid referrer report array.",
    );
  }

  return parsed as PraktikaReferralRow[];
}

async function fetchClinicPage({
  customerId,
  offset,
  mode,
}: {
  customerId: string;
  offset: number;
  mode: PraktikaSessionMode;
}): Promise<PraktikaClinic[]> {
  const parsed = await praktikaHelperPost<unknown>({
    mode,
    jobType: "sync_report_referrer_clinics",
    path: "/php/forms/db_getFormData.php",
    contentType: "json",
    referer: "https://praktika.praktika.net.au/v2/referrals/clinics",
    priority: 30,
    timeoutMs: 300_000,
    body: {
      parameters: {
        customer_id: Number(customerId),
      },
      fields: [
        {
          customer_referral_clinics: {
            filter: {
              name: "",
            },
            sort_by: "name",
            sort_order: "asc",
            offset,
          },
        },
      ],
    },
  });

  return extractClinicRows(parsed);
}

async function fetchAllClinics({
  customerId,
  mode,
}: {
  customerId: string;
  mode: PraktikaSessionMode;
}): Promise<PraktikaClinic[]> {
  const allClinics: PraktikaClinic[] = [];
  const seenIds = new Set<string>();

  let offset = 0;
  let expectedTotal: number | null = null;

  /*
    Praktika normally returns a paginated clinic list. The endpoint response
    includes total_count on each row.

    The safety limit prevents an accidental infinite request loop.
  */
  for (let page = 0; page < 100; page += 1) {
    const pageRows = await fetchClinicPage({
      customerId,
      offset,
      mode,
    });

    if (pageRows.length === 0) {
      break;
    }

    for (const clinic of pageRows) {
      const id = clean(clinic.id);

      if (!id || seenIds.has(id)) {
        continue;
      }

      seenIds.add(id);
      allClinics.push(clinic);
    }

    if (expectedTotal === null) {
      const firstTotal = Number(pageRows[0]?.total_count);

      if (Number.isFinite(firstTotal) && firstTotal > 0) {
        expectedTotal = firstTotal;
      }
    }

    if (expectedTotal !== null && allClinics.length >= expectedTotal) {
      break;
    }

    /*
      Some Praktika screens use row offsets. Advancing by the number returned
      supports variable page sizes.
    */
    offset += pageRows.length;
  }

  return allClinics;
}

async function importReferrerRows({
  referralRows,
  clinics,
}: {
  referralRows: PraktikaReferralRow[];
  clinics: PraktikaClinic[];
}) {
  const now = new Date().toISOString();

  const referrerMap = new Map<string, ReferrerImportRow>();

  const clinicMatchDebug: Array<{
    provider: string;
    clinicName: string;
    matchedClinicId: string | null;
    matchedClinicName: string | null;
    score: number;
    reasons: string[];
    alternatives: Array<{
      id: string;
      name: string;
      score: number;
      reasons: string[];
    }>;
  }> = [];

  for (const row of referralRows) {
    const name = clean(row.vchProvider);
    const practiceName = clean(row.vchClinic);
    const address = buildReferralAddress(row);
    const email = cleanEmail(row.vchEmail);
    const praktikaKey = buildPraktikaKey(row);

    if (!name || !praktikaKey) {
      continue;
    }

    const clinicMatch = findClinicForReferralRow(row, clinics);
    const matchedClinic = clinicMatch.clinic;

    const praktikaClinicId = clean(matchedClinic?.id) || null;

    referrerMap.set(praktikaKey, {
      praktika_referrer_key: praktikaKey,
      praktika_clinic_id: praktikaClinicId,
      name,
      practice_name: practiceName || null,
      address: address || null,
      email,
      is_active: true,
      raw_json: {
        ...row,
        praktika_clinic_match: matchedClinic
          ? {
              id: clean(matchedClinic.id),
              name: clean(matchedClinic.name),
              address: buildClinicAddress(matchedClinic),
              score: clinicMatch.score,
              reasons: clinicMatch.reasons,
              raw_json: matchedClinic,
            }
          : null,
      },
      synced_at: now,
      updated_at: now,
    });

    /*
      Keep debug output focused on uncertain rows plus Dr Huy Tran while
      testing.
    */
    if (
      !praktikaClinicId ||
      normaliseText(name).includes("huy tran")
    ) {
      clinicMatchDebug.push({
        provider: name,
        clinicName: practiceName,
        matchedClinicId: praktikaClinicId,
        matchedClinicName: matchedClinic
          ? clean(matchedClinic.name)
          : null,
        score: clinicMatch.score,
        reasons: clinicMatch.reasons,
        alternatives: clinicMatch.alternatives,
      });
    }
  }

  const rowsToUpsert = Array.from(referrerMap.values());

  if (rowsToUpsert.length > 0) {
    const { error } = await supabase
      .from("report_referrers")
      .upsert(rowsToUpsert, {
        onConflict: "praktika_referrer_key",
        ignoreDuplicates: false,
      });

    if (error) {
      throw new Error(
        `Could not import Praktika referrers: ${error.message}`,
      );
    }
  }

  return {
    imported: rowsToUpsert.length,
    skipped: referralRows.length - rowsToUpsert.length,
    rowsWithClinicId: rowsToUpsert.filter(
      (row) => Boolean(row.praktika_clinic_id),
    ).length,
    rowsWithoutClinicId: rowsToUpsert.filter(
      (row) => !row.praktika_clinic_id,
    ).length,
    clinicMatchDebug,
  };
}

export async function POST() {
  try {
    const mode = await getCurrentUserPraktikaSessionMode();

    const practiceId =
      clean(process.env.PRAKTIKA_PRACTICE_ID) || "1181";

    const customerId =
      clean(process.env.PRAKTIKA_CUSTOMER_ID) || "480";

    console.log("PRAKTIKA REFERRER SYNC: starting", {
      practiceId,
      customerId,
      mode,
    });

    const [referralRows, clinics] = await Promise.all([
      fetchReferralReport({
        practiceId,
        mode,
      }),
      fetchAllClinics({
        customerId,
        mode,
      }),
    ]);

    console.log("PRAKTIKA REFERRER SYNC: source rows loaded", {
      referralRows: referralRows.length,
      clinics: clinics.length,
    });

    if (clinics.length === 0) {
      throw new Error(
        "Praktika returned no referral clinics. Referrer records were not changed because clinic IDs could not be matched safely.",
      );
    }

    const result = await importReferrerRows({
      referralRows,
      clinics,
    });

    console.log(
      "PRAKTIKA REFERRER SYNC: Dr Huy Tran clinic matches",
      JSON.stringify(
        result.clinicMatchDebug.filter((item) =>
          normaliseText(item.provider).includes("huy tran"),
        ),
        null,
        2,
      ),
    );

    console.log("PRAKTIKA REFERRER SYNC: completed", {
      imported: result.imported,
      skipped: result.skipped,
      rowsWithClinicId: result.rowsWithClinicId,
      rowsWithoutClinicId: result.rowsWithoutClinicId,
    });

    return NextResponse.json({
      success: true,
      imported: result.imported,
      skipped: result.skipped,
      totalReferralRows: referralRows.length,
      totalClinics: clinics.length,
      rowsWithClinicId: result.rowsWithClinicId,
      rowsWithoutClinicId: result.rowsWithoutClinicId,
      debug: {
        clinicMatches: result.clinicMatchDebug.slice(0, 100),
      },
    });
  } catch (error) {
    console.error("Praktika referrer sync failed:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to sync Praktika referrers.",
      },
      { status: 500 },
    );
  }
}