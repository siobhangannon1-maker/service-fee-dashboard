import { supabaseAdmin } from "@/lib/supabase/admin";
import { getPraktikaCookie } from "@/lib/praktika/hybrid-session-store";
import { withPraktikaAutoRefresh } from "@/lib/praktika/hybrid-seamless-request";

const PRAKTIKA_BASE_URL = "https://praktika.praktika.net.au";
const PRAKTIKA_GET_FORM_DATA_URL = `${PRAKTIKA_BASE_URL}/php/forms/db_getFormData.php`;
const DEFAULT_CUSTOMER_ID = Number(process.env.PRAKTIKA_CUSTOMER_ID || 480);
const PRACTICE_MODE = { scope: "practice" as const };

type ReferrerCandidate = {
  partyId: number;
  providerId: number | null;
  clinicId: number | null;
  displayName: string;
  providerTitle: string | null;
  providerFirstName: string | null;
  providerLastName: string | null;
  providerName: string | null;
  providerNumber: string | null;
  clinicName: string | null;
  score: number;
  reason: string;
  raw: any;
};

function clean(value: any) {
  return String(value || "").trim();
}

function normalise(value: any) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normaliseProviderNumber(value: any) {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function splitName(value: any) {
  const text = clean(value).replace(/^dr\s+/i, "");
  const parts = text.split(/\s+/).filter(Boolean);

  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };

  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1],
  };
}

function looksLikeLoginOrHtml(text: string) {
  const lower = text.trim().toLowerCase();

  return (
    lower.startsWith("<!doctype") ||
    lower.startsWith("<html") ||
    lower.includes("/v2/login") ||
    lower.includes('type="password"') ||
    lower.includes("logged-out") ||
    lower.includes("logged out")
  );
}

function parseParty(row: any): ReferrerCandidate {
  const displayName = clean(row.name);
  const providerNumber = clean(row.vchProviderNo);
  const providerName = clean(row.vchProviderName);
  const inferredClinic = displayName.includes(" @ ")
    ? displayName.split(" @ ").slice(1).join(" @ ").trim()
    : null;

  const split = splitName(providerName || displayName.split("#")[0]);

  return {
    partyId: Number(row.id),
    providerId: row.iProviderId ? Number(row.iProviderId) : null,
    clinicId: row.iClinicId ? Number(row.iClinicId) : null,
    displayName,
    providerTitle: providerName.toLowerCase().startsWith("dr ") ? "Dr" : null,
    providerFirstName: clean(row.vchFirstName) || split.firstName || null,
    providerLastName: split.lastName || null,
    providerName: providerName || null,
    providerNumber: providerNumber || null,
    clinicName: inferredClinic,
    score: 0,
    reason: "",
    raw: row,
  };
}

function extractReferrerSearchFromItem(item: any) {
  const party = item.correspondence_party_extraction || {};

  const providerName = clean(
    item.extracted_referrer_name ||
      item.correspondence_author_name ||
      party.detected_author ||
      "",
  );

  const split = splitName(providerName);

  const firstName = clean(item.extracted_referrer_first_name || split.firstName);
  const lastName = clean(item.extracted_referrer_last_name || split.lastName);

  const providerNumber = clean(item.extracted_referrer_provider_number);

  const practiceName = clean(
    item.extracted_referrer_practice ||
      party.organisation_name ||
      "",
  );

  return {
    providerName,
    firstName,
    lastName,
    providerNumber,
    practiceName,
  };
}

async function praktikaGetReferralParties(searchText: string) {
  return withPraktikaAutoRefresh(
    async () => {
      const cookie = await getPraktikaCookie(PRACTICE_MODE);

      const payload = {
        parameters: { customer_id: DEFAULT_CUSTOMER_ID },
        fields: [
          {
            customer_referral_parties: {
              filter: { name: searchText },
              sort_by: "name",
              sort_order: "asc",
              offset: 0,
            },
          },
        ],
      };

      const response = await fetch(PRAKTIKA_GET_FORM_DATA_URL, {
        method: "POST",
        headers: {
          Accept: "application/json, text/plain, */*",
          "Content-Type": "application/json",
          Origin: PRAKTIKA_BASE_URL,
          Referer: `${PRAKTIKA_BASE_URL}/v2/referrals/clinics`,
          Cookie: cookie,
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify(payload),
        cache: "no-store",
      });

      const text = await response.text();

      if (looksLikeLoginOrHtml(text)) {
        throw new Error("Praktika session expired or returned a login page.");
      }

      let json: any;

      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(
          `Praktika returned non-JSON referrer response: ${text.slice(0, 300)}`,
        );
      }

      if (!response.ok) {
        throw new Error(
          json?.error ||
            json?.message ||
            `Praktika referrer search failed (${response.status}).`,
        );
      }

      return Array.isArray(json.customer_referral_parties)
        ? json.customer_referral_parties
            .map(parseParty)
            .filter((party: ReferrerCandidate) => party.partyId)
        : [];
    },
    {
      mode: PRACTICE_MODE,
    },
  );
}

