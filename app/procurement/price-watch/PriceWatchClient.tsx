"use client";

type PriceSnapshot = {
  id: string;
  price_ex_gst: number | null;
  price_inc_gst: number | null;
  freight_estimate: number | null;
  landed_cost: number | null;
  unit_price_ex_gst: number | null;
  availability: string | null;
  delivery_note: string | null;
  checked_at: string;
};

type Supplier = {
  id: string;
  name: string;
};

type SupplierMatch = {
  id: string;
  supplier_sku: string;
  supplier_product_name: string;
  pack_size: string | null;
  units_per_pack: number | null;
  unit_label: string | null;
  image_url: string | null;
  supplier_url: string | null;
  approved: boolean;
  confidence_score: number | null;
  suppliers: Supplier | Supplier[] | null;
  price_snapshots: PriceSnapshot[];
};

type ClinicalProduct = {
  id: string;
  name: string;
  category: string | null;
  product_type: "commodity" | "brand_specific";
  preferred_brand: string | null;
  approved_alternatives_allowed: boolean;
  default_unit: string | null;
  supplier_matches: SupplierMatch[];
};

function formatMoney(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";

  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format(value);
}

function latestSnapshot(match: SupplierMatch) {
  return [...(match.price_snapshots ?? [])].sort(
    (a, b) =>
      new Date(b.checked_at).getTime() - new Date(a.checked_at).getTime()
  )[0];
}

function getSupplier(match: SupplierMatch) {
  if (Array.isArray(match.suppliers)) {
    return match.suppliers[0] ?? null;
  }

  return match.suppliers;
}

function recommendation(product: ClinicalProduct) {
  const approvedMatches = product.supplier_matches.filter((m) => m.approved);

  const priced = approvedMatches
    .map((match) => ({
      match,
      snapshot: latestSnapshot(match),
    }))
    .filter((row) => row.snapshot?.landed_cost != null);

  if (priced.length === 0) return null;

  priced.sort(
    (a, b) => Number(a.snapshot.landed_cost) - Number(b.snapshot.landed_cost)
  );

  return priced[0];
}

export default function PriceWatchClient({
  products,
}: {
  products: ClinicalProduct[];
}) {
  return (
    <div className="p-6 space-y-6">
      <div>
        <p className="text-sm text-gray-500">DocuDental Procurement</p>
        <h1 className="text-2xl font-semibold">Price Intelligence</h1>
        <p className="mt-2 text-sm text-gray-600">
          Compare approved supplier matches by total landed cost, not just item
          price.
        </p>
      </div>

      <div className="grid gap-4">
        {products.map((product) => {
          const best = recommendation(product);
          const bestSupplierName = best
            ? getSupplier(best.match)?.name ?? "No price yet"
            : "No price yet";

          return (
            <div
              key={product.id}
              className="rounded-xl border bg-white p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold">{product.name}</h2>
                  <p className="text-sm text-gray-500">
                    {product.category ?? "Uncategorised"} ·{" "}
                    {product.product_type === "commodity"
                      ? "Commodity"
                      : "Brand specific"}
                  </p>

                  {product.preferred_brand && (
                    <p className="text-sm text-gray-500">
                      Preferred brand: {product.preferred_brand}
                    </p>
                  )}
                </div>

                <div className="rounded-lg bg-green-50 px-3 py-2 text-right">
                  <p className="text-xs text-green-700">AI recommendation</p>
                  <p className="font-semibold text-green-900">
                    {bestSupplierName}
                  </p>
                  <p className="text-sm text-green-800">
                    {formatMoney(best?.snapshot.landed_cost)}
                  </p>
                </div>
              </div>

              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-gray-500">
                      <th className="py-2">Supplier</th>
                      <th className="py-2">SKU</th>
                      <th className="py-2">Product</th>
                      <th className="py-2">Pack</th>
                      <th className="py-2">Ex GST</th>
                      <th className="py-2">Inc GST</th>
                      <th className="py-2">Freight</th>
                      <th className="py-2">Landed</th>
                      <th className="py-2">Availability</th>
                      <th className="py-2">Open</th>
                    </tr>
                  </thead>

                  <tbody>
                    {product.supplier_matches.length === 0 && (
                      <tr>
                        <td className="py-3 text-gray-400" colSpan={10}>
                          No supplier matches yet.
                        </td>
                      </tr>
                    )}

                    {product.supplier_matches.map((match) => {
                      const snapshot = latestSnapshot(match);
                      const supplier = getSupplier(match);

                      return (
                        <tr key={match.id} className="border-b">
                          <td className="py-2">
                            {supplier?.name ?? "Unknown"}
                          </td>
                          <td className="py-2">{match.supplier_sku}</td>
                          <td className="py-2">
                            {match.supplier_product_name}
                          </td>
                          <td className="py-2">{match.pack_size ?? "—"}</td>
                          <td className="py-2">
                            {formatMoney(snapshot?.price_ex_gst)}
                          </td>
                          <td className="py-2">
                            {formatMoney(snapshot?.price_inc_gst)}
                          </td>
                          <td className="py-2">
                            {formatMoney(snapshot?.freight_estimate)}
                          </td>
                          <td className="py-2 font-medium">
                            {formatMoney(snapshot?.landed_cost)}
                          </td>
                          <td className="py-2">
                            {snapshot?.availability ?? "—"}
                          </td>
                          <td className="py-2">
                            {match.supplier_url ? (
                              <a
                                href={match.supplier_url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-blue-600 underline"
                              >
                                Open
                              </a>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}

        {products.length === 0 && (
          <div className="rounded-xl border bg-white p-6 text-gray-500">
            No clinical products found yet.
          </div>
        )}
      </div>
    </div>
  );
}