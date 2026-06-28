import ProductAdminClient from "./ProductAdminClient";
import { createClient } from "@/lib/supabase/server";

export default async function ProcurementProductsPage() {
  const supabase = await createClient();

  const { data: products, error } = await supabase
    .from("clinical_products")
    .select("*")
    .order("name");

  if (error) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold">Clinical Products</h1>
        <p className="mt-4 text-red-600">{error.message}</p>
      </div>
    );
  }

  return <ProductAdminClient initialProducts={products ?? []} />;
}