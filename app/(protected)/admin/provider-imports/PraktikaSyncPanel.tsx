"use client";

import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  syncPraktikaAppointments,
  syncPraktikaCancellationsFtas,
  syncPraktikaProviderPerformance,
} from "./praktika-sync-actions";

type ActionState = {
  ok: boolean;
  message: string;
};

const initialState: ActionState = {
  ok: false,
  message: "",
};

function getTodayIso() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(dateIso: string, days: number) {
  const [year, month, day] = dateIso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);

  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(
    2,
    "0"
  )}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function getCurrentWeekRange() {
  const today = getTodayIso();
  const date = new Date(`${today}T00:00:00`);
  const day = date.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;

  const weekStart = addDaysIso(today, mondayOffset);
  const weekEnd = addDaysIso(weekStart, 6);

  return { fromDate: weekStart, toDate: weekEnd };
}

function getCurrentMonthRange() {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();

  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);

  const toIso = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
      2,
      "0"
    )}-${String(date.getDate()).padStart(2, "0")}`;

  return {
    fromDate: toIso(start),
    toDate: toIso(end),
  };
}

function SyncSubmitButton({
  label,
  pendingLabel,
}: {
  label: string;
  pendingLabel: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-4 inline-flex w-full items-center justify-center rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

function StatusMessage({ state }: { state: ActionState }) {
  if (!state.message) return null;

  return (
    <div
      className={`mt-4 whitespace-pre-wrap rounded-xl border p-3 text-sm ${
        state.ok
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-red-200 bg-red-50 text-red-700"
      }`}
    >
      {state.message}
    </div>
  );
}

function SyncForm({
  title,
  description,
  fromDate,
  toDate,
  action,
  state,
  buttonLabel,
  pendingLabel,
}: {
  title: string;
  description: string;
  fromDate: string;
  toDate: string;
  action: (formData: FormData) => void;
  state: ActionState;
  buttonLabel: string;
  pendingLabel: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
          <p className="mt-1 text-sm leading-5 text-slate-500">{description}</p>
        </div>

        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
          Sync
        </span>
      </div>

      <form action={action}>
        <input type="hidden" name="fromDate" value={fromDate} />
        <input type="hidden" name="toDate" value={toDate} />

        <SyncSubmitButton label={buttonLabel} pendingLabel={pendingLabel} />
      </form>

      <StatusMessage state={state} />
    </div>
  );
}

export default function PraktikaSyncPanel() {
  const currentWeek = useMemo(() => getCurrentWeekRange(), []);
  const currentMonth = useMemo(() => getCurrentMonthRange(), []);

  const [fromDate, setFromDate] = useState(currentWeek.fromDate);
  const [toDate, setToDate] = useState(currentWeek.toDate);

  const [performanceState, performanceAction] = useActionState(
    syncPraktikaProviderPerformance,
    initialState
  );

  const [appointmentsState, appointmentsAction] = useActionState(
    syncPraktikaAppointments,
    initialState
  );

  const [cancellationsState, cancellationsAction] = useActionState(
    syncPraktikaCancellationsFtas,
    initialState
  );

  const [newPatientsState, setNewPatientsState] =
    useState<ActionState>(initialState);

  async function handleNewPatientsSync(e: React.FormEvent) {
    e.preventDefault();

    setNewPatientsState({ ok: false, message: "Syncing new patients..." });

    try {
      const res = await fetch("/api/praktika/new-patients-sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ fromDate, toDate }),
      });

      const text = await res.text();

      let data: any = null;

      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }

      if (!res.ok) {
        throw new Error(data?.error || text || "Sync failed");
      }

      setNewPatientsState({
        ok: true,
        message: `Synced ${
          data?.rowCount ?? 0
        } new patients.\nCheck terminal for NEW PATIENTS SAMPLE.`,
      });
    } catch (err: any) {
      setNewPatientsState({
        ok: false,
        message: err.message || "Sync failed",
      });
    }
  }

  function useCurrentWeek() {
    setFromDate(currentWeek.fromDate);
    setToDate(currentWeek.toDate);
  }

  function useCurrentMonth() {
    setFromDate(currentMonth.fromDate);
    setToDate(currentMonth.toDate);
  }

  function usePreviousWeek() {
    const previousWeekStart = addDaysIso(currentWeek.fromDate, -7);
    const previousWeekEnd = addDaysIso(previousWeekStart, 6);

    setFromDate(previousWeekStart);
    setToDate(previousWeekEnd);
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
        <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <h3 className="text-sm font-semibold text-slate-950">
              Sync date range
            </h3>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              Choose the date range to use for Praktika syncs. Weekly options
              are useful for appointments and cancellations; monthly is useful
              for performance.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={usePreviousWeek}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-100"
            >
              Previous week
            </button>

            <button
              type="button"
              onClick={useCurrentWeek}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-100"
            >
              Current week
            </button>

            <button
              type="button"
              onClick={useCurrentMonth}
              className="rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
            >
              Current month
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">
              From date
            </span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">
              To date
            </span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </label>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-4 md:grid-cols-2">
        <SyncForm
          title="Provider Performance"
          description="Monthly KPI and production data."
          fromDate={fromDate}
          toDate={toDate}
          action={performanceAction}
          state={performanceState}
          buttonLabel="Sync Performance"
          pendingLabel="Syncing..."
        />

        <SyncForm
          title="Appointments"
          description="Provider appointment data for KPI calculations."
          fromDate={fromDate}
          toDate={toDate}
          action={appointmentsAction}
          state={appointmentsState}
          buttonLabel="Sync Appointments"
          pendingLabel="Syncing..."
        />

        <SyncForm
          title="FTA / Cancellations"
          description="Cancellation and failed-to-attend data."
          fromDate={fromDate}
          toDate={toDate}
          action={cancellationsAction}
          state={cancellationsState}
          buttonLabel="Sync Cancellations"
          pendingLabel="Syncing..."
        />

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300 hover:shadow-md">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-950">
                New Patients
              </h3>
              <p className="mt-1 text-sm leading-5 text-slate-500">
                New patient joins with PHI removed.
              </p>
            </div>

            <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700">
              Sync
            </span>
          </div>

          <form onSubmit={handleNewPatientsSync}>
            <button
              type="submit"
              className="mt-4 inline-flex w-full items-center justify-center rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
            >
              Sync New Patients
            </button>
          </form>

          <StatusMessage state={newPatientsState} />
        </div>
      </div>
    </div>
  );
}