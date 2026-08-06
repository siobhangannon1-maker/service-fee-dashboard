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

type PraktikaProvider = {
  iProviderId?: string | number | null;
  id?: string | number | null;
  vchName?: string | null;
  name?: string | null;
  vchTitle?: string | null;
  title?: string | null;
  vchFirstName?: string | null;
  firstName?: string | null;
  vchLastName?: string | null;
  lastName?: string | null;
  vchOccupation?: string | null;
  occupation?: string | null;
  vchPhone?: string | null;
  phone?: string | null;
  vchFax?: string | null;
  fax?: string | null;
  vchEmail?: string | null;
  email?: string | null;
  bDeleted?: string | boolean | null;
  [key: string]: unknown;
};

type PraktikaClinic = {
  iClinicId?: string | number | null;
  id?: string | number | null;
  vchName?: string | null;
  name?: string | null;
  vchStreetAddress?: string | null;
  streetaddress?: string | null;
  vchSuburb?: string | null;
  suburb?: string | null;
  vchPostCode?: string | null;
  postcode?: string | null;
  vchState?: string | null;
  state?: string | null;
  vchPhone?: string | null;
  phone?: string | null;
  vchFax?: string | null;
  fax?: string | null;
  vchEmail?: string | null;
  email?: string | null;
  vchWebSite?: string | null;
  website?: string | null;
  vchNote?: string | null;
  notes?: string | null;
  bDeleted?: string | boolean | null;
  [key: string]: unknown;
};

type PraktikaParty = {
  iPartyId?: string | number | null;
  id?: string | number | null;
  iProviderId?: string | number | null;
  provider_id?: string | number | null;
  iClinicId?: string | number | null;
  clinic_id?: string | number | null;
  bDeleted?: string | boolean | null;
  [key: string]: unknown;
};

type ReferringPartiesResponse = {
  providers?: PraktikaProvider[];
  clinics?: PraktikaClinic[];
  parties?: PraktikaParty[];
  [key: string]: unknown;
};

type ExistingReferrer = {
  id: string;
  praktika_referrer_key: string | null;
  praktika_provider_id: string | null;
  praktika_clinic_id: string | null;
  praktika_party_id: string | null;
  name: string | null;
  practice_name: string | null;
};

