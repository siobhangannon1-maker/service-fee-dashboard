"use client";

import { useEffect, useState } from "react";
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
};

type FormState = {
  name: string;
  default_cost: string;
  sort_order: string;
  is_active: boolean;
};

const emptyForm: FormState = {
  name: "",
  default_cost: "",
  sort_order: "0",
  is_active: true,
};

export default function MaterialCostsClient() {
  const supabase = createClient();

  const [items, setItems] = useState<MaterialCostItem[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<"default" | "success" | "error">("default");
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<null | (() => void)>(null);

  async function loadItems() {
    const { data, error } = await supabase
      .from("material_cost_items")
      .select("*")
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

    setSaving(true);

    const payload = {
      name: form.name.trim(),
      default_cost: cost,
      sort_order: sortOrder,
      is_active: form.is_active,
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
    <main className="min-h-screen bg-slate-50 p-6">
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

        <h1 className="text-3xl font-semibold">Implants / Materials Cost</h1>
        <p className="mt-1 text-sm text-slate-600">
          Maintain commonly used materials and their default costs for staff.
        </p>

        {message && (
          <div className="mt-4">
            <Toast message={message} tone={tone} />
          </div>
        )}

        <form
          onSubmit={saveItem}
          className="mt-6 rounded-3xl border bg-white p-6 shadow-sm"
        >
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="lg:col-span-2">
              <label className="mb-1 block text-sm">Item name</label>
              <input
                className="w-full rounded-2xl border px-3 py-2"
                value={form.name}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, name: e.target.value }))
                }
                placeholder="Straumann Implant"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm">Default cost</label>
              <input
                type="number"
                step="0.01"
                className="w-full rounded-2xl border px-3 py-2"
                value={form.default_cost}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, default_cost: e.target.value }))
                }
                placeholder="552.40"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm">Sort order</label>
              <input
                type="number"
                className="w-full rounded-2xl border px-3 py-2"
                value={form.sort_order}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, sort_order: e.target.value }))
                }
              />
            </div>

            <div className="md:col-span-2">
              <label className="inline-flex items-center gap-2 text-sm">
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

          <div className="mt-4">
            <button
              disabled={saving}
              className="rounded-2xl bg-slate-900 px-4 py-2 text-white disabled:opacity-50"
            >
              {saving ? "Saving..." : editingId ? "Update item" : "Add item"}
            </button>

            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="ml-3 rounded-2xl border px-4 py-2"
              >
                Cancel
              </button>
            )}
          </div>
        </form>

        <div className="mt-6 rounded-3xl border bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold">Saved items</h2>

          <div className="mt-4 space-y-3">
            {items.length === 0 && (
              <div className="text-sm text-slate-500">No materials added yet.</div>
            )}

            {items.map((item) => (
              <div
                key={item.id}
                className="flex flex-col gap-3 rounded-2xl border p-4 md:flex-row md:items-center md:justify-between"
              >
                <div>
                  <div className="font-medium">{item.name}</div>
                  <div className="text-sm text-slate-600">
                    ${Number(item.default_cost).toLocaleString("en-AU", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </div>
                  <div className="text-xs text-slate-500">
                    Sort order: {item.sort_order} ·{" "}
                    {item.is_active ? "Active" : "Archived"}
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => beginEdit(item)}
                    className="rounded-xl border px-3 py-1"
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
                      className="rounded-xl border px-3 py-1 text-red-600"
                    >
                      Archive
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => restoreItem(item)}
                      className="rounded-xl border px-3 py-1"
                    >
                      Restore
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}