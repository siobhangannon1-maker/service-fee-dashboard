"use client";

type BillingPeriod = {
  id: string;
  label: string;
  month: number;
  year: number;
  status: string;
};

type Props = {
  selectedPeriodId: string;
  billingPeriods: BillingPeriod[];
  activePeriodStatus: "open" | "locked";
  loadingMetrics: boolean;
  onSynced: () => Promise<void>;
  showToast: (
    message: string,
    tone?: "default" | "success" | "error"
  ) => void;
};

function getMonthDateRange(period: BillingPeriod) {
  const start = new Date(period.year, period.month - 1, 1);
  const end = new Date(period.year, period.month, 0);

  const fromDate = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(start.getDate()).padStart(2, "0")}`;

  const toDate = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(end.getDate()).padStart(2, "0")}`;

  return { fromDate, toDate };
}

export default function PraktikaProductionSyncButton({
  selectedPeriodId,
  billingPeriods,
  activePeriodStatus,
  loadingMetrics,
  onSynced,
  showToast,
}: Props) {
  async function handleSync() {
    const selectedPeriod = billingPeriods.find(
      (period) => period.id === selectedPeriodId
    );

    if (!selectedPeriod) {
      showToast("Please select a billing period first.", "error");
      return;
    }

    if (activePeriodStatus === "locked") {
      showToast("This billing period is locked. Unlock it before syncing.", "error");
      return;
    }

    const { fromDate, toDate } = getMonthDateRange(selectedPeriod);

    const confirmed = window.confirm(
      `Sync Praktika production for ${selectedPeriod.label}?\n\nThis will create a new production import and link it to this billing period.`
    );

    if (!confirmed) return;

    try {
      showToast("Syncing Praktika production report...", "default");

      const res = await fetch("/api/praktika/production-sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          billingPeriodId: selectedPeriod.id,
          fromDate,
          toDate,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(data?.error || "Praktika production sync failed.");
      }

      showToast(data?.message || "Production report synced.", "success");

      await onSynced();
    } catch (error: any) {
      showToast(error?.message || "Praktika production sync failed.", "error");
    }
  }

  return (
    <button
      onClick={handleSync}
      disabled={
        !selectedPeriodId || activePeriodStatus === "locked" || loadingMetrics
      }
      className="rounded-2xl bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-700 disabled:opacity-50"
    >
      Sync Production from Praktika
    </button>
  );
}