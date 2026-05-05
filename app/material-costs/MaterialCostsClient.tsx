"use client";

import { useEffect, useMemo, useState } from "react";
import PageLayout from "@/components/ui/PageLayout";
import { createClient } from "@/lib/supabase/client";
import Toast from "@/components/ui/Toast";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { writeAuditLog } from "@/lib/audit";

type MaterialCostItem = {
  id: string;
  name: string;
  default_cost: number;
  is_active: boolean;
  sort_order: number;
  ref_codes: string[] | null;
  barcode_values: string[] | null;
};

type FormState = {
  name: string;
  default_cost: string;
  sort_order: string;
  is_active: boolean;
  ref_codes_text: string;
  barcode_values_text: string;
};

const emptyForm: FormState = {
  name: "",
  default_cost: "",
  sort_order: "0",
  is_active: true,
  ref_codes_text: "",
  barcode_values_text: "",
};

function parseCodesInput(value: string) {
  return Array.from(
    new Set(
      value
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

function formatCodesForTextarea(values: string[] | null | undefined) {
  return (values || []).join("\n");
}

function formatCurrency(value: number) {
  return Number(value).toLocaleString("en-AU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fieldClassName() {
  return "w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
}

function textareaClassName() {
  return "min-h-[140px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
}

function StatCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: string | number;
  helper: string;
}) {
  return (
    <div className="rounded-2xl border border-white/20 bg-white/10 p-4 text-white shadow-sm backdrop-blur">
      <div className="text-xs font-semibold uppercase tracking-wide text-white/70">
        {label}
      </div>
      <div className="mt-2 text-3xl font-semibold tracking-tight">{value}</div>
      <div className="mt-1 text-xs text-white/70">{helper}</div>
    </div>
  );
}

export default function MaterialCostsClient() {
  const supabase = createClient();

  const [items, setItems] = useState<MaterialCostItem[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<"default" | "success" | "error">("default");
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<null | (() => void)>(null);

  async function loadItems() {
    const { data, error } = await supabase
      .from("material_cost_items")
      .select(
        "id, name, default_cost, is_active, sort_order, ref_codes, barcode_values"
      )
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (error) {
      setTone("error");
      setMessage(`Error loading items: ${error.message}`);
      return;
    }

    setItems((data || []) as MaterialCostItem[]);
  }

  useEffect(() => {
    loadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredItems = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();

    if (!query) return items;

    return items.filter((item) => {
      const refCodes = (item.ref_codes || []).join(" ").toLowerCase();
      const barcodeValues = (item.barcode_values || []).join(" ").toLowerCase();

      return (
        item.name.toLowerCase().includes(query) ||
        String(item.default_cost).includes(query) ||
        String(item.sort_order).includes(query) ||
        (item.is_active ? "active" : "archived").includes(query) ||
        refCodes.includes(query) ||
        barcodeValues.includes(query)
      );
    });
  }, [items, searchTerm]);

  const activeItemCount = items.filter((item) => item.is_active).length;
  const archivedItemCount = items.length - activeItemCount;
  const itemsWithCodesCount = items.filter(
    (item) =>
      (item.ref_codes && item.ref_codes.length > 0) ||
      (item.barcode_values && item.barcode_values.length > 0)
  ).length;

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
  }

  async function saveItem(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");

    if (!form.name.trim()) {
      setTone("error");
      setMessage("Please enter an item name.");
      return;
    }

    if (!form.default_cost.trim()) {
      setTone("error");
      setMessage("Please enter a default cost.");
      return;
    }

    const cost = Number(form.default_cost);
    const sortOrder = Number(form.sort_order || "0");

    if (Number.isNaN(cost)) {
      setTone("error");
      setMessage("Default cost must be a valid number.");
      return;
    }

    if (Number.isNaN(sortOrder)) {
      setTone("error");
      setMessage("Sort order must be a valid number.");
      return;
    }

    const refCodes = parseCodesInput(form.ref_codes_text);
    const barcodeValues = parseCodesInput(form.barcode_values_text);

    setSaving(true);

    const payload = {
      name: form.name.trim(),
      default_cost: cost,
      sort_order: sortOrder,
      is_active: form.is_active,
      ref_codes: refCodes,
      barcode_values: barcodeValues,
    };

    const result = editingId
      ? await supabase
          .from("material_cost_items")
          .update(payload)
          .eq("id", editingId)
      : await supabase.from("material_cost_items").insert(payload);

    if (result.error) {
      setTone("error");
      setMessage(`Save failed: ${result.error.message}`);
      setSaving(false);
      return;
    }

    await writeAuditLog({
      action: editingId ? "material_cost_item_updated" : "material_cost_item_created",
      entityType: "material_cost_item",
      entityId: editingId,
      metadata: payload,
    });

    setTone("success");
    setMessage(editingId ? "Item updated." : "Item added.");
    setSaving(false);
    resetForm();
    loadItems();
  }

  function beginEdit(item: MaterialCostItem) {
    setEditingId(item.id);
    setForm({
      name: item.name,
      default_cost: String(item.default_cost),
      sort_order: String(item.sort_order),
      is_active: item.is_active,
      ref_codes_text: formatCodesForTextarea(item.ref_codes),
      barcode_values_text: formatCodesForTextarea(item.barcode_values),
    });
  }

  async function archiveItem(item: MaterialCostItem) {
    const { error } = await supabase
      .from("material_cost_items")
      .update({ is_active: false })
      .eq("id", item.id);

    if (error) {
      setTone("error");
      setMessage(`Archive failed: ${error.message}`);
      return;
    }

    await writeAuditLog({
      action: "material_cost_item_archived",
      entityType: "material_cost_item",
      entityId: item.id,
      metadata: { name: item.name },
    });

    setTone("success");
    setMessage("Item archived.");
    if (editingId === item.id) resetForm();
    loadItems();
  }

  async function restoreItem(item: MaterialCostItem) {
    const { error } = await supabase
      .from("material_cost_items")
      .update({ is_active: true })
      .eq("id", item.id);

    if (error) {
      setTone("error");
      setMessage(`Restore failed: ${error.message}`);
      return;
    }

    await writeAuditLog({
      action: "material_cost_item_restored",
      entityType: "material_cost_item",
      entityId: item.id,
      metadata: { name: item.name },
    });

    setTone("success");
    setMessage("Item restored.");
    loadItems();
  }

  return (
    <PageLayout
      eyebrow="Setup"
      title="Material Costs"
      description="Manage implant and material cost presets, REF numbers, and barcode values used in patient financial entries."
    >
        <ConfirmDialog
          open={confirmOpen}
          title="Archive item?"
          description="This will hide the item from the material preset dropdown, but keep it in your records."
          danger
          onCancel={() => {
            setConfirmOpen(false);
            setConfirmAction(null);
          }}
          onConfirm={() => {
            confirmAction?.();
            setConfirmOpen(false);
            setConfirmAction(null);
          }}
        />

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-950 shadow-sm">
          <div className="bg-gradient-to-br from-slate-950 via-blue-950 to-blue-700 px-6 py-7">
            <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr] lg:items-end">
              <div>
                <div className="inline-flex rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white/80">
                  Materials library
                </div>

                <h2 className="mt-4 text-2xl font-semibold tracking-tight text-white md:text-3xl">
                  Keep implant and material presets accurate.
                </h2>

                <p className="mt-3 max-w-2xl text-sm leading-6 text-white/75">
                  Maintain default costs, REF numbers, and barcode values so
                  patient entries can be completed faster and more consistently.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <StatCard
                  label="Active"
                  value={activeItemCount}
                  helper="Available in entry forms"
                />
                <StatCard
                  label="Archived"
                  value={archivedItemCount}
                  helper="Hidden from presets"
                />
                <StatCard
                  label="With codes"
                  value={itemsWithCodesCount}
                  helper="REF or barcode linked"
                />
              </div>
            </div>
          </div>
        </section>

        {message && (
          <div className="mt-4">
            <Toast message={message} tone={tone} />
          </div>
        )}

        <form
          onSubmit={saveItem}
          className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm lg:p-6"
        >
          <div className="mb-5">
            <h2 className="text-lg font-semibold text-slate-950">
              {editingId ? "Edit material preset" : "Add material preset"}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Enter the material name, default cost, and any REF or barcode values used for matching.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Item name
              </label>
              <input
                className={fieldClassName()}
                value={form.name}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, name: e.target.value }))
                }
                placeholder="Straumann Implant"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Default cost
              </label>
              <input
                type="number"
                step="0.01"
                className={fieldClassName()}
                value={form.default_cost}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, default_cost: e.target.value }))
                }
                placeholder="552.40"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Sort order
              </label>
              <input
                type="number"
                className={fieldClassName()}
                value={form.sort_order}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, sort_order: e.target.value }))
                }
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                REF codes
              </label>
              <textarea
                className={textareaClassName()}
                value={form.ref_codes_text}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, ref_codes_text: e.target.value }))
                }
                placeholder={`One code per line\n047.531\n047531`}
              />
              <p className="mt-1 text-xs text-slate-500">
                Enter one REF number per line.
              </p>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Barcode values
              </label>
              <textarea
                className={textareaClassName()}
                value={form.barcode_values_text}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    barcode_values_text: e.target.value,
                  }))
                }
                placeholder={`One barcode per line\n09348922334455`}
              />
              <p className="mt-1 text-xs text-slate-500">
                Enter one barcode value per line.
              </p>
            </div>

            <div className="md:col-span-2">
              <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, is_active: e.target.checked }))
                  }
                  className="h-4 w-4 rounded border-slate-300"
                />
                <span>
                  <span className="font-medium text-slate-900">Active preset</span>
                  <span className="block text-xs text-slate-500">
                    Active materials appear in patient-entry material dropdowns.
                  </span>
                </span>
              </label>
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <button
              disabled={saving}
              className="inline-flex w-full items-center justify-center rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-50 sm:w-auto"
            >
              {saving ? "Saving..." : editingId ? "Update item" : "Add item"}
            </button>

            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="inline-flex w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 sm:w-auto"
              >
                Cancel
              </button>
            )}
          </div>
        </form>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm lg:p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">Saved items</h2>
              <p className="mt-1 text-sm text-slate-500">
                Search by item name, REF code, barcode, cost, sort order, or status.
              </p>
            </div>

            <div className="w-full md:max-w-sm">
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Search items
              </label>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search materials, REF, or barcode..."
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {items.length === 0 && (
              <div className="text-sm text-slate-500">No materials added yet.</div>
            )}

            {items.length > 0 && filteredItems.length === 0 && (
              <div className="text-sm text-slate-500">
                No items match your search.
              </div>
            )}

            {filteredItems.map((item) => (
              <div
                key={item.id}
                className="rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-slate-300 hover:shadow-sm"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900">{item.name}</div>

                    <div className="mt-1 text-sm text-slate-600">
                      ${formatCurrency(item.default_cost)}
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span>Sort order: {item.sort_order}</span>
                      <span
                        className={
                          item.is_active
                            ? "rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700 ring-1 ring-emerald-200"
                            : "rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-600 ring-1 ring-slate-200"
                        }
                      >
                        {item.is_active ? "Active" : "Archived"}
                      </span>
                    </div>

                    <div className="mt-3">
                      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        REF codes
                      </div>
                      <div className="mt-1 flex flex-wrap gap-2">
                        {(item.ref_codes || []).length > 0 ? (
                          item.ref_codes!.map((code) => (
                            <span
                              key={code}
                              className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700 ring-1 ring-slate-200"
                            >
                              {code}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-slate-400">None</span>
                        )}
                      </div>
                    </div>

                    <div className="mt-3">
                      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        Barcode values
                      </div>
                      <div className="mt-1 flex flex-wrap gap-2">
                        {(item.barcode_values || []).length > 0 ? (
                          item.barcode_values!.map((code) => (
                            <span
                              key={code}
                              className="rounded-full bg-blue-50 px-3 py-1 text-xs text-blue-700 ring-1 ring-blue-200"
                            >
                              {code}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-slate-400">None</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => beginEdit(item)}
                      className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                    >
                      Edit
                    </button>

                    {item.is_active ? (
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmAction(() => () => archiveItem(item));
                          setConfirmOpen(true);
                        }}
                        className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 shadow-sm transition hover:bg-red-100"
                      >
                        Archive
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => restoreItem(item)}
                        className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                      >
                        Restore
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
    </PageLayout>
  );
}