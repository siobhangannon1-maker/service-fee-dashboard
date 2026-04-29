export type KpiBenchmarkTone = "green" | "orange" | "red" | "neutral";

export type PracticeKpiBenchmark = {
  id?: string | null;
  metric_key: string;
  metric_label: string;
  metric_type: "percentage" | "number" | "currency" | "hours";
  higher_is_better: boolean;
  target_value: number;
  green_min: number;
  green_max: number;
  orange_min: number;
  orange_max: number;
  red_min: number;
};

export function getKpiBenchmarkTone(
  value: number | null | undefined,
  benchmark: PracticeKpiBenchmark | null | undefined
): KpiBenchmarkTone {
  if (!benchmark || value === null || value === undefined) return "neutral";

  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) return "neutral";

  if (numericValue >= benchmark.green_min && numericValue <= benchmark.green_max) return "green";
  if (numericValue >= benchmark.orange_min && numericValue <= benchmark.orange_max) return "orange";

  return "red";
}

export function getKpiBenchmarkByKey(
  benchmarks: PracticeKpiBenchmark[],
  metricKey: string
): PracticeKpiBenchmark | null {
  return benchmarks.find((benchmark) => benchmark.metric_key === metricKey) ?? null;
}

export function getKpiToneStyles(tone: KpiBenchmarkTone) {
  if (tone === "green") {
    return { backgroundColor: "#dcfce7", color: "#166534", borderColor: "#86efac" };
  }

  if (tone === "orange") {
    return { backgroundColor: "#fef3c7", color: "#92400e", borderColor: "#fcd34d" };
  }

  if (tone === "red") {
    return { backgroundColor: "#fee2e2", color: "#991b1b", borderColor: "#fca5a5" };
  }

  return { backgroundColor: "#f8fafc", color: "#334155", borderColor: "#cbd5e1" };
}

export function formatKpiBenchmarkValue(
  value: number | null | undefined,
  metricType: PracticeKpiBenchmark["metric_type"] = "percentage"
): string {
  const safeValue = Number(value ?? 0);

  if (metricType === "percentage") return `${(safeValue * 100).toFixed(2)}%`;
  if (metricType === "hours") return `${safeValue.toFixed(2)} h`;
  if (metricType === "currency") {
    return new Intl.NumberFormat("en-AU", {
      style: "currency",
      currency: "AUD",
      maximumFractionDigits: 2,
    }).format(safeValue);
  }

  return safeValue.toFixed(2);
}
