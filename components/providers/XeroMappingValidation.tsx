"use client";
import { useState } from "react";
import type { MappingResult } from "@/lib/billing/validate-xero-mappings";
const labels: Record<MappingResult["status"], string> = {
  found: "Active contact found — confirm the identity below",
  missing: "Missing contact ID",
  invalid_format: "Invalid contact ID format",
  not_found: "Contact not found in this organisation",
  archived: "Contact is not active",
  unverified: "Could not verify — retry the check",
};
export default function XeroMappingValidation() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{
    organisationName: string;
    checkedAt: string;
    mappings: MappingResult[];
  } | null>(null);
  async function validate() {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/xero/validate-provider-mappings", {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Validation unavailable.");
      setResult(data);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Validation unavailable.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="my-5 rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="text-lg font-semibold text-slate-950">
        Check Xero contact mappings
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        Admins can check saved provider mappings against the connected Xero
        organisation. Unsaved edits are not included. This check does not assign
        contacts, update invoices or change mappings.
      </p>
      <button
        type="button"
        onClick={validate}
        disabled={busy}
        className="mt-3 rounded-xl bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {busy ? "Checking mappings…" : "Check saved mappings (read only)"}
      </button>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {result && (
        <div className="mt-4 text-sm">
          <p role="status">
            Connected organisation: <strong>{result.organisationName}</strong> ·
            Checked{" "}
            {new Date(result.checkedAt).toLocaleString("en-AU", {
              timeZone: "Australia/Brisbane",
            })}
          </p>
          <p className="my-2 text-slate-600">
            An active contact ID proves the contact exists here. Compare its
            name with the provider and confirm the intended recipient before
            saving a mapping.
          </p>
          <ul className="divide-y">
            {result.mappings.map((mapping) => (
              <li key={mapping.providerId} className="py-3">
                <p className="font-semibold">{mapping.providerName}</p>
                <p>{labels[mapping.status]}</p>
                {mapping.contactId && (
                  <p className="break-all">
                    Saved ContactID: {mapping.contactId}
                  </p>
                )}
                {mapping.contactName && (
                  <p>Xero contact: {mapping.contactName}</p>
                )}
                {mapping.duplicate && (
                  <p className="text-amber-800">
                    This contact ID is also assigned to another active provider.
                    Review whether sharing it is intentional.
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
