"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";

type ImportActionState = {
  ok: boolean;
  message: string;
} | null;

type ProviderImportFormProps = {
  action: (
    prevState: ImportActionState,
    formData: FormData
  ) => Promise<ImportActionState>;
};

const initialState: ImportActionState = null;

function UploadSubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
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
  importType: "appointments" | "performance" | "cancellations";
  monthKey: string;
  action: (
    prevState: ImportActionState,
    formData: FormData
  ) => Promise<ImportActionState>;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState(action, initialState);
  const [selectedFileName, setSelectedFileName] = useState("");

  useEffect(() => {
    if (state) {
      router.refresh();
    }
  }, [state, router]);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="text-sm font-semibold text-gray-900">{title}</div>
      <p className="mt-1 text-sm text-gray-600">{description}</p>

      <form
        action={formAction}
        encType="multipart/form-data"
        className="mt-4 flex flex-col gap-3"
      >
        <input type="hidden" name="monthKey" value={monthKey} />
        <input type="hidden" name="importType" value={importType} />

        <input
          type="file"
          name="file"
          accept=".csv,text/csv"
          required
          onChange={(event) => {
            const file = event.target.files?.[0];
            setSelectedFileName(file?.name ?? "");
          }}
          className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
        />

        <UploadSubmitButton label={`Upload ${title}`} />
      </form>

      <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
        <div className="text-xs font-medium text-gray-700">Latest status</div>

        <div className="mt-2 text-xs text-gray-600">
          <span className="font-medium text-gray-700">Selected month:</span>{" "}
          {monthKey || "Not selected"}
        </div>

        <div className="mt-1 text-xs text-gray-600">
          <span className="font-medium text-gray-700">File:</span>{" "}
          {selectedFileName || "No file selected yet"}
        </div>

        <div className="mt-1 text-xs">
          <span className="font-medium text-gray-700">Status:</span>{" "}
          {state ? (
            <span className={state.ok ? "text-green-600" : "text-red-600"}>
              {state.message}
            </span>
          ) : (
            <span className="text-gray-500">Waiting for upload</span>
          )}
        </div>
      </div>
    </div>
  );
}

function getCurrentMonthValue() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function ProviderImportForm({ action }: ProviderImportFormProps) {
  const [monthKey, setMonthKey] = useState(getCurrentMonthValue());

  const formattedMonth = useMemo(() => {
    const match = monthKey.match(/^(\d{4})-(\d{2})$/);

    if (!match) return "No month selected";

    const year = match[1];
    const month = match[2];

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

    return `${monthNames[month] ?? month} ${year}`;
  }, [monthKey]);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold text-gray-900">Import month</div>
        <p className="mt-1 text-sm text-gray-600">
          Select the month once here. All upload cards below will use this month.
        </p>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="w-full sm:max-w-xs">
            <label
              htmlFor="provider-import-month"
              className="mb-1 block text-xs font-medium text-gray-700"
            >
              Month
            </label>

            <input
              id="provider-import-month"
              type="month"
              value={monthKey}
              onChange={(event) => setMonthKey(event.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
              required
            />
          </div>

          <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
            Selected: <span className="font-medium">{formattedMonth}</span>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <UploadCard
          title="Appointments CSV"
          description="Upload raw provider appointments data for the selected month."
          importType="appointments"
          monthKey={monthKey}
          action={action}
        />

        <UploadCard
          title="Performance CSV"
          description="Upload raw provider performance data for the selected month."
          importType="performance"
          monthKey={monthKey}
          action={action}
        />

        <UploadCard
          title="Cancellations CSV"
          description="Upload cancellations and FTAs data for the selected month."
          importType="cancellations"
          monthKey={monthKey}
          action={action}
        />
      </div>
    </div>
  );
}