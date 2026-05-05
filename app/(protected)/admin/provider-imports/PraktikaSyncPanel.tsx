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

  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(
    date.getUTCDate()
  ).padStart(2, "0")}`;
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
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
      date.getDate()
    ).padStart(2, "0")}`;

  return {
    fromDate: toIso(start),
    toDate: toIso(end),
  };
}

function SyncSubmitButton({
  label,
  pendingLabel,
  className,
}: {
  label: string;
  pendingLabel: string;
  className: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className={`${className} rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50`}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

function StatusMessage({ state }: { state: ActionState }) {
  if (!state.message) return null;

  return (
    <div
      className={`mt-3 whitespace-pre-wrap rounded-lg border p-3 text-sm ${
        state.ok
          ? "border-green-200 bg-green-50 text-green-700"
          : "border-red-200 bg-red-50 text-red-700"
      }`}
    >
      {state.message}
    </div>
  );
}

function SyncForm(props: any) {
  const {
    title,
    description,
    fromDate,
    toDate,
    action,
    state,
    buttonLabel,
    pendingLabel,
    buttonClassName,
  } = props;

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
      <div className="text-sm font-semibold text-gray-900">{title}</div>
      <p className="mt-1 text-xs text-gray-600">{description}</p>

      <form action={action} className="mt-3">
        <input type="hidden" name="fromDate" value={fromDate} />
        <input type="hidden" name="toDate" value={toDate} />

        <SyncSubmitButton
          label={buttonLabel}
          pendingLabel={pendingLabel}
          className={buttonClassName}
        />
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

  // ✅ NEW STATE
  const [newPatientsState, setNewPatientsState] = useState<ActionState>(initialState);

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

      const data = await res.json();

      if (!res.ok) throw new Error(data?.error || "Sync failed");

      setNewPatientsState({
        ok: true,
        message: `Synced ${data.rowCount} new patients.\nCheck terminal for NEW PATIENTS SAMPLE.`,
      });
    } catch (err: any) {
      setNewPatientsState({
        ok: false,
        message: err.message,
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
    <section className="rounded-2xl border border-green-200 bg-white p-5 shadow-sm">
      <h2 className="text-xl font-semibold text-gray-900">
        Praktika Sync
      </h2>

      {/* DATE PICKER */}
      <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
        <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />

        <div className="flex gap-2">
          <button onClick={usePreviousWeek}>Prev Week</button>
          <button onClick={useCurrentWeek}>Current Week</button>
          <button onClick={useCurrentMonth}>Month</button>
        </div>
      </div>

      {/* SYNC CARDS */}
      <div className="mt-6 grid gap-4 lg:grid-cols-4">
        <SyncForm
          title="Provider Performance"
          description="Monthly KPI data"
          fromDate={fromDate}
          toDate={toDate}
          action={performanceAction}
          state={performanceState}
          buttonLabel="Sync Performance"
          pendingLabel="Syncing..."
          buttonClassName="bg-green-600"
        />

        <SyncForm
          title="Appointments"
          description="Weekly KPI denominator"
          fromDate={fromDate}
          toDate={toDate}
          action={appointmentsAction}
          state={appointmentsState}
          buttonLabel="Sync Appointments"
          pendingLabel="Syncing..."
          buttonClassName="bg-blue-600"
        />

        <SyncForm
          title="FTA / Cancellations"
          description="Weekly KPI rates"
          fromDate={fromDate}
          toDate={toDate}
          action={cancellationsAction}
          state={cancellationsState}
          buttonLabel="Sync Cancellations"
          pendingLabel="Syncing..."
          buttonClassName="bg-purple-600"
        />

        {/* ✅ NEW PATIENTS CARD */}
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
          <div className="text-sm font-semibold text-gray-900">New Patients</div>
          <p className="mt-1 text-xs text-gray-600">
            Sync new patient joins (PHI removed).
          </p>

          <form onSubmit={handleNewPatientsSync} className="mt-3">
            <button
              type="submit"
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white"
            >
              Sync New Patients
            </button>
          </form>

          <StatusMessage state={newPatientsState} />
        </div>
      </div>
    </section>
  );
}