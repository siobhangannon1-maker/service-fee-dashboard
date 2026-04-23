"use client";

import { useEffect, useMemo, useState } from "react";
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
    <main className="min-h-screen bg-slate-50 px-4 py-4 sm:px-6 sm:py-6">
      <div className="mx-auto max-w-5xl">
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

        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          Implants / Materials Cost
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Maintain commonly used materials, default costs, REF numbers, and barcode values.
        </p>

        {message && (
          <div className="mt-4">
            <Toast message={message} tone={tone} />
          </div>
        )}

        <form
          onSubmit={saveItem}
          className="mt-6 rounded-3xl border bg-white p-4 shadow-sm sm:p-5 lg:p-6"
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Item name
              </label>
              <input
                className="w-full rounded-2xl border px-3 py-3 text-sm"
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
                className="w-full rounded-2xl border px-3 py-3 text-sm"
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
                className="w-full rounded-2xl border px-3 py-3 text-sm"
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
                className="min-h-[140px] w-full rounded-2xl border px-3 py-3 text-sm"
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
                className="min-h-[140px] w-full rounded-2xl border px-3 py-3 text-sm"
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
              <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, is_active: e.target.checked }))
                  }
                />
                Active
              </label>
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <button
              disabled={saving}
              className="inline-flex w-full items-center justify-center rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white disabled:opacity-50 sm:w-auto"
            >
              {saving ? "Saving..." : editingId ? "Update item" : "Add item"}
            </button>

            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="inline-flex w-full items-center justify-center rounded-2xl border px-4 py-3 text-sm font-medium sm:w-auto"
              >
                Cancel
              </button>
            )}
          </div>
        </form>

        <div className="mt-6 rounded-3xl border bg-white p-4 shadow-sm sm:p-5 lg:p-6">
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
                className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-100"
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
                className="rounded-2xl border p-4"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900">{item.name}</div>

                    <div className="mt-1 text-sm text-slate-600">
                      ${Number(item.default_cost).toLocaleString("en-AU", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </div>

                    <div className="mt-1 text-xs text-slate-500">
                      Sort order: {item.sort_order} ·{" "}
                      {item.is_active ? "Active" : "Archived"}
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
                      className="rounded-xl border px-3 py-2 text-sm font-medium"
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
                        className="rounded-xl border px-3 py-2 text-sm font-medium text-red-600"
                      >
                        Archive
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => restoreItem(item)}
                        className="rounded-xl border px-3 py-2 text-sm font-medium"
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
      </div>
    </main>
  );
}