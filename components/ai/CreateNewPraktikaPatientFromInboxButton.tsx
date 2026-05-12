"use client";

import { useEffect, useState } from "react";

type InboxItem = {
  id: string;
  sender_email?: string | null;
  extracted_patient_first_name?: string | null;
  extracted_patient_last_name?: string | null;
  extracted_patient_dob?: string | null;
  extracted_patient_mobile?: string | null;
  extracted_patient_email?: string | null;
  praktika_patient_id?: string | null;

  praktika_referrer_party_id?: string | number | null;
  praktika_matched_referrer_party_id?: string | number | null;
  referrer_party_id?: string | number | null;
  praktika_referral_party_id?: string | number | null;
  praktika_referrer_match_reason?: string | null;
};

function safePatientEmail(inboxItem: InboxItem) {
  const patientEmail = String(inboxItem.extracted_patient_email || "").trim();
  const senderEmail = String(inboxItem.sender_email || "").trim().toLowerCase();

  if (!patientEmail) return "";
  if (senderEmail && patientEmail.toLowerCase() === senderEmail) return "";

  return patientEmail;
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

export default function CreateNewPraktikaPatientFromButton({
  inboxItem,
  onCreated,
}: {
  inboxItem: InboxItem;
  onCreated?: (item: any) => void | Promise<void>;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dob, setDob] = useState("");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const confirmedReferrerPartyId = getConfirmedReferrerPartyId(inboxItem);

  useEffect(() => {
    setFirstName(String(inboxItem.extracted_patient_first_name || ""));
    setLastName(String(inboxItem.extracted_patient_last_name || ""));
    setDob(String(inboxItem.extracted_patient_dob || ""));
    setMobile(String(inboxItem.extracted_patient_mobile || ""));
    setEmail(safePatientEmail(inboxItem));
    setMessage("");
    setBusy(false);
  }, [
    inboxItem.id,
    inboxItem.extracted_patient_first_name,
    inboxItem.extracted_patient_last_name,
    inboxItem.extracted_patient_dob,
    inboxItem.extracted_patient_mobile,
    inboxItem.extracted_patient_email,
    inboxItem.sender_email,
    inboxItem.praktika_referrer_party_id,
    inboxItem.praktika_matched_referrer_party_id,
    inboxItem.referrer_party_id,
    inboxItem.praktika_referral_party_id,
  ]);

  if (!inboxItem?.id) return null;
  if (inboxItem.praktika_patient_id) return null;

  async function createPatient() {
    setMessage("");

    if (!firstName.trim() || !lastName.trim() || !dob.trim() || !mobile.trim()) {
      setMessage("First name, last name, DOB and mobile are required.");
      return;
    }

    setBusy(true);
    setMessage("Creating Praktika patient...");

    try {
      const response = await fetch("/api/praktika/new-patient-from-inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          inboxItemId: inboxItem.id,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          dob: dob.trim(),
          mobile: mobile.trim(),
          email: email.trim(),
          partyId: confirmedReferrerPartyId || null,
          createReferral: Boolean(confirmedReferrerPartyId),
          fileAttachments: true,
        }),
      });

      const result = await response.json().catch(() => null);

      if (!response.ok || !result?.ok) {
        throw new Error(
          result?.error || "Failed to create new Praktika patient.",
        );
      }

      setMessage(
        confirmedReferrerPartyId
          ? "Patient created and referral workflow started."
          : "Patient created. Select a referrer to create the referral.",
      );

      if (result.item) {
        await onCreated?.(result.item);
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Failed to create new Praktika patient.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-3xl border border-purple-200 bg-purple-50 p-5 text-purple-950 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-bold">Create new Praktika patient</h3>
          <p className="mt-1 text-sm leading-6 text-purple-800">
            Use this when Praktika did not find a confident existing patient.
            Details are pre-filled from the referral where available.
          </p>
        </div>

        <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-purple-700">
          Assisted
        </span>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label>
          <span className="text-sm font-medium">First name *</span>
          <input
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className="mt-1 w-full rounded-2xl border border-purple-200 bg-white px-4 py-3 text-sm text-slate-950"
          />
        </label>

        <label>
          <span className="text-sm font-medium">Last name *</span>
          <input
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className="mt-1 w-full rounded-2xl border border-purple-200 bg-white px-4 py-3 text-sm text-slate-950"
          />
        </label>

        <label>
          <span className="text-sm font-medium">DOB *</span>
          <input
            value={dob}
            onChange={(e) => setDob(e.target.value)}
            placeholder="DD/MM/YYYY or YYYY-MM-DD"
            className="mt-1 w-full rounded-2xl border border-purple-200 bg-white px-4 py-3 text-sm text-slate-950"
          />
        </label>

        <label>
          <span className="text-sm font-medium">Mobile *</span>
          <input
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
            placeholder="Only if listed in referral"
            className="mt-1 w-full rounded-2xl border border-purple-200 bg-white px-4 py-3 text-sm text-slate-950"
          />
        </label>

        <label>
          <span className="text-sm font-medium">Patient email</span>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Only if listed in referral"
            className="mt-1 w-full rounded-2xl border border-purple-200 bg-white px-4 py-3 text-sm text-slate-950"
          />
        </label>

        <div className="rounded-2xl border border-purple-200 bg-white px-4 py-3 text-sm">
          <div className="font-medium text-purple-950">Confirmed referrer</div>
          <div className="mt-1 text-purple-800">
            {confirmedReferrerPartyId
              ? `Ready · Party ID ${confirmedReferrerPartyId}`
              : "Select a referrer above before creating the referral."}
          </div>
          {inboxItem.praktika_referrer_match_reason ? (
            <div className="mt-1 text-xs text-purple-700">
              {inboxItem.praktika_referrer_match_reason}
            </div>
          ) : null}
        </div>
      </div>

      <button
        type="button"
        onClick={createPatient}
        disabled={busy}
        className="mt-5 rounded-2xl bg-purple-700 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
      >
        {busy ? "Creating..." : "Create patient + file referral"}
      </button>

      {message ? <p className="mt-3 text-sm font-medium">{message}</p> : null}
    </section>
  );
}