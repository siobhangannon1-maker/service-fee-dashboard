"use client";

import { useEffect, useState } from "react";
import PageLayout from "@/components/ui/PageLayout";
import PageSection from "@/components/ui/PageSection";
import CollapsibleSection from "@/components/ui/CollapsibleSection";
import { createClient } from "@/lib/supabase/client";
import { calculateServiceFee } from "@/lib/calculations";

type Tier = {
  up_to: number | null;
  rate: number;
};

type Provider = {
  id: string;
  name: string;
  specialty: string;
  email: string | null;
  service_fee_percent: number;
  service_fee_type: "flat" | "tiered";
  tier_config: Tier[] | null;
  deduct_adjustments: boolean;
  deduct_incorrect_payments: boolean;
  deduct_iv_fees: boolean;
  deduct_merchant_fees: boolean;
  is_active: boolean;
  preview_fee_base?: number;
};

type NewProviderForm = {
  name: string;
  specialty: string;
  email: string;
  service_fee_percent: number;
  service_fee_type: "flat" | "tiered";
  tier_config: Tier[] | null;
  deduct_adjustments: boolean;
  deduct_incorrect_payments: boolean;
  deduct_iv_fees: boolean;
  deduct_merchant_fees: boolean;
};

const defaultTierConfig: Tier[] = [
  { up_to: 83333, rate: 50 },
  { up_to: null, rate: 30 },
];

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
      {children}
    </label>
  );
}

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
    />
  );
}

function SelectInput(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
    />
  );
}

function CheckboxField({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-slate-300"
      />
      {label}
    </label>
  );
}

