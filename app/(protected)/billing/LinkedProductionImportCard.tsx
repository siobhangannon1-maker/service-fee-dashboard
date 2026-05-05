"use client";

import { useEffect, useState } from "react";

type LinkedImport = {
  id: string;
  source_file_name: string;
  status: string;
  created_at: string;
  billing_period_id: string;
  month: number | null;
  row_count: number;
  source: "CSV" | "Praktika";
};

type Props = {
  billingPeriodId: string;
};

function formatDate(value: string) {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-AU");
}

export default function LinkedProductionImportCard({ billingPeriodId }: Props) {
  const [linkedImport, setLinkedImport] = useState<LinkedImport | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    async function loadLinkedImport() {
      if (!billingPeriodId) {
        setLinkedImport(null);
        return;
      }

      setLoading(true);
      setErrorMessage("");

      try {
        const res = await fetch(
          `/api/imports/linked-production?billingPeriodId=${billingPeriodId}`,
          {
            method: "GET",
            cache: "no-store",
          }
        );

        const data = await res.json().catch(() => null);

        if (!res.ok) {
          throw new Error(data?.error || "Failed to load linked production import");
        }

        setLinkedImport(data?.import || null);
      } catch (error: any) {
        setErrorMessage(error?.message || "Failed to load linked production import");
        setLinkedImport(null);
      } finally {
        setLoading(false);
      }
    }

    loadLinkedImport();
  }, [billingPeriodId]);

  if (!billingPeriodId) return null;

  if (loading) {
    return (
      <div className="mt-4 rounded-2xl border bg-white p-4 text-sm text-slate-600">
        Loading current production import...
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        {errorMessage}
      </div>
    );
  }

  if (!linkedImport) {
    return (
      <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        No production import is currently linked to this billing month.
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
      <div className="font-semibold">Current production import</div>

      <div className="mt-2 grid gap-2 md:grid-cols-4">
        <div>
          <div className="text-xs text-emerald-700">Source</div>
          <div className="font-medium">{linkedImport.source}</div>
        </div>

        <div>
          <div className="text-xs text-emerald-700">Rows</div>
          <div className="font-medium">
            {linkedImport.row_count.toLocaleString("en-AU")}
          </div>
        </div>

        <div>
          <div className="text-xs text-emerald-700">Status</div>
          <div className="font-medium">{linkedImport.status}</div>
        </div>

        <div>
          <div className="text-xs text-emerald-700">Synced / uploaded</div>
          <div className="font-medium">{formatDate(linkedImport.created_at)}</div>
        </div>
      </div>

      <div className="mt-3 text-xs text-emerald-800">
        {linkedImport.source_file_name}
      </div>
    </div>
  );
}