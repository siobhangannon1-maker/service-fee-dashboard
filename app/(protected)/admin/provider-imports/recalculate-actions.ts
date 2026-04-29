"use server";

import { revalidatePath } from "next/cache";
import { calculateProviderMonthlyMetrics } from "@/lib/providers/calculate-provider-monthly-metrics";
import { calculateProviderYearlyMetrics } from "@/lib/providers/calculate-provider-yearly-metrics";
import { calculateProviderAtoQuarterMetrics } from "@/lib/providers/calculate-provider-ato-quarter-metrics";

type RecalculateState = {
  success: boolean;
  message: string;
};

function getYearKeyFromMonthKey(monthKey: string): string {
  const match = monthKey.match(/^(\d{4})-(\d{2})$/);

  if (!match) {
    throw new Error(`Invalid month key: "${monthKey}". Expected YYYY-MM`);
  }

  return match[1];
}

function getAtoQuarterKeyFromMonthKey(monthKey: string): string {
  const match = monthKey.match(/^(\d{4})-(\d{2})$/);

  if (!match) {
    throw new Error(`Invalid month key: "${monthKey}". Expected YYYY-MM`);
  }

  const calendarYear = Number(match[1]);
  const month = Number(match[2]);

  if (month >= 7 && month <= 9) {
    return `${calendarYear}-Q1-ATO`;
  }

  if (month >= 10 && month <= 12) {
    return `${calendarYear}-Q2-ATO`;
  }

  if (month >= 1 && month <= 3) {
    return `${calendarYear - 1}-Q3-ATO`;
  }

  return `${calendarYear - 1}-Q4-ATO`;
}

export async function recalculateOnlyAction(
  _prevState: RecalculateState | null,
  formData: FormData
): Promise<RecalculateState> {
  const monthKeyValue = formData.get("monthKey");
  const monthKey = typeof monthKeyValue === "string" ? monthKeyValue.trim() : "";

  if (!monthKey) {
    return {
      success: false,
      message: "Month key is required.",
    };
  }

  try {
    const yearKey = getYearKeyFromMonthKey(monthKey);
    const quarterKey = getAtoQuarterKeyFromMonthKey(monthKey);

    const monthlyResult = await calculateProviderMonthlyMetrics({
      monthKey,
    });

    const yearlyResult = await calculateProviderYearlyMetrics({
      yearKey,
    });

    const quarterResult = await calculateProviderAtoQuarterMetrics({
      quarterKey,
    });

    revalidatePath("/admin/provider-imports");
    revalidatePath("/benchmark/expense-reports");
    revalidatePath("/practice-manager/kpis");
    revalidatePath("/provider");
    revalidatePath("/admin/provider-dashboard");

    return {
      success: true,
      message: [
        `Recalculated ${monthKey}`,
        `Year: ${yearKey}`,
        `ATO quarter: ${quarterKey}`,
        `Monthly: ${monthlyResult?.providersCalculated ?? 0}`,
        `Yearly: ${yearlyResult?.providersCalculated ?? 0}`,
        `Quarter: ${quarterResult?.providersCalculated ?? 0}`,
      ].join(" | "),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error occurred.";

    console.error("RECALCULATE ACTION FAILED", {
      monthKey,
      message,
      error,
    });

    return {
      success: false,
      message: `FAILED IN ACTION for ${monthKey}: ${message}`,
    };
  }
}
