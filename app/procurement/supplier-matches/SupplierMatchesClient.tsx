"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import ProcurementCard from "@/components/procurement/ProcurementCard";
import ProcurementPageHeader from "@/components/procurement/ProcurementPageHeader";
import StatusBadge from "@/components/procurement/StatusBadge";
import EmptyState from "@/components/procurement/EmptyState";

type ProductOption = {
  id: string;
  name: string;
  product_type: "commodity" | "brand_specific";
  preferred_brand: string | null;
  is_active: boolean;
};

type SupplierOption = {
  id: string;
  name: string;
  is_active: boolean;
};

type NestedProduct =
  | {
      id: string;
      name: string;
      product_type: "commodity" | "brand_specific";
      preferred_brand: string | null;
    }
  | {
      id: string;
      name: string;
      product_type: "commodity" | "brand_specific";
      preferred_brand: string | null;
    }[]
  | null;

type NestedSupplier =
  | {
      id: string;
      name: string;
    }
  | {
      id: string;
      name: string;
    }[]
  | null;

type SupplierMatch = {
  id: string;
  clinical_product_id: string;
  supplier_id: string;
  supplier_sku: string;
  manufacturer: string | null;
  supplier_product_name: string;
  pack_size: string | null;
  units_per_pack: number | null;
  unit_label: string | null;
  gst_applicable: boolean;
  image_url: string | null;
  supplier_url: string | null;
  barcode: string | null;
  confidence_score: number | null;
  approved: boolean;
  last_verified_at: string | null;
  created_at: string;
  clinical_products: NestedProduct;
  suppliers: NestedSupplier;
};

const emptyForm = {
  clinical_product_id: "",
  supplier_id: "",
  supplier_sku: "",
  manufacturer: "",
  supplier_product_name: "",
  pack_size: "",
  units_per_pack: "",
  unit_label: "",
  gst_applicable: true,
  image_url: "",
  supplier_url: "",
  barcode: "",
  confidence_score: "95",
  approved: true,
};

function getNestedOne<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function confidenceVariant(score: number | null) {
  if (score === null) return "pending";
  if (score >= 95) return "active";
  if (score >= 85) return "approved";
  if (score >= 70) return "warning";
  return "danger";
}

