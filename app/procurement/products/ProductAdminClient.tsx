"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import ProcurementCard from "@/components/procurement/ProcurementCard";
import ProcurementPageHeader from "@/components/procurement/ProcurementPageHeader";
import StatusBadge from "@/components/procurement/StatusBadge";
import EmptyState from "@/components/procurement/EmptyState";

type ProductType = "commodity" | "brand_specific";

type ClinicalProduct = {
  id: string;
  name: string;
  category: string | null;
  product_type: ProductType;
  preferred_brand: string | null;
  approved_alternatives_allowed: boolean;
  default_unit: string | null;
  notes: string | null;
  is_active: boolean;
};

const emptyForm = {
  name: "",
  category: "",
  product_type: "commodity" as ProductType,
  preferred_brand: "",
  approved_alternatives_allowed: true,
  default_unit: "",
  notes: "",
  is_active: true,
};

export default function ProductAdminClient({
  initialProducts,
}: {
  initialProducts: ClinicalProduct[];
}) {
  const supabase = createClient();

  const [products, setProducts] = useState(initialProducts);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | ProductType>("all");
  const [statusFilter, setStatusFilter] = useState<"active" | "archived" | "all">(
    "active"
  );
  const [saving, setSaving] = useState(false);

  const activeCount = products.filter((p) => p.is_active).length;
  const commodityCount = products.filter((p) => p.product_type === "commodity").length;
  const brandSpecificCount = products.filter(
    (p) => p.product_type === "brand_specific"
  ).length;

  const filteredProducts = useMemo(() => {
    return products.filter((product) => {
      const query = search.trim().toLowerCase();

      const matchesSearch =
        !query ||
        product.name.toLowerCase().includes(query) ||
        product.category?.toLowerCase().includes(query) ||
        product.preferred_brand?.toLowerCase().includes(query);

      const matchesType =
        typeFilter === "all" || product.product_type === typeFilter;

      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && product.is_active) ||
        (statusFilter === "archived" && !product.is_active);

      return matchesSearch && matchesType && matchesStatus;
    });
  }, [products, search, typeFilter, statusFilter]);

  function resetForm() {
    setForm(emptyForm);
    setEditingId(null);
  }

  function editProduct(product: ClinicalProduct) {
    setEditingId(product.id);

    setForm({
      name: product.name ?? "",
      category: product.category ?? "",
      product_type: product.product_type,
      preferred_brand: product.preferred_brand ?? "",
      approved_alternatives_allowed: product.approved_alternatives_allowed,
      default_unit: product.default_unit ?? "",
      notes: product.notes ?? "",
      is_active: product.is_active,
    });

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveProduct() {
    if (!form.name.trim()) {
      alert("Product name is required.");
      return;
    }

    setSaving(true);

    const payload = {
      name: form.name.trim(),
      category: form.category.trim() || null,
      product_type: form.product_type,
      preferred_brand: form.preferred_brand.trim() || null,
      approved_alternatives_allowed: form.approved_alternatives_allowed,
      default_unit: form.default_unit.trim() || null,
      notes: form.notes.trim() || null,
      is_active: form.is_active,
    };

    const query = editingId
      ? supabase
          .from("clinical_products")
          .update(payload)
          .eq("id", editingId)
          .select("*")
          .single()
      : supabase.from("clinical_products").insert(payload).select("*").single();

    const { data, error } = await query;

    setSaving(false);

    if (error) {
      alert(error.message);
      return;
    }

    if (editingId) {
      setProducts((current) =>
        current.map((product) => (product.id === editingId ? data : product))
      );
    } else {
      setProducts((current) =>
        [...current, data].sort((a, b) => a.name.localeCompare(b.name))
      );
    }

    resetForm();
  }

  async function archiveProduct(product: ClinicalProduct) {
    const confirmed = confirm(
      `Archive ${product.name}? This keeps supplier matches, price history, orders and inventory records safe.`
    );

    if (!confirmed) return;

    const { data, error } = await supabase
      .from("clinical_products")
      .update({ is_active: false })
      .eq("id", product.id)
      .select("*")
      .single();

    if (error) {
      alert(error.message);
      return;
    }

    setProducts((current) =>
      current.map((p) => (p.id === product.id ? data : p))
    );
  }

  async function restoreProduct(product: ClinicalProduct) {
    const { data, error } = await supabase
      .from("clinical_products")
      .update({ is_active: true })
      .eq("id", product.id)
      .select("*")
      .single();

    if (error) {
      alert(error.message);
      return;
    }

    setProducts((current) =>
      current.map((p) => (p.id === product.id ? data : p))
    );
  }

  return (
    <div className="p-6 space-y-6">
      <ProcurementPageHeader
        badge="Master Catalogue"
        title="Clinical Products"
        description="The source of truth for everything the practice buys. Supplier matches, pricing, ordering, invoices and inventory will all connect back to these clinical products."
      />

      <div className="grid gap-4 md:grid-cols-4">
        <ProcurementCard title="Active products">
          <p className="text-3xl font-semibold">{activeCount}</p>
          <p className="mt-1 text-sm text-gray-500">Currently available</p>
        </ProcurementCard>

        <ProcurementCard title="Commodity">
          <p className="text-3xl font-semibold">{commodityCount}</p>
          <p className="mt-1 text-sm text-gray-500">Cheapest approved option</p>
        </ProcurementCard>

        <ProcurementCard title="Brand specific">
          <p className="text-3xl font-semibold">{brandSpecificCount}</p>
          <p className="mt-1 text-sm text-gray-500">Preferred brand controlled</p>
        </ProcurementCard>

        <ProcurementCard title="Locations">
          <p className="text-3xl font-semibold">2</p>
          <p className="mt-1 text-sm text-gray-500">Paddington, Coorparoo</p>
        </ProcurementCard>
      </div>

      <ProcurementCard
        title={editingId ? "Edit clinical product" : "Add clinical product"}
        description="Create the internal product first. Supplier SKUs and pricing are linked separately later."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm">
            Product name
            <input
              className="mt-1 w-full rounded-lg border p-2"
              placeholder="Example: Filtek Supreme Universal A2"
              value={form.name}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
            />
          </label>

          <label className="text-sm">
            Category
            <input
              className="mt-1 w-full rounded-lg border p-2"
              placeholder="PPE, Restorative, Bonding, Infection Control"
              value={form.category}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  category: event.target.value,
                }))
              }
            />
          </label>

          <label className="text-sm">
            Product type
            <select
              className="mt-1 w-full rounded-lg border p-2"
              value={form.product_type}
              onChange={(event) => {
                const nextType = event.target.value as ProductType;

                setForm((current) => ({
                  ...current,
                  product_type: nextType,
                  approved_alternatives_allowed:
                    nextType === "commodity"
                      ? true
                      : current.approved_alternatives_allowed,
                }));
              }}
            >
              <option value="commodity">Commodity</option>
              <option value="brand_specific">Brand specific</option>
            </select>
          </label>

          <label className="text-sm">
            Preferred brand
            <input
              className="mt-1 w-full rounded-lg border p-2"
              placeholder="Example: 3M, GC, Kulzer"
              value={form.preferred_brand}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  preferred_brand: event.target.value,
                }))
              }
            />
          </label>

          <label className="text-sm">
            Default unit
            <input
              className="mt-1 w-full rounded-lg border p-2"
              placeholder="box, bottle, syringe, pack"
              value={form.default_unit}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  default_unit: event.target.value,
                }))
              }
            />
          </label>

          <div className="rounded-lg border bg-gray-50 p-3">
            <p className="text-sm font-medium">Procurement rules</p>

            <label className="mt-3 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.approved_alternatives_allowed}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    approved_alternatives_allowed: event.target.checked,
                  }))
                }
              />
              Approved alternatives allowed
            </label>

            <label className="mt-3 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    is_active: event.target.checked,
                  }))
                }
              />
              Active product
            </label>
          </div>

          <label className="text-sm md:col-span-2">
            Notes
            <textarea
              className="mt-1 w-full rounded-lg border p-2"
              rows={3}
              placeholder="Clinical notes, ordering rules, substitute restrictions, or staff guidance."
              value={form.notes}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  notes: event.target.value,
                }))
              }
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={saveProduct}
            disabled={saving}
            className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? "Saving..." : editingId ? "Update product" : "Add product"}
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
        title="Clinical product catalogue"
        description="Archive instead of deleting so historic prices, invoices, orders and stock movements remain reliable."
      >
        <div className="mb-4 grid gap-3 md:grid-cols-3">
          <input
            className="rounded-lg border p-2 text-sm"
            placeholder="Search products, categories or brands..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />

          <select
            className="rounded-lg border p-2 text-sm"
            value={typeFilter}
            onChange={(event) =>
              setTypeFilter(event.target.value as "all" | ProductType)
            }
          >
            <option value="all">All product types</option>
            <option value="commodity">Commodity</option>
            <option value="brand_specific">Brand specific</option>
          </select>

          <select
            className="rounded-lg border p-2 text-sm"
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(event.target.value as "active" | "archived" | "all")
            }
          >
            <option value="active">Active only</option>
            <option value="archived">Archived only</option>
            <option value="all">All products</option>
          </select>
        </div>

        {filteredProducts.length === 0 ? (
          <EmptyState
            title="No products found"
            description="Try changing your search or filters, or add a new clinical product above."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="py-2">Product</th>
                  <th className="py-2">Category</th>
                  <th className="py-2">Type</th>
                  <th className="py-2">Brand</th>
                  <th className="py-2">Alternatives</th>
                  <th className="py-2">Unit</th>
                  <th className="py-2">Status</th>
                  <th className="py-2">Actions</th>
                </tr>
              </thead>

              <tbody>
                {filteredProducts.map((product) => (
                  <tr key={product.id} className="border-b align-top">
                    <td className="py-3">
                      <p className="font-medium">{product.name}</p>
                      {product.notes && (
                        <p className="mt-1 max-w-md text-xs text-gray-500">
                          {product.notes}
                        </p>
                      )}
                    </td>

                    <td className="py-3">{product.category ?? "—"}</td>

                    <td className="py-3">
                      <StatusBadge
                        variant={
                          product.product_type === "commodity"
                            ? "active"
                            : "approved"
                        }
                      >
                        {product.product_type === "commodity"
                          ? "Commodity"
                          : "Brand specific"}
                      </StatusBadge>
                    </td>

                    <td className="py-3">{product.preferred_brand ?? "—"}</td>

                    <td className="py-3">
                      {product.approved_alternatives_allowed ? "Yes" : "No"}
                    </td>

                    <td className="py-3">{product.default_unit ?? "—"}</td>

                    <td className="py-3">
                      <StatusBadge
                        variant={product.is_active ? "active" : "archived"}
                      >
                        {product.is_active ? "Active" : "Archived"}
                      </StatusBadge>
                    </td>

                    <td className="py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => editProduct(product)}
                          className="rounded-lg border px-3 py-1 text-xs font-medium hover:bg-gray-50"
                        >
                          Edit
                        </button>

                        {product.is_active ? (
                          <button
                            onClick={() => archiveProduct(product)}
                            className="rounded-lg border px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                          >
                            Archive
                          </button>
                        ) : (
                          <button
                            onClick={() => restoreProduct(product)}
                            className="rounded-lg border px-3 py-1 text-xs font-medium text-green-700 hover:bg-green-50"
                          >
                            Restore
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ProcurementCard>
    </div>
  );
}