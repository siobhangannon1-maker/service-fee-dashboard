"use client";

import { useEffect, useMemo, useState } from "react";

type InboxItem = {
  id: string;
  praktika_patient_id?: string | null;
  praktika_referral_id?: string | number | null;
  extracted_referrer_name?: string | null;
  extracted_referrer_provider_number?: string | null;
  extracted_referrer_practice?: string | null;
  correspondence_author_name?: string | null;
  correspondence_party_extraction?: any;
  praktika_referrer_party_id?: number | string | null;
  praktika_matched_referrer_party_id?: number | string | null;
  referrer_party_id?: number | string | null;
  praktika_referral_party_id?: number | string | null;
  praktika_referrer_match_reason?: string | null;
  praktika_referrer_provider_number?: string | null;
  praktika_referrer_candidates?: any[] | null;
};

function getCandidatePartyId(candidate: any) {
  const value =
    candidate?.partyId ??
    candidate?.party_id ??
    candidate?.id ??
    candidate?.praktika_referrer_party_id ??
    null;

  return value === null || value === undefined ? "" : String(value);
}

function getConfirmedReferrerPartyId(inboxItem: InboxItem) {
  const value =
    inboxItem.praktika_referrer_party_id ||
    inboxItem.praktika_matched_referrer_party_id ||
    inboxItem.referrer_party_id ||
    inboxItem.praktika_referral_party_id ||
    null;

  return value === null || value === undefined ? "" : String(value);
}

export default function PraktikaReferrerMatchPanel({
  inboxItem,
  onUpdated,
}: {
  inboxItem: InboxItem;
  onUpdated?: (item?: any) => void | Promise<void>;
}) {
  const initialCandidates = useMemo(() => {
    return Array.isArray(inboxItem.praktika_referrer_candidates)
      ? inboxItem.praktika_referrer_candidates
      : [];
  }, [inboxItem.id, inboxItem.praktika_referrer_candidates]);

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [candidates, setCandidates] = useState<any[]>(initialCandidates);
  const [selectedPartyId, setSelectedPartyId] = useState(
    getConfirmedReferrerPartyId(inboxItem),
  );
  const [selectedDisplayName, setSelectedDisplayName] = useState("");

  useEffect(() => {
    const confirmedPartyId = getConfirmedReferrerPartyId(inboxItem);

    setCandidates(initialCandidates);
    setSelectedPartyId(confirmedPartyId);
    setSelectedDisplayName("");
    setMessage("");
    setBusy(false);
  }, [
    inboxItem.id,
    inboxItem.praktika_referrer_party_id,
    inboxItem.praktika_matched_referrer_party_id,
    inboxItem.referrer_party_id,
    inboxItem.praktika_referral_party_id,
    initialCandidates,
  ]);

  const selectedCandidate = candidates.find(
    (candidate) => getCandidatePartyId(candidate) === selectedPartyId,
  );

  const selectedLabel =
    selectedDisplayName ||
    selectedCandidate?.displayName ||
    inboxItem.praktika_referrer_match_reason ||
    (selectedPartyId ? `Party ID ${selectedPartyId}` : "");

  async function search() {
    setBusy(true);
    setMessage("Searching Praktika referrers...");

    try {
      const response = await fetch("/api/praktika/referrers/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({
          inboxItemId: inboxItem.id,
          forceRefresh: true,
        }),
      });

      const result = await response.json().catch(() => null);

      if (!response.ok || !result?.ok) {
        throw new Error(result?.error || "Referrer search failed.");
      }

      setCandidates(result.candidates || []);

      if (result.item) {
        await onUpdated?.(result.item);
      }

      setMessage(
        result.safe
          ? "Safe referrer match found."
          : "Review possible referrer matches.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Referrer search failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function selectReferrer(candidate: any) {
    const partyId = getCandidatePartyId(candidate);

    if (!partyId) {
      setMessage("This candidate does not have a valid party ID.");
      return;
    }

    setBusy(true);
    setMessage("Saving selected referrer...");

    try {
      const response = await fetch("/api/praktika/referrers/select", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({
          inboxItemId: inboxItem.id,
          partyId,
          providerNumber: candidate.providerNumber || null,
          displayName: candidate.displayName || null,
          clinicName: candidate.clinicName || null,
        }),
      });

      const result = await response.json().catch(() => null);

      if (!response.ok || !result?.ok) {
        throw new Error(result?.error || "Failed to select referrer.");
      }

      setSelectedPartyId(partyId);
      setSelectedDisplayName(candidate.displayName || "");
      setMessage(
        `Referrer selected: ${candidate.displayName || `Party ID ${partyId}`}`,
      );

      await onUpdated?.(result.item);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Failed to select referrer.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (inboxItem.praktika_referral_id) {
    return null;
  }

  return (
    <section className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-indigo-950">
      <h3 className="text-sm font-bold">Praktika referrer match</h3>

      <p className="mt-1 text-xs text-indigo-800">
        Searches Praktika referral parties. Provider number matches are safest.
      </p>

      <div className="mt-3 text-xs text-indigo-900">
        <div>
          Detected referrer:{" "}
          {inboxItem.extracted_referrer_name ||
            inboxItem.correspondence_author_name ||
            "Unknown"}
        </div>

        <div>
          Provider number:{" "}
          {inboxItem.extracted_referrer_provider_number || "Unknown"}
        </div>

        <div>
          Practice:{" "}
          {inboxItem.extracted_referrer_practice ||
            inboxItem.correspondence_party_extraction?.organisation_name ||
            "Unknown"}
        </div>
      </div>

      {selectedPartyId ? (
        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
          <div className="font-bold">Selected referrer</div>
          <div className="mt-1">{selectedLabel}</div>
          <div className="mt-1">Party ID: {selectedPartyId}</div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={search}
        disabled={busy}
        className="mt-4 rounded-xl bg-indigo-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? "Searching..." : "Search Praktika referrer"}
      </button>

      {candidates.length > 0 ? (
        <div className="mt-4 space-y-3">
          {candidates.map((candidate) => {
            const partyId = getCandidatePartyId(candidate);
            const isSelected = Boolean(
              selectedPartyId && partyId && partyId === selectedPartyId,
            );

            return (
              <div
                key={partyId || candidate.displayName}
                className={`rounded-xl border p-3 text-xs ${
                  isSelected
                    ? "border-emerald-300 bg-emerald-50 text-emerald-950"
                    : "border-indigo-200 bg-white text-slate-800"
                }`}
              >
                <div className="font-semibold">{candidate.displayName}</div>

                <div>Party ID: {partyId || "-"}</div>

                <div>Provider #: {candidate.providerNumber || "-"}</div>

                <div>
                  Clinic: {candidate.clinicName || candidate.clinicId || "-"}
                </div>

                <div className="mt-1">
                  Score: {Math.round(candidate.score || 0)}%
                </div>

                <div
                  className={`mt-1 ${
                    isSelected ? "text-emerald-700" : "text-slate-500"
                  }`}
                >
                  {candidate.reason}
                </div>

                <button
                  type="button"
                  onClick={() => selectReferrer(candidate)}
                  disabled={busy || isSelected}
                  className={`mt-3 rounded-lg px-3 py-2 text-xs font-medium disabled:opacity-50 ${
                    isSelected
                      ? "bg-emerald-700 text-white"
                      : "bg-indigo-700 text-white"
                  }`}
                >
                  {isSelected ? "Selected referrer" : "Use this referrer"}
                </button>
              </div>
            );
          })}
        </div>
      ) : null}

      {message ? <p className="mt-3 text-xs font-medium">{message}</p> : null}
    </section>
  );
}