type ReferrerImportRow = {
  praktika_referrer_key: string;
  praktika_provider_id: string;
  praktika_clinic_id: string | null;
  praktika_party_id: string | null;
  name: string;
  practice_name: string | null;
  address: string | null;
  phone: string | null;
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

function isDeleted(value: unknown): boolean {
  if (value === true) return true;

  const text = clean(value).toLowerCase();
  return ["t", "true", "1", "yes", "y"].includes(text);
}

function getProviderId(provider: PraktikaProvider): string {
  return clean(provider.iProviderId ?? provider.id);
}

function getProviderName(provider: PraktikaProvider): string {
  const directName = clean(provider.vchName ?? provider.name);

  if (directName) return directName;

  return [
    clean(provider.vchTitle ?? provider.title),
    clean(provider.vchFirstName ?? provider.firstName),
    clean(provider.vchLastName ?? provider.lastName),
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function getProviderEmail(provider: PraktikaProvider): string | null {
  return cleanEmail(provider.vchEmail ?? provider.email);
}

function getProviderPhone(provider: PraktikaProvider): string | null {
  return clean(provider.vchPhone ?? provider.phone) || null;
}

function getClinicId(clinic: PraktikaClinic): string {
  return clean(clinic.iClinicId ?? clinic.id);
}

function getClinicName(clinic: PraktikaClinic | null): string {
  if (!clinic) return "";
  return clean(clinic.vchName ?? clinic.name);
}

function getClinicEmail(clinic: PraktikaClinic | null): string | null {
  if (!clinic) return null;
  return cleanEmail(clinic.vchEmail ?? clinic.email);
}

function getClinicPhone(clinic: PraktikaClinic | null): string | null {
  if (!clinic) return null;
  return clean(clinic.vchPhone ?? clinic.phone) || null;
}

function buildClinicAddress(clinic: PraktikaClinic | null): string {
  if (!clinic) return "";

  const street = clean(clinic.vchStreetAddress ?? clinic.streetaddress);
  const suburb = clean(clinic.vchSuburb ?? clinic.suburb);
  const state = clean(clinic.vchState ?? clinic.state);
  const postcode = clean(clinic.vchPostCode ?? clinic.postcode);

  const suburbLine = [suburb, state, postcode].filter(Boolean).join(" ");

  return [street, suburbLine].filter(Boolean).join("\n");
}

function getPartyId(party: PraktikaParty): string {
  return clean(party.iPartyId ?? party.id);
}

function getPartyProviderId(party: PraktikaParty): string {
  return clean(party.iProviderId ?? party.provider_id);
}

function getPartyClinicId(party: PraktikaParty): string {
  return clean(party.iClinicId ?? party.clinic_id);
}

function buildActivityKey(providerName: unknown, clinicName: unknown): string {
  return `${normaliseText(providerName)}|${normaliseText(clinicName)}`;
}

function buildExistingNameKey(name: unknown, practiceName: unknown): string {
  return `${normaliseText(name)}|${normaliseText(practiceName)}`;
}

function buildStableReferrerKey({
  providerId,
  clinicId,
  partyId,
}: {
  providerId: string;
  clinicId: string | null;
  partyId: string | null;
}) {
  return [
    `provider:${providerId}`,
    `clinic:${clinicId || "none"}`,
    `party:${partyId || "none"}`,
  ].join("|");
}

function extractReferringPartiesResponse(parsed: unknown): ReferringPartiesResponse {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      "Praktika did not return a valid referring parties response object.",
    );
  }

  const response = parsed as ReferringPartiesResponse;

  if (
    !Array.isArray(response.providers) ||
    !Array.isArray(response.clinics) ||
    !Array.isArray(response.parties)
  ) {
    throw new Error(
      "Praktika referring parties response did not include providers, clinics and parties arrays.",
    );
  }

  return response;
}

async function fetchReferringParties({
  customerId,
  practiceId,
  mode,
}: {
  customerId: string;
  practiceId: string;
  mode: PraktikaSessionMode;
}): Promise<ReferringPartiesResponse> {
  const parsed = await praktikaHelperPost<unknown>({
    mode,
    jobType: "sync_report_referring_parties",
    path: "/php/json/db_getCustomerReferringParties.php",
    contentType: "form",
    referer: "https://praktika.praktika.net.au/v2/referrals/providers",
    priority: 30,
    timeoutMs: 300_000,
    body: {
      iCustomerId: customerId,
      iPracticeId: practiceId,
    },
  });

  return extractReferringPartiesResponse(parsed);
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
    console.warn(
      "PRAKTIKA REFERRER SYNC: referral activity report was not an array. Continuing without activity enrichment.",
    );
    return [];
  }

  return parsed as PraktikaReferralRow[];
}

async function loadExistingReferrers(): Promise<ExistingReferrer[]> {
  const { data, error } = await supabase
    .from("report_referrers")
    .select(
      "id, praktika_referrer_key, praktika_provider_id, praktika_clinic_id, praktika_party_id, name, practice_name",
    );

  if (error) {
    throw new Error(`Could not load existing referrers: ${error.message}`);
  }

  return (data || []) as ExistingReferrer[];
}

function chooseReferrerKey({
  providerId,
  clinicId,
  partyId,
  providerName,
  clinicName,
  existingByIds,
  existingByName,
}: {
  providerId: string;
  clinicId: string | null;
  partyId: string | null;
  providerName: string;
  clinicName: string;
  existingByIds: Map<string, ExistingReferrer>;
  existingByName: Map<string, ExistingReferrer>;
}): string {
  const idKey = `${providerId}|${clinicId || ""}`;
  const existingIdMatch = existingByIds.get(idKey);

  if (existingIdMatch?.praktika_referrer_key) {
    return existingIdMatch.praktika_referrer_key;
  }

  const nameKey = buildExistingNameKey(providerName, clinicName);
  const existingNameMatch = existingByName.get(nameKey);

  if (existingNameMatch?.praktika_referrer_key) {
    return existingNameMatch.praktika_referrer_key;
  }

  return buildStableReferrerKey({
    providerId,
    clinicId,
    partyId,
  });
}

