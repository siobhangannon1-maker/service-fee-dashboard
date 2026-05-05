"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";

type ImportActionState = {
  ok: boolean;
  message: string;
};

type ProviderImportFormProps = {
  action: (
    prevState: ImportActionState,
    formData: FormData
  ) => Promise<ImportActionState>;
};

type ImportType =
  | "appointments"
  | "performance"
  | "cancellations"
  | "new_patients";

const initialState: ImportActionState = {
  ok: false,
  message: "",
};

function getCurrentMonthValue() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function UploadSubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex w-full items-center justify-center rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Processing..." : label}
    </button>
  );
}

function UploadCard({
  title,
  description,
  importType,
  monthKey,
  action,
}: {
  title: string;
  description: string;
  importType: ImportType;
  monthKey: string;
  action: (
    prevState: ImportActionState,
    formData: FormData
  ) => Promise<ImportActionState>;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState(action, initialState);
  const [selectedFileName, setSelectedFileName] = useState("");

  const usesSelectedMonth = importType === "performance";

  useEffect(() => {
    if (state.message) router.refresh();
  }, [state.message, router]);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
          <p className="mt-1 text-sm leading-5 text-slate-500">
            {description}
          </p>
        </div>

        <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">
          CSV
        </span>
      </div>

      {/* ✅ FIXED FORM (removed encType) */}
      <form action={formAction} className="mt-5 space-y-3">
        <input type="hidden" name="monthKey" value={monthKey} />
        <input type="hidden" name="importType" value={importType} />

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">
            Select file
          </span>

          <input
            type="file"
            name="file"
            accept=".csv,text/csv"
            required
            onChange={(event) => {
              const file = event.target.files?.[0];
              setSelectedFileName(file?.name ?? "");
            }}
            className="block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700 hover:file:bg-slate-200"
          />
        </label>

        <UploadSubmitButton label={`Upload ${title}`} />
      </form>

      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Status
        </div>

        <div className="mt-2 space-y-1 text-xs text-slate-600">
          <div>
            <span className="font-medium text-slate-700">
              {usesSelectedMonth ? "Selected month:" : "Month handling:"}
            </span>{" "}
            {usesSelectedMonth
              ? monthKey || "Not selected"
              : "Detected automatically from file dates"}
          </div>

          <div>
            <span className="font-medium text-slate-700">File:</span>{" "}
            {selectedFileName || "No file selected"}
          </div>

          <div className="whitespace-pre-wrap">
            <span className="font-medium text-slate-700">Result:</span>{" "}
            {state.message ? (
              <span
                className={state.ok ? "text-emerald-700" : "text-red-700"}
              >
                {state.message}
              </span>
            ) : (
              <span className="text-slate-500">Waiting for upload</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ProviderImportForm({ action }: ProviderImportFormProps) {
  const [monthKey, setMonthKey] = useState(getCurrentMonthValue());

  const formattedMonth = useMemo(() => {
    const match = monthKey.match(/^(\d{4})-(\d{2})$/);
    if (!match) return "No month selected";

    const monthNames: Record<string, string> = {
      "01": "January",
      "02": "February",
      "03": "March",
      "04": "April",
      "05": "May",
      "06": "June",
      "07": "July",
      "08": "August",
      "09": "September",
      "10": "October",
      "11": "November",
      "12": "December",
    };

    return `${monthNames[match[2]] ?? match[2]} ${match[1]}`;
  }, [monthKey]);

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-5">
        <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <h3 className="text-sm font-semibold text-slate-950">
              Import month
            </h3>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              Performance uploads use this selected month. Appointments,
              cancellations, and new patients detect months automatically from
              the CSV date rows.
            </p>
          </div>

          <div className="w-full lg:w-72">
            <label
              htmlFor="provider-import-month"
              className="mb-1 block text-xs font-medium text-slate-600"
            >
              Month for performance upload
            </label>

            <input
              id="provider-import-month"
              type="month"
              value={monthKey}
              onChange={(event) => setMonthKey(event.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              required
            />

            <div className="mt-2 text-xs text-blue-900">
              Selected:{" "}
              <span className="font-semibold">{formattedMonth}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-4 md:grid-cols-2">
        <UploadCard
          title="Appointments"
          description="Upload raw provider appointments data."
          importType="appointments"
          monthKey={monthKey}
          action={action}
        />

        <UploadCard
          title="Performance"
          description="Upload monthly provider performance summary data."
          importType="performance"
          monthKey={monthKey}
          action={action}
        />

        <UploadCard
          title="Cancellations"
          description="Upload cancellations and FTA data."
          importType="cancellations"
          monthKey={monthKey}
          action={action}
        />

        <UploadCard
          title="New Patients"
          description="Upload new patient and referral data."
          importType="new_patients"
          monthKey={monthKey}
          action={action}
        />
      </div>
    </div>
  );
}