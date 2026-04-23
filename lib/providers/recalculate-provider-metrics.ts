import { calculateProviderMonthlyMetrics } from "./calculate-provider-monthly-metrics";
import { calculateProviderYearlyMetrics } from "./calculate-provider-yearly-metrics";
import { calculateProviderAtoQuarterMetrics } from "./calculate-provider-ato-quarter-metrics";
import {
  getAtoQuarterPeriodFromIsoDate,
  getYearPeriodFromIsoDate,
} from "./provider-periods";

type RecalculateParams = {
  monthKey: string;
};

export async function recalculateProviderMetrics({
  monthKey,
}: RecalculateParams) {
  if (!monthKey) {
    throw new Error("monthKey is required");
  }

  await calculateProviderMonthlyMetrics({
    monthKey,
  });

  const yearKey = getYearPeriodFromIsoDate(`${monthKey}-01`).periodKey;
  await calculateProviderYearlyMetrics({
    yearKey,
  });

  const quarterKey = getAtoQuarterPeriodFromIsoDate(`${monthKey}-01`).periodKey;
  await calculateProviderAtoQuarterMetrics({
    quarterKey,
  });
}