async function importReferringDirectory({
  providers,
  clinics,
  parties,
  referralRows,
}: {
  providers: PraktikaProvider[];
  clinics: PraktikaClinic[];
  parties: PraktikaParty[];
  referralRows: PraktikaReferralRow[];
}) {
  const now = new Date().toISOString();
  const existingReferrers = await loadExistingReferrers();

  const clinicById = new Map<string, PraktikaClinic>();

  for (const clinic of clinics) {
    const clinicId = getClinicId(clinic);

    if (!clinicId || isDeleted(clinic.bDeleted)) continue;
    clinicById.set(clinicId, clinic);
  }

  const partiesByProviderId = new Map<string, PraktikaParty[]>();

  for (const party of parties) {
    const providerId = getPartyProviderId(party);

    if (!providerId || isDeleted(party.bDeleted)) continue;

    const current = partiesByProviderId.get(providerId) || [];
    current.push(party);
    partiesByProviderId.set(providerId, current);
  }

  const activityByProviderAndClinic = new Map<string, PraktikaReferralRow>();
  const activityByProvider = new Map<string, PraktikaReferralRow>();

  for (const row of referralRows) {
    const providerName = clean(row.vchProvider);
    const clinicName = clean(row.vchClinic);

    if (!providerName) continue;

    activityByProviderAndClinic.set(
      buildActivityKey(providerName, clinicName),
      row,
    );

    const providerKey = normaliseText(providerName);

    if (!activityByProvider.has(providerKey)) {
      activityByProvider.set(providerKey, row);
    }
  }

  const existingByIds = new Map<string, ExistingReferrer>();
  const existingByName = new Map<string, ExistingReferrer>();

  for (const existing of existingReferrers) {
    const providerId = clean(existing.praktika_provider_id);
    const clinicId = clean(existing.praktika_clinic_id);

    if (providerId) {
      existingByIds.set(`${providerId}|${clinicId}`, existing);
    }

    const nameKey = buildExistingNameKey(
      existing.name,
      existing.practice_name,
    );

    if (nameKey !== "|") {
      existingByName.set(nameKey, existing);
    }
  }

  const rowsToUpsert: ReferrerImportRow[] = [];
  const seenImportKeys = new Set<string>();
  const providersWithoutParty: string[] = [];
  const partiesWithoutClinic: Array<{
    providerId: string;
    providerName: string;
    partyId: string;
    clinicId: string;
  }> = [];

  for (const provider of providers) {
    const providerId = getProviderId(provider);
    const providerName = getProviderName(provider);

    if (!providerId || !providerName || isDeleted(provider.bDeleted)) {
      continue;
    }

    const providerParties = partiesByProviderId.get(providerId) || [];

    const associations =
      providerParties.length > 0
        ? providerParties.map((party) => ({
            party,
            clinic: clinicById.get(getPartyClinicId(party)) || null,
          }))
        : [{ party: null, clinic: null }];

    if (providerParties.length === 0) {
      providersWithoutParty.push(providerName);
    }

    for (const association of associations) {
      const party = association.party;
      const clinic = association.clinic;

      const partyId = party ? getPartyId(party) || null : null;
      const clinicIdFromParty = party ? getPartyClinicId(party) : "";
      const clinicId = getClinicId(clinic || {}) || clinicIdFromParty || null;
      const clinicName = getClinicName(clinic);

      if (party && clinicIdFromParty && !clinic) {
        partiesWithoutClinic.push({
          providerId,
          providerName,
          partyId: partyId || "",
          clinicId: clinicIdFromParty,
        });
      }

      const activity =
        activityByProviderAndClinic.get(
          buildActivityKey(providerName, clinicName),
        ) || activityByProvider.get(normaliseText(providerName));

      const providerEmail = getProviderEmail(provider);
      const clinicEmail = getClinicEmail(clinic);
      const activityEmail = cleanEmail(activity?.vchEmail);

      const providerPhone = getProviderPhone(provider);
      const clinicPhone = getClinicPhone(clinic);

      const practiceName = clinicName || clean(activity?.vchClinic) || null;
      const clinicAddress = buildClinicAddress(clinic);
      const activityAddress = activity
        ? [
            clean(activity.vchStreetAddress),
            [
              clean(activity.vchSuburb),
              clean(activity.vchState),
              clean(activity.vchPostCode),
            ]
              .filter(Boolean)
              .join(" "),
          ]
            .filter(Boolean)
            .join("\n")
        : "";

      const praktikaReferrerKey = chooseReferrerKey({
        providerId,
        clinicId,
        partyId,
        providerName,
        clinicName: practiceName || "",
        existingByIds,
        existingByName,
      });

      if (seenImportKeys.has(praktikaReferrerKey)) {
        continue;
      }

      seenImportKeys.add(praktikaReferrerKey);

      rowsToUpsert.push({
        praktika_referrer_key: praktikaReferrerKey,
        praktika_provider_id: providerId,
        praktika_clinic_id: clinicId,
        praktika_party_id: partyId,
        name: providerName,
        practice_name: practiceName,
        address: clinicAddress || activityAddress || null,
        phone: providerPhone || clinicPhone || null,
        email: providerEmail || clinicEmail || activityEmail || null,
        is_active: true,
        raw_json: {
          sync_source: "praktika_referring_parties_directory",
          provider,
          party,
          clinic,
          referral_activity: activity || null,
        },
        synced_at: now,
        updated_at: now,
      });
    }
  }

  if (rowsToUpsert.length === 0) {
    throw new Error(
      "Praktika returned no valid referring providers to import.",
    );
  }

  const batchSize = 500;

  for (let index = 0; index < rowsToUpsert.length; index += batchSize) {
    const batch = rowsToUpsert.slice(index, index + batchSize);

    const { error } = await supabase
      .from("report_referrers")
      .upsert(batch, {
        onConflict: "praktika_referrer_key",
        ignoreDuplicates: false,
      });

    if (error) {
      throw new Error(
        `Could not import Praktika referrers: ${error.message}`,
      );
    }
  }

  const jimChuangRows = rowsToUpsert.filter((row) =>
    normaliseText(row.name).includes("jim chuang"),
  );

  return {
    imported: rowsToUpsert.length,
    providersWithoutParty,
    partiesWithoutClinic,
    jimChuangRows,
  };
}

