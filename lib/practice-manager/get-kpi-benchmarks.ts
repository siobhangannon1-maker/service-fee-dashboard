import { createClient } from "@supabase/supabase-js";

function getClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function getKpiBenchmarks() {
  const supabase = getClient();

  const { data, error } = await supabase
    .from("kpi_benchmarks")
    .select("*");

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}