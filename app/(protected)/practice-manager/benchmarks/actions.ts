"use server";

import { createClient } from "@supabase/supabase-js";

function getClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function updateKpiBenchmark(formData: FormData) {
  const supabase = getClient();

  const metricKey = String(formData.get("metric_key"));
  const green = Number(formData.get("green_threshold"));
  const amber = Number(formData.get("amber_threshold"));

  const { error } = await supabase.from("kpi_benchmarks").upsert(
    {
      metric_key: metricKey,
      green_threshold: green,
      amber_threshold: amber,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "metric_key" }
  );

  if (error) {
    throw new Error(error.message);
  }
}