function formatMoney(value: number) {
  return value.toLocaleString("en-AU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function ProvidersPage() {
  const supabase = createClient();

  const [providers, setProviders] = useState<Provider[]>([]);
  const [archivedProviders, setArchivedProviders] = useState<Provider[]>([]);
  const [message, setMessage] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const [newProvider, setNewProvider] = useState<NewProviderForm>({
    name: "",
    specialty: "",
    email: "",
    service_fee_percent: 40,
    service_fee_type: "flat",
    tier_config: defaultTierConfig,
    deduct_adjustments: false,
    deduct_incorrect_payments: false,
    deduct_iv_fees: false,
    deduct_merchant_fees: false,
  });

  async function loadProviders() {
    const { data, error } = await supabase
      .from("providers")
      .select("*")
      .eq("is_active", true)
      .order("name");

    if (error) {
      setMessage(`Error loading active providers: ${error.message}`);
      return;
    }

    setProviders((data || []) as Provider[]);
  }

  async function loadArchivedProviders() {
    const { data, error } = await supabase
      .from("providers")
      .select("*")
      .eq("is_active", false)
      .order("name");

    if (error) {
      setMessage(`Error loading archived providers: ${error.message}`);
      return;
    }

    setArchivedProviders((data || []) as Provider[]);
  }

  async function refreshAllProviders() {
    await Promise.all([loadProviders(), loadArchivedProviders()]);
  }

  useEffect(() => {
    refreshAllProviders();
  }, []);

  async function addProvider() {
    setMessage("");

    if (!newProvider.name.trim()) {
      setMessage("Please enter a provider name.");
      return;
    }

    if (!newProvider.specialty.trim()) {
      setMessage("Please enter a specialty.");
      return;
    }

    setIsAdding(true);

    const { error } = await supabase.from("providers").insert({
      name: newProvider.name.trim(),
      specialty: newProvider.specialty.trim(),
      email: newProvider.email.trim() ? newProvider.email.trim() : null,
      service_fee_percent: newProvider.service_fee_percent,
      service_fee_type: newProvider.service_fee_type,
      tier_config:
        newProvider.service_fee_type === "tiered"
          ? newProvider.tier_config
          : null,
      deduct_adjustments: newProvider.deduct_adjustments,
      deduct_incorrect_payments: newProvider.deduct_incorrect_payments,
      deduct_iv_fees: newProvider.deduct_iv_fees,
      deduct_merchant_fees: newProvider.deduct_merchant_fees,
      is_active: true,
    });

    setIsAdding(false);

    if (error) {
      setMessage(`Add failed: ${error.message}`);
      return;
    }

    setMessage("Provider added successfully.");

    setNewProvider({
      name: "",
      specialty: "",
      email: "",
      service_fee_percent: 40,
      service_fee_type: "flat",
      tier_config: defaultTierConfig,
      deduct_adjustments: false,
      deduct_incorrect_payments: false,
      deduct_iv_fees: false,
      deduct_merchant_fees: false,
    });

    refreshAllProviders();
  }

  async function saveProvider(provider: Provider) {
    const { error } = await supabase
      .from("providers")
      .update({
        name: provider.name,
        specialty: provider.specialty,
        email: provider.email?.trim() ? provider.email.trim() : null,
        service_fee_percent: provider.service_fee_percent,
        service_fee_type: provider.service_fee_type,
        tier_config:
          provider.service_fee_type === "tiered" ? provider.tier_config : null,
        deduct_adjustments: provider.deduct_adjustments,
        deduct_incorrect_payments: provider.deduct_incorrect_payments,
        deduct_iv_fees: provider.deduct_iv_fees,
        deduct_merchant_fees: provider.deduct_merchant_fees,
      })
      .eq("id", provider.id);

    if (error) {
      setMessage(`Save failed: ${error.message}`);
      return;
    }

    setMessage(`Saved ${provider.name}.`);
    refreshAllProviders();
  }

  async function archiveProvider(provider: Provider) {
    const confirmed = window.confirm(
      `Archive provider "${provider.name}"? Historical data will stay intact.`
    );

    if (!confirmed) return;

    setArchivingId(provider.id);
    setMessage("");

    const { data, error } = await supabase
      .from("providers")
      .update({ is_active: false })
      .eq("id", provider.id)
      .select("id, name, is_active");

    setArchivingId(null);

    if (error) {
      setMessage(
        `Archive failed: ${error.message} | code: ${
          error.code ?? "none"
        } | details: ${error.details ?? "none"} | hint: ${
          error.hint ?? "none"
        }`
      );
      return;
    }

    if (!data || data.length === 0) {
      setMessage(
        "Archive failed: no row was updated. This usually means Row Level Security is blocking the update."
      );
      return;
    }

    setMessage(`Provider "${provider.name}" archived.`);
    refreshAllProviders();
  }

  async function restoreProvider(provider: Provider) {
    const confirmed = window.confirm(
      `Restore provider "${provider.name}" to the active list?`
    );

    if (!confirmed) return;

    setRestoringId(provider.id);
    setMessage("");

    const { data, error } = await supabase
      .from("providers")
      .update({ is_active: true })
      .eq("id", provider.id)
      .select("id, name, is_active");

    setRestoringId(null);

    if (error) {
      setMessage(
        `Restore failed: ${error.message} | code: ${
          error.code ?? "none"
        } | details: ${error.details ?? "none"} | hint: ${
          error.hint ?? "none"
        }`
      );
      return;
    }

    if (!data || data.length === 0) {
      setMessage(
        "Restore failed: no row was updated. This usually means Row Level Security is blocking the update."
      );
      return;
    }

    setMessage(`Provider "${provider.name}" restored.`);
    refreshAllProviders();
  }

  function updateProvider(id: string, patch: Partial<Provider>) {
    setProviders((prev) =>
      prev.map((provider) =>
        provider.id === id ? { ...provider, ...patch } : provider
      )
    );
  }

  return (
    <PageLayout
      eyebrow="Admin"
      title="Providers"
      description="Manage provider profiles, service fee formulas, deductions, and archived providers."
    >
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-950 shadow-sm">
        <div className="bg-gradient-to-br from-slate-950 via-blue-950 to-blue-700 px-6 py-7">
          <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr] lg:items-end">
            <div>
              <div className="inline-flex rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white/80">
                Provider setup
              </div>

              <h2 className="mt-4 text-2xl font-semibold tracking-tight text-white md:text-3xl">
                Keep provider records clean, accurate, and ready for service fee
                reporting.
              </h2>

              <p className="mt-3 max-w-2xl text-sm leading-6 text-white/75">
                Active providers appear throughout the dashboard. Archived
                providers are hidden from normal lists but can be restored.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/20 bg-white/10 p-4 text-white">
                <div className="text-xs uppercase tracking-wide text-white/70">
                  Active
                </div>
                <div className="mt-2 text-3xl font-semibold">
                  {providers.length}
                </div>
              </div>

              <div className="rounded-2xl border border-white/20 bg-white/10 p-4 text-white">
                <div className="text-xs uppercase tracking-wide text-white/70">
                  Archived
                </div>
                <div className="mt-2 text-3xl font-semibold">
                  {archivedProviders.length}
                </div>
              </div>

              <div className="rounded-2xl border border-white/20 bg-white/10 p-4 text-white">
                <div className="text-xs uppercase tracking-wide text-white/70">
                  Total
                </div>
                <div className="mt-2 text-3xl font-semibold">
                  {providers.length + archivedProviders.length}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {message && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
          {message}
        </div>
      )}

      <PageSection
        title="Add new provider"
        description="Create a new active provider and configure their service fee rules."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <FieldLabel>Provider name</FieldLabel>
            <TextInput
              value={newProvider.name}
              onChange={(e) =>
                setNewProvider((prev) => ({ ...prev, name: e.target.value }))
              }
              placeholder="Dr Jane Smith"
            />
          </div>

          <div>
            <FieldLabel>Specialty</FieldLabel>
            <TextInput
              value={newProvider.specialty}
              onChange={(e) =>
                setNewProvider((prev) => ({
                  ...prev,
                  specialty: e.target.value,
                }))
              }
              placeholder="Periodontist"
            />
          </div>

          <div className="md:col-span-2">
            <FieldLabel>Email address</FieldLabel>
            <TextInput
              type="email"
              value={newProvider.email}
              onChange={(e) =>
                setNewProvider((prev) => ({ ...prev, email: e.target.value }))
              }
              placeholder="dr.jane@example.com"
            />
          </div>

          <div>
            <FieldLabel>Service fee type</FieldLabel>
            <SelectInput
              value={newProvider.service_fee_type}
              onChange={(e) =>
                setNewProvider((prev) => ({
                  ...prev,
                  service_fee_type: e.target.value as "flat" | "tiered",
                }))
              }
            >
              <option value="flat">Flat</option>
              <option value="tiered">Tiered</option>
            </SelectInput>
          </div>

          {newProvider.service_fee_type === "flat" ? (
            <div>
              <FieldLabel>Flat service fee %</FieldLabel>
              <TextInput
                type="number"
                value={newProvider.service_fee_percent}
                onChange={(e) =>
                  setNewProvider((prev) => ({
                    ...prev,
                    service_fee_percent: Number(e.target.value) || 0,
                  }))
                }
              />
            </div>
          ) : (
            <div className="md:col-span-2">
              <FieldLabel>Tier config JSON</FieldLabel>
              <textarea
                className="min-h-[130px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-mono text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                value={JSON.stringify(
                  newProvider.tier_config || defaultTierConfig,
                  null,
                  2
                )}
                onChange={(e) => {
                  try {
                    const parsed = JSON.parse(e.target.value);
                    setNewProvider((prev) => ({
                      ...prev,
                      tier_config: parsed,
                    }));
                  } catch {
                    // Leave unsaved until valid JSON
                  }
                }}
              />
            </div>
          )}

          <CheckboxField
            checked={newProvider.deduct_adjustments}
            onChange={(checked) =>
              setNewProvider((prev) => ({
                ...prev,
                deduct_adjustments: checked,
              }))
            }
            label="Deduct adjustments"
          />

          <CheckboxField
            checked={newProvider.deduct_incorrect_payments}
            onChange={(checked) =>
              setNewProvider((prev) => ({
                ...prev,
                deduct_incorrect_payments: checked,
              }))
            }
            label="Deduct incorrect payments"
          />

          <CheckboxField
            checked={newProvider.deduct_iv_fees}
            onChange={(checked) =>
              setNewProvider((prev) => ({ ...prev, deduct_iv_fees: checked }))
            }
            label="Deduct IV facility fees"
          />

          <CheckboxField
            checked={newProvider.deduct_merchant_fees}
            onChange={(checked) =>
              setNewProvider((prev) => ({
                ...prev,
                deduct_merchant_fees: checked,
              }))
            }
            label="Deduct merchant fees"
          />
        </div>

        <div className="mt-5">
          <button
            onClick={addProvider}
            disabled={isAdding}
            className="inline-flex items-center justify-center rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-50"
          >
            {isAdding ? "Adding..." : "Add provider"}
          </button>
        </div>
      </PageSection>

      <PageSection
        title={`Active providers (${providers.length})`}
        description="Edit provider details and save changes individually."
      >
        {providers.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-600">
            No active providers found.
          </div>
        ) : (
          <div className="space-y-5">
            {providers.map((provider) => (
              <div
                key={provider.id}
                className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className="flex flex-col gap-2 border-b border-slate-100 pb-4 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-950">
                      {provider.name || "Unnamed provider"}
                    </h3>
                    <p className="mt-1 text-sm text-slate-500">
                      {provider.specialty || "No specialty"} ·{" "}
                      {provider.email || "No email"}
                    </p>
                  </div>

                  <span className="w-fit rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                    Active
                  </span>
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <div>
                    <FieldLabel>Provider name</FieldLabel>
                    <TextInput
                      value={provider.name}
                      onChange={(e) =>
                        updateProvider(provider.id, { name: e.target.value })
                      }
                    />
                  </div>

                  <div>
                    <FieldLabel>Specialty</FieldLabel>
                    <TextInput
                      value={provider.specialty}
                      onChange={(e) =>
                        updateProvider(provider.id, {
                          specialty: e.target.value,
                        })
                      }
                    />
                  </div>

                  <div className="md:col-span-2">
                    <FieldLabel>Email address</FieldLabel>
                    <TextInput
                      type="email"
                      value={provider.email || ""}
                      onChange={(e) =>
                        updateProvider(provider.id, { email: e.target.value })
                      }
                      placeholder="dr.jane@example.com"
                    />
                  </div>

                  <div>
                    <FieldLabel>Service fee type</FieldLabel>
                    <SelectInput
                      value={provider.service_fee_type}
                      onChange={(e) =>
                        updateProvider(provider.id, {
                          service_fee_type: e.target.value as "flat" | "tiered",
                        })
                      }
                    >
                      <option value="flat">Flat</option>
                      <option value="tiered">Tiered</option>
                    </SelectInput>
                  </div>

                  {provider.service_fee_type === "flat" ? (
                    <div>
                      <FieldLabel>Flat service fee %</FieldLabel>
                      <TextInput
                        type="number"
                        value={provider.service_fee_percent}
                        onChange={(e) =>
                          updateProvider(provider.id, {
                            service_fee_percent: Number(e.target.value) || 0,
                          })
                        }
                      />
                    </div>
                  ) : (
                    <div className="md:col-span-2">
                      <FieldLabel>Tier config JSON</FieldLabel>
                      <textarea
                        className="min-h-[130px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-mono text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                        value={JSON.stringify(
                          provider.tier_config || defaultTierConfig,
                          null,
                          2
                        )}
                        onChange={(e) => {
                          try {
                            const parsed = JSON.parse(e.target.value);
                            updateProvider(provider.id, {
                              tier_config: parsed,
                            });
                          } catch {
                            // Leave unsaved until valid JSON
                          }
                        }}
                      />
                    </div>
                  )}

                  <div>
                    <FieldLabel>Preview fee base</FieldLabel>
                    <TextInput
                      type="number"
                      value={provider.preview_fee_base || 0}
                      onChange={(e) =>
                        updateProvider(provider.id, {
                          preview_fee_base: Number(e.target.value) || 0,
                        })
                      }
                    />
                  </div>

                  <CheckboxField
                    checked={provider.deduct_adjustments}
                    onChange={(checked) =>
                      updateProvider(provider.id, {
                        deduct_adjustments: checked,
                      })
                    }
                    label="Deduct adjustments"
                  />

                  <CheckboxField
                    checked={provider.deduct_incorrect_payments}
                    onChange={(checked) =>
                      updateProvider(provider.id, {
                        deduct_incorrect_payments: checked,
                      })
                    }
                    label="Deduct incorrect payments"
                  />

                  <CheckboxField
                    checked={provider.deduct_iv_fees}
                    onChange={(checked) =>
                      updateProvider(provider.id, { deduct_iv_fees: checked })
                    }
                    label="Deduct IV facility fees"
                  />

                  <CheckboxField
                    checked={provider.deduct_merchant_fees}
                    onChange={(checked) =>
                      updateProvider(provider.id, {
                        deduct_merchant_fees: checked,
                      })
                    }
                    label="Deduct merchant fees"
                  />
                </div>

                <div className="mt-5 rounded-2xl border border-blue-100 bg-blue-50 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-blue-800">
                    Calculated service fee preview
                  </div>
                  <div className="mt-1 text-3xl font-semibold text-slate-950">
                    $
                    {formatMoney(
                      calculateServiceFee(
                        provider,
                        provider.preview_fee_base || 0
                      )
                    )}
                  </div>
                </div>

                <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                  <button
                    onClick={() => saveProvider(provider)}
                    className="inline-flex items-center justify-center rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
                  >
                    Save provider
                  </button>

                  <button
                    onClick={() => archiveProvider(provider)}
                    disabled={archivingId === provider.id}
                    className="inline-flex items-center justify-center rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:opacity-50"
                  >
                    {archivingId === provider.id
                      ? "Archiving..."
                      : "Archive provider"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </PageSection>

      <CollapsibleSection
        title={`Archived providers (${archivedProviders.length})`}
        description="Providers hidden from the active list. Historical data remains intact."
      >
        {archivedProviders.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-600">
            No archived providers found.
          </div>
        ) : (
          <div className="space-y-4">
            {archivedProviders.map((provider) => (
              <div
                key={provider.id}
                className="rounded-2xl border border-slate-200 bg-slate-50 p-5"
              >
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="text-base font-semibold text-slate-950">
                      {provider.name}
                    </div>
                    <div className="mt-1 text-sm text-slate-600">
                      {provider.specialty}
                    </div>
                    <div className="text-sm text-slate-500">
                      {provider.email || "No email address"}
                    </div>
                    <div className="mt-2 text-xs text-slate-500">
                      Service fee type:{" "}
                      <span className="font-medium">
                        {provider.service_fee_type}
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={() => restoreProvider(provider)}
                    disabled={restoringId === provider.id}
                    className="inline-flex items-center justify-center rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {restoringId === provider.id
                      ? "Restoring..."
                      : "Restore provider"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CollapsibleSection>
    </PageLayout>
  );
}