export default function SupplierMatchesClient({
  initialMatches,
  products,
  suppliers,
}: {
  initialMatches: SupplierMatch[];
  products: ProductOption[];
  suppliers: SupplierOption[];
}) {
  const supabase = createClient();

  const [matches, setMatches] = useState(initialMatches);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [approvalFilter, setApprovalFilter] = useState<
    "approved" | "pending" | "all"
  >("all");
  const [saving, setSaving] = useState(false);

  const approvedCount = matches.filter((match) => match.approved).length;
  const pendingCount = matches.filter((match) => !match.approved).length;
  const supplierCount = new Set(matches.map((match) => match.supplier_id)).size;

  const filteredMatches = useMemo(() => {
    return matches.filter((match) => {
      const product = getNestedOne(match.clinical_products);
      const supplier = getNestedOne(match.suppliers);
      const query = search.trim().toLowerCase();

      const matchesSearch =
        !query ||
        product?.name.toLowerCase().includes(query) ||
        supplier?.name.toLowerCase().includes(query) ||
        match.supplier_sku.toLowerCase().includes(query) ||
        match.supplier_product_name.toLowerCase().includes(query) ||
        match.manufacturer?.toLowerCase().includes(query);

      const matchesApproval =
        approvalFilter === "all" ||
        (approvalFilter === "approved" && match.approved) ||
        (approvalFilter === "pending" && !match.approved);

      return matchesSearch && matchesApproval;
    });
  }, [matches, search, approvalFilter]);

  function resetForm() {
    setForm(emptyForm);
    setEditingId(null);
  }

  function editMatch(match: SupplierMatch) {
    setEditingId(match.id);

    setForm({
      clinical_product_id: match.clinical_product_id,
      supplier_id: match.supplier_id,
      supplier_sku: match.supplier_sku ?? "",
      manufacturer: match.manufacturer ?? "",
      supplier_product_name: match.supplier_product_name ?? "",
      pack_size: match.pack_size ?? "",
      units_per_pack:
        match.units_per_pack === null || match.units_per_pack === undefined
          ? ""
          : String(match.units_per_pack),
      unit_label: match.unit_label ?? "",
      gst_applicable: match.gst_applicable,
      image_url: match.image_url ?? "",
      supplier_url: match.supplier_url ?? "",
      barcode: match.barcode ?? "",
      confidence_score:
        match.confidence_score === null || match.confidence_score === undefined
          ? ""
          : String(match.confidence_score),
      approved: match.approved,
    });

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function refreshMatches() {
    const { data, error } = await supabase
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
      .order("created_at", { ascending: false });

    if (error) {
      alert(error.message);
      return;
    }

    setMatches((data ?? []) as SupplierMatch[]);
  }

  async function saveMatch() {
    if (!form.clinical_product_id) {
      alert("Please choose a clinical product.");
      return;
    }

    if (!form.supplier_id) {
      alert("Please choose a supplier.");
      return;
    }

    if (!form.supplier_sku.trim()) {
      alert("Supplier SKU is required.");
      return;
    }

    if (!form.supplier_product_name.trim()) {
      alert("Supplier product name is required.");
      return;
    }

    setSaving(true);

    const payload = {
      clinical_product_id: form.clinical_product_id,
      supplier_id: form.supplier_id,
      supplier_sku: form.supplier_sku.trim(),
      manufacturer: form.manufacturer.trim() || null,
      supplier_product_name: form.supplier_product_name.trim(),
      pack_size: form.pack_size.trim() || null,
      units_per_pack: form.units_per_pack
        ? Number(form.units_per_pack)
        : null,
      unit_label: form.unit_label.trim() || null,
      gst_applicable: form.gst_applicable,
      image_url: form.image_url.trim() || null,
      supplier_url: form.supplier_url.trim() || null,
      barcode: form.barcode.trim() || null,
      confidence_score: form.confidence_score
        ? Number(form.confidence_score)
        : null,
      approved: form.approved,
      last_verified_at: new Date().toISOString(),
    };

    const query = editingId
      ? supabase
          .from("supplier_matches")
          .update(payload)
          .eq("id", editingId)
      : supabase.from("supplier_matches").insert(payload);

    const { error } = await query;

    setSaving(false);

    if (error) {
      alert(error.message);
      return;
    }

    resetForm();
    await refreshMatches();
  }

  async function toggleApproved(match: SupplierMatch) {
    const { error } = await supabase
      .from("supplier_matches")
      .update({
        approved: !match.approved,
        last_verified_at: new Date().toISOString(),
      })
      .eq("id", match.id);

    if (error) {
      alert(error.message);
      return;
    }

    await refreshMatches();
  }

  async function deleteMatch(match: SupplierMatch) {
    const confirmed = confirm(
      `Delete supplier match ${match.supplier_sku}? Only do this if it was created in error.`
    );

    if (!confirmed) return;

    const { error } = await supabase
      .from("supplier_matches")
      .delete()
      .eq("id", match.id);

    if (error) {
      alert(error.message);
      return;
    }

    setMatches((current) => current.filter((item) => item.id !== match.id));
  }

  return (
    <div className="p-6 space-y-6">
      <ProcurementPageHeader
        badge="Product-to-Supplier Bridge"
        title="Supplier Matches"
        description="Link each clinical product to approved supplier SKUs. Supplier SKU is the durable identifier; URLs are supporting metadata only."
      />

      <div className="grid gap-4 md:grid-cols-4">
        <ProcurementCard title="Total matches">
          <p className="text-3xl font-semibold">{matches.length}</p>
          <p className="mt-1 text-sm text-gray-500">Supplier SKU links</p>
        </ProcurementCard>

        <ProcurementCard title="Approved">
          <p className="text-3xl font-semibold">{approvedCount}</p>
          <p className="mt-1 text-sm text-gray-500">Ready for price checks</p>
        </ProcurementCard>

        <ProcurementCard title="Pending review">
          <p className="text-3xl font-semibold">{pendingCount}</p>
          <p className="mt-1 text-sm text-gray-500">Needs human approval</p>
        </ProcurementCard>

        <ProcurementCard title="Suppliers linked">
          <p className="text-3xl font-semibold">{supplierCount}</p>
          <p className="mt-1 text-sm text-gray-500">Across catalogue</p>
        </ProcurementCard>
      </div>

      <ProcurementCard
        title={editingId ? "Edit supplier match" : "Add supplier match"}
        description="For now this is manual. Later, AI Supplier Finder will pre-fill these fields and staff will only approve or reject."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm">
            Clinical product
            <select
              className="mt-1 w-full rounded-lg border p-2"
              value={form.clinical_product_id}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  clinical_product_id: event.target.value,
                }))
              }
            >
              <option value="">Choose product...</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            Supplier
            <select
              className="mt-1 w-full rounded-lg border p-2"
              value={form.supplier_id}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  supplier_id: event.target.value,
                }))
              }
            >
              <option value="">Choose supplier...</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            Supplier SKU
            <input
              className="mt-1 w-full rounded-lg border p-2"
              placeholder="Supplier item code"
              value={form.supplier_sku}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  supplier_sku: event.target.value,
                }))
              }
            />
          </label>

          <label className="text-sm">
            Manufacturer
            <input
              className="mt-1 w-full rounded-lg border p-2"
              placeholder="3M, GC, SDI, etc."
              value={form.manufacturer}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  manufacturer: event.target.value,
                }))
              }
            />
          </label>

          <label className="text-sm md:col-span-2">
            Supplier product name
            <input
              className="mt-1 w-full rounded-lg border p-2"
              placeholder="Exact product name shown by supplier"
              value={form.supplier_product_name}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  supplier_product_name: event.target.value,
                }))
              }
            />
          </label>

          <label className="text-sm">
            Pack size
            <input
              className="mt-1 w-full rounded-lg border p-2"
              placeholder="Box of 100, 20 capsules, 1 bottle"
              value={form.pack_size}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  pack_size: event.target.value,
                }))
              }
            />
          </label>

          <label className="text-sm">
            Units per pack
            <input
              type="number"
              className="mt-1 w-full rounded-lg border p-2"
              placeholder="100"
              value={form.units_per_pack}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  units_per_pack: event.target.value,
                }))
              }
            />
          </label>

          <label className="text-sm">
            Unit label
            <input
              className="mt-1 w-full rounded-lg border p-2"
              placeholder="glove, capsule, bottle, syringe"
              value={form.unit_label}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  unit_label: event.target.value,
                }))
              }
            />
          </label>

          <label className="text-sm">
            Barcode
            <input
              className="mt-1 w-full rounded-lg border p-2"
              value={form.barcode}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  barcode: event.target.value,
                }))
              }
            />
          </label>

          <label className="text-sm md:col-span-2">
            Supplier URL
            <input
              className="mt-1 w-full rounded-lg border p-2"
              placeholder="https://..."
              value={form.supplier_url}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  supplier_url: event.target.value,
                }))
              }
            />
          </label>

          <label className="text-sm md:col-span-2">
            Image URL
            <input
              className="mt-1 w-full rounded-lg border p-2"
              placeholder="Product or packaging image URL"
              value={form.image_url}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  image_url: event.target.value,
                }))
              }
            />
          </label>

          <label className="text-sm">
            Confidence score
            <input
              type="number"
              min="0"
              max="100"
              className="mt-1 w-full rounded-lg border p-2"
              value={form.confidence_score}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  confidence_score: event.target.value,
                }))
              }
            />
          </label>

          <div className="rounded-lg border bg-gray-50 p-3">
            <p className="text-sm font-medium">Match rules</p>

            <label className="mt-3 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.gst_applicable}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    gst_applicable: event.target.checked,
                  }))
                }
              />
              GST applicable
            </label>

            <label className="mt-3 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.approved}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    approved: event.target.checked,
                  }))
                }
              />
              Approved for recommendations
            </label>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={saveMatch}
            disabled={saving}
            className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? "Saving..." : editingId ? "Update match" : "Add match"}
          </button>

          {editingId && (
            <button
              onClick={resetForm}
              className="rounded-lg border px-4 py-2 text-sm font-medium"
            >
              Cancel edit
            </button>
          )}
        </div>
      </ProcurementCard>

      <ProcurementCard
        title="Approved supplier SKU catalogue"
        description="These records will later be created by AI Supplier Finder and updated by supplier connectors."
      >
        <div className="mb-4 grid gap-3 md:grid-cols-2">
          <input
            className="rounded-lg border p-2 text-sm"
            placeholder="Search product, supplier, SKU, manufacturer..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />

          <select
            className="rounded-lg border p-2 text-sm"
            value={approvalFilter}
            onChange={(event) =>
              setApprovalFilter(
                event.target.value as "approved" | "pending" | "all"
              )
            }
          >
            <option value="all">All matches</option>
            <option value="approved">Approved only</option>
            <option value="pending">Pending only</option>
          </select>
        </div>

        {filteredMatches.length === 0 ? (
          <EmptyState
            title="No supplier matches found"
            description="Add your first supplier SKU match above."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="py-2">Clinical product</th>
                  <th className="py-2">Supplier</th>
                  <th className="py-2">SKU</th>
                  <th className="py-2">Supplier product</th>
                  <th className="py-2">Pack</th>
                  <th className="py-2">Confidence</th>
                  <th className="py-2">Approval</th>
                  <th className="py-2">Open</th>
                  <th className="py-2">Actions</th>
                </tr>
              </thead>

              <tbody>
                {filteredMatches.map((match) => {
                  const product = getNestedOne(match.clinical_products);
                  const supplier = getNestedOne(match.suppliers);

                  return (
                    <tr key={match.id} className="border-b align-top">
                      <td className="py-3">
                        <p className="font-medium">
                          {product?.name ?? "Unknown product"}
                        </p>
                        {product?.preferred_brand && (
                          <p className="mt-1 text-xs text-gray-500">
                            Preferred: {product.preferred_brand}
                          </p>
                        )}
                      </td>

                      <td className="py-3">{supplier?.name ?? "Unknown"}</td>

                      <td className="py-3 font-mono text-xs">
                        {match.supplier_sku}
                      </td>

                      <td className="py-3">
                        <p>{match.supplier_product_name}</p>
                        {match.manufacturer && (
                          <p className="mt-1 text-xs text-gray-500">
                            {match.manufacturer}
                          </p>
                        )}
                      </td>

                      <td className="py-3">{match.pack_size ?? "—"}</td>

                      <td className="py-3">
                        <StatusBadge
                          variant={confidenceVariant(match.confidence_score)}
                        >
                          {match.confidence_score === null
                            ? "No score"
                            : `${match.confidence_score}%`}
                        </StatusBadge>
                      </td>

                      <td className="py-3">
                        <StatusBadge
                          variant={match.approved ? "active" : "pending"}
                        >
                          {match.approved ? "Approved" : "Pending"}
                        </StatusBadge>
                      </td>

                      <td className="py-3">
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

                      <td className="py-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => editMatch(match)}
                            className="rounded-lg border px-3 py-1 text-xs font-medium hover:bg-gray-50"
                          >
                            Edit
                          </button>

                          <button
                            onClick={() => toggleApproved(match)}
                            className="rounded-lg border px-3 py-1 text-xs font-medium hover:bg-gray-50"
                          >
                            {match.approved ? "Unapprove" : "Approve"}
                          </button>

                          <button
                            onClick={() => deleteMatch(match)}
                            className="rounded-lg border px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </ProcurementCard>
    </div>
  );
}