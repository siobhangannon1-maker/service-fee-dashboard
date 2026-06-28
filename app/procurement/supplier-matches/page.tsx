import SupplierMatchesClient from "./SupplierMatchesClient";
import { createClient } from "@/lib/supabase/server";

export default async function SupplierMatchesPage() {
  const supabase = await createClient();

  const [{ data: matches, error: matchesError }, { data: products }, { data: suppliers }] =
    await Promise.all([
      supabase
        .from("supplier_matches")
        .select(`
          *,
          clinical_products (
            id,
            name,
            product_type,
            preferred_brand
          ),
          suppliers (
            id,
            name
          )
        `)
        .order("created_at", { ascending: false }),

      supabase
        .from("clinical_products")
        .select("id, name, product_type, preferred_brand, is_active")
        .eq("is_active", true)
        .order("name"),

      supabase
        .from("suppliers")
        .select("id, name, is_active")
        .eq("is_active", true)
        .order("name"),
    ]);

  if (matchesError) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold">Supplier Matches</h1>
        <p className="mt-4 text-red-600">{matchesError.message}</p>
      </div>
    );
  }

  return (
    <SupplierMatchesClient
      initialMatches={matches ?? []}
      products={products ?? []}
      suppliers={suppliers ?? []}
    />
  );
}