function scoreCandidate(
  candidate: ReferrerCandidate,
  search: {
    providerNumber?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    providerName?: string | null;
    practiceName?: string | null;
  },
) {
  const searchedProviderNumber = normaliseProviderNumber(search.providerNumber);
  const candidateProviderNumber = normaliseProviderNumber(candidate.providerNumber);

  const searchedFirst = normalise(
    search.firstName || splitName(search.providerName).firstName,
  );
  const searchedLast = normalise(
    search.lastName || splitName(search.providerName).lastName,
  );
  const searchedProviderName = normalise(search.providerName);
  const searchedPractice = normalise(search.practiceName);

  const candidateProviderName = normalise(candidate.providerName);
  const candidateFirst = normalise(candidate.providerFirstName);
  const candidateLast = normalise(candidate.providerLastName);
  const candidateClinic = normalise(candidate.clinicName || candidate.displayName);

  let score = 0;
  const reasons: string[] = [];

  if (
    searchedProviderNumber &&
    candidateProviderNumber &&
    searchedProviderNumber === candidateProviderNumber
  ) {
    score += 100;
    reasons.push("provider number exact match");
  }

  if (searchedFirst && candidateFirst && searchedFirst === candidateFirst) {
    score += 20;
    reasons.push("first name match");
  }

  if (searchedLast && candidateLast && searchedLast === candidateLast) {
    score += 35;
    reasons.push("last name match");
  }

  if (
    searchedProviderName &&
    candidateProviderName &&
    candidateProviderName.includes(searchedProviderName)
  ) {
    score += 35;
    reasons.push("provider name match");
  }

  if (searchedPractice && candidateClinic && candidateClinic.includes(searchedPractice)) {
    score += 40;
    reasons.push("practice/location match");
  }

  if (!searchedProviderNumber && score >= 55 && !searchedPractice) {
    score = Math.min(score, 80);
    reasons.push("name-only match capped for safety");
  }

  return {
    ...candidate,
    score,
    reason: reasons.join(", ") || "low confidence candidate",
  };
}

async function cacheCandidates(candidates: ReferrerCandidate[]) {
  if (candidates.length === 0) return;

  const rows = candidates.map((candidate) => ({
    party_id: candidate.partyId,
    provider_id: candidate.providerId,
    clinic_id: candidate.clinicId,
    display_name: candidate.displayName,
    provider_title: candidate.providerTitle,
    provider_first_name: candidate.providerFirstName,
    provider_last_name: candidate.providerLastName,
    provider_name: candidate.providerName,
    provider_number: candidate.providerNumber,
    clinic_name: candidate.clinicName,
    raw: candidate.raw,
    last_seen_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabaseAdmin
    .from("praktika_referrer_search_cache")
    .upsert(rows, { onConflict: "party_id" });

  if (error) console.error("Failed to cache Praktika referrers:", error);
}

export async function searchPraktikaReferrers({
  providerName,
  firstName,
  lastName,
  providerNumber,
  practiceName,
}: {
  providerName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  providerNumber?: string | null;
  practiceName?: string | null;
}) {
  const cleanSearch = {
    providerName: clean(providerName),
    firstName: clean(firstName),
    lastName: clean(lastName),
    providerNumber: clean(providerNumber),
    practiceName: clean(practiceName),
  };

  const queries = Array.from(
    new Set(
      [
        cleanSearch.providerNumber,
        cleanSearch.providerName,
        [cleanSearch.firstName, cleanSearch.lastName].filter(Boolean).join(" "),
        cleanSearch.lastName,
        cleanSearch.practiceName,
      ].filter(Boolean),
    ),
  );

  if (queries.length === 0) {
    return {
      ok: true,
      safe: false,
      topCandidate: null,
      candidates: [],
      searched: cleanSearch,
    };
  }

  const all: ReferrerCandidate[] = [];

  for (const query of queries) {
    const candidates = await praktikaGetReferralParties(query);
    all.push(...candidates);
  }

  const byPartyId = new Map<number, ReferrerCandidate>();
  for (const candidate of all) {
    byPartyId.set(candidate.partyId, candidate);
  }

  const scored = Array.from(byPartyId.values())
    .map((candidate) => scoreCandidate(candidate, cleanSearch))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  await cacheCandidates(scored);

  const top = scored[0] || null;

  const safe = Boolean(
    top &&
      (top.score >= 100 || (top.score >= 95 && Boolean(cleanSearch.practiceName))) &&
      !(scored[1] && scored[1].score === top.score),
  );

  return {
    ok: true,
    safe,
    topCandidate: top,
    candidates: scored,
    searched: cleanSearch,
  };
}

export async function previewReferrerMatchForInboxItem({
  inboxItemId,
}: {
  inboxItemId: string;
}) {
  const { data: item, error } = await supabaseAdmin
    .from("ai_inbox_items")
    .select("*")
    .eq("id", inboxItemId)
    .single();

  if (error || !item) {
    throw new Error(error?.message || "Inbox item not found.");
  }

  const search = extractReferrerSearchFromItem(item);
  const result = await searchPraktikaReferrers(search);

  const top = result.topCandidate;
  const now = new Date().toISOString();

  const updatePayload = {
    praktika_referrer_match_status: result.safe
      ? "safe_match"
      : top
        ? "possible_match"
        : "no_match",
    praktika_referrer_match_confidence: top ? top.score / 100 : 0,
    praktika_referrer_party_id: result.safe && top ? top.partyId : null,
    praktika_referrer_provider_id: result.safe && top ? top.providerId : null,
    praktika_referrer_clinic_id: result.safe && top ? top.clinicId : null,
    praktika_referrer_provider_number:
      result.safe && top ? top.providerNumber : null,
    praktika_referrer_match_reason: top
      ? top.reason
      : "No referrer candidates found.",
    praktika_referrer_candidates: result.candidates,
    praktika_referrer_matched_at: now,
  };

  const { data: updatedItem, error: updateError } = await supabaseAdmin
    .from("ai_inbox_items")
    .update(updatePayload)
    .eq("id", inboxItemId)
    .select("*")
    .single();

  if (updateError) {
    throw new Error(updateError.message);
  }

  return {
    ...result,
    item: updatedItem,
  };
}