export async function POST() {
  try {
    const mode = await getCurrentUserPraktikaSessionMode();

    const practiceId = clean(process.env.PRAKTIKA_PRACTICE_ID) || "1181";
    const customerId = clean(process.env.PRAKTIKA_CUSTOMER_ID) || "480";

    console.log("PRAKTIKA REFERRER SYNC: starting", {
      practiceId,
      customerId,
      mode,
    });

    const [directory, referralRows] = await Promise.all([
      fetchReferringParties({
        customerId,
        practiceId,
        mode,
      }),
      fetchReferralReport({
        practiceId,
        mode,
      }).catch((error) => {
        console.warn(
          "PRAKTIKA REFERRER SYNC: referral activity enrichment failed. Continuing with directory sync.",
          error,
        );
        return [] as PraktikaReferralRow[];
      }),
    ]);

    console.log("PRAKTIKA REFERRER SYNC: source rows loaded", {
      providers: directory.providers?.length || 0,
      clinics: directory.clinics?.length || 0,
      parties: directory.parties?.length || 0,
      referralRows: referralRows.length,
    });

    const result = await importReferringDirectory({
      providers: directory.providers || [],
      clinics: directory.clinics || [],
      parties: directory.parties || [],
      referralRows,
    });

    console.log("PRAKTIKA REFERRER SYNC: Jim Chuang rows", result.jimChuangRows);

    console.log("PRAKTIKA REFERRER SYNC: completed", {
      imported: result.imported,
      providersWithoutParty: result.providersWithoutParty.length,
      partiesWithoutClinic: result.partiesWithoutClinic.length,
    });

    return NextResponse.json({
      success: true,
      imported: result.imported,
      totalProviders: directory.providers?.length || 0,
      totalClinics: directory.clinics?.length || 0,
      totalParties: directory.parties?.length || 0,
      totalReferralRows: referralRows.length,
      providersWithoutParty: result.providersWithoutParty.length,
      partiesWithoutClinic: result.partiesWithoutClinic.length,
      debug: {
        jimChuang: result.jimChuangRows,
        providerNamesWithoutParty: result.providersWithoutParty.slice(0, 50),
        partiesWithoutClinic: result.partiesWithoutClinic.slice(0, 50),
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