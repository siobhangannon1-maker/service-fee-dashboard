import PriceWatchClient from "./PriceWatchClient";
import { createClient } from "@/lib/supabase/server";

export default async function PriceWatchPage() {
  const supabase = await createClient();

  const { data: products, error } = await supabase
    .from("clinical_products")
    .select(`
      id,
      name,
      category,
      product_type,
      preferred_brand,
      approved_alternatives_allowed,
      default_unit,
      supplier_matches (
        id,
        supplier_sku,
        supplier_product_name,
        pack_size,
        units_per_pack,
        unit_label,
        image_url,
        supplier_url,
        approved,
        confidence_score,
        suppliers (
          id,
          name
        ),
        price_snapshots (
          id,
          price_ex_gst,
          price_inc_gst,
          freight_estimate,
          landed_cost,
          unit_price_ex_gst,
          availability,
          delivery_note,
          checked_at
        )
      )
    `)
    .eq("is_active", true)
    .order("name");

  if (error) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold">Procurement Price Watch</h1>
        <p className="mt-4 text-red-600">{error.message}</p>
      </div>
    );
  }

  return <PriceWatchClient products={products ?? []} />;
}