import Link from "next/link";
import { revalidatePath } from "next/cache";
import PageLayout from "@/components/ui/PageLayout";
import { requireRole } from "@/lib/auth";

type IntegrationRow = {
  id: string;
  provider: string;
  display_name: string;
  api_key: string | null;
  account_id: string | null;
  is_enabled: boolean;
  auto_import_calls: boolean;
  auto_transcribe_calls: boolean;
  auto_review_calls: boolean;
  disclaimer_enabled: boolean;
  disclaimer_text: string | null;
  last_tested_at: string | null;
  last_test_result: string | null;
};

async function saveMaxotelSettings(formData: FormData) {
  "use server";

  const { supabase, user } = await requireRole([
    "super_admin",
    "admin",
    "practice_manager",
  ]);

  const apiKey = String(formData.get("api_key") || "").trim();
  const existingApiKey = String(formData.get("existing_api_key") || "").trim();
  const accountId = String(formData.get("account_id") || "").trim();

  const isEnabled = formData.get("is_enabled") === "on";
  const autoImportCalls = formData.get("auto_import_calls") === "on";
  const autoTranscribeCalls = formData.get("auto_transcribe_calls") === "on";
  const autoReviewCalls = formData.get("auto_review_calls") === "on";
  const disclaimerEnabled = formData.get("disclaimer_enabled") === "on";
  const disclaimerText = String(formData.get("disclaimer_text") || "").trim();

  const finalApiKey = apiKey || existingApiKey || null;

  const { error } = await supabase
    .from("communication_integrations")
    .upsert(
      {
        provider: "maxotel",
        display_name: "MaxoTel",
        api_key: finalApiKey,
        account_id: accountId || null,
        is_enabled: isEnabled,
        auto_import_calls: autoImportCalls,
        auto_transcribe_calls: autoTranscribeCalls,
        auto_review_calls: autoReviewCalls,
        disclaimer_enabled: disclaimerEnabled,
        disclaimer_text: disclaimerText || null,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
        created_by: user.id,
      },
      {
        onConflict: "provider",
      }
    );

  if (error) throw new Error(error.message);

  await supabase.from("audit_log").insert({
    action: "communication_maxotel_settings_saved",
    entity_type: "communication_integration",
    actor_user_id: user.id,
    metadata: {
      provider: "maxotel",
      is_enabled: isEnabled,
      auto_import_calls: autoImportCalls,
      auto_transcribe_calls: autoTranscribeCalls,
      auto_review_calls: autoReviewCalls,
      disclaimer_enabled: disclaimerEnabled,
      api_key_present: Boolean(finalApiKey),
    },
  });

  revalidatePath("/communication-excellence/admin/integrations/maxotel");
}

async function testMaxotelConnection(formData: FormData) {
  "use server";

  const { supabase, user } = await requireRole([
    "super_admin",
    "admin",
    "practice_manager",
  ]);

  const integrationId = String(formData.get("integration_id") || "");

  if (!integrationId) {
    throw new Error("Integration settings must be saved before testing.");
  }

  const { data: integration, error: readError } = await supabase
    .from("communication_integrations")
    .select("*")
    .eq("id", integrationId)
    .single();

  if (readError) throw new Error(readError.message);

  const hasApiKey = Boolean(integration.api_key);

  const testResult = hasApiKey
    ? "Ready for API test. Live MaxoTel endpoint not connected yet."
    : "Missing API key.";

  const { error } = await supabase
    .from("communication_integrations")
    .update({
      last_tested_at: new Date().toISOString(),
      last_test_result: testResult,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", integrationId);

  if (error) throw new Error(error.message);

  await supabase.from("audit_log").insert({
    action: "communication_maxotel_connection_tested",
    entity_type: "communication_integration",
    entity_id: integrationId,
    actor_user_id: user.id,
    metadata: {
      provider: "maxotel",
      result: testResult,
    },
  });

  revalidatePath("/communication-excellence/admin/integrations/maxotel");
}

export default async function MaxotelSettingsPage() {
  const { supabase } = await requireRole([
    "super_admin",
    "admin",
    "practice_manager",
  ]);

  const { data, error } = await supabase
    .from("communication_integrations")
    .select("*")
    .eq("provider", "maxotel")
    .maybeSingle();

  if (error) throw new Error(error.message);

  const integration = data as IntegrationRow | null;

  return (
    <PageLayout
      eyebrow="Communication Excellence"
      title="MaxoTel Integration"
      description="Prepare call import, call review automation, disclaimer settings and future MaxoTel sync."
    >
      <section className="rounded-3xl border border-blue-200 bg-blue-50 p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">
          Integration status
        </h2>

        <div className="mt-4 grid gap-4 md:grid-cols-4">
          <StatusCard
            title="Enabled"
            value={integration?.is_enabled ? "Yes" : "No"}
          />
          <StatusCard
            title="API Key"
            value={integration?.api_key ? "Saved" : "Missing"}
          />
          <StatusCard
            title="Auto Review"
            value={integration?.auto_review_calls ? "On" : "Off"}
          />
          <StatusCard
            title="Disclaimer"
            value={integration?.disclaimer_enabled ? "On" : "Off"}
          />
        </div>

        {integration?.last_test_result ? (
          <div className="mt-5 rounded-2xl bg-white/70 p-4 text-sm text-slate-700 ring-1 ring-blue-100">
            <span className="font-semibold">Last test:</span>{" "}
            {integration.last_test_result}
            {integration.last_tested_at ? (
              <span className="ml-2 text-slate-400">
                {formatDateTime(integration.last_tested_at)}
              </span>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">
              Manual MaxoTel Import
            </h2>

            <p className="mt-2 text-sm leading-6 text-slate-500">
              Test MaxoTel-style call imports before the live API sync is connected.
            </p>
          </div>

          <Link
            href="/communication-excellence/admin/integrations/maxotel/import-call"
            className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white"
          >
            Import MaxoTel call manually
          </Link>
          <Link
  href="/communication-excellence/admin/integrations/maxotel/locations"
  className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700"
>
  Manage MaxoTel locations
</Link>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">
          MaxoTel settings
        </h2>

        <form action={saveMaxotelSettings} className="mt-5 grid gap-5">
          <input
            type="hidden"
            name="existing_api_key"
            value={integration?.api_key || ""}
          />

          <Field label="API key">
            <input
              name="api_key"
              type="password"
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
              placeholder={
                integration?.api_key
                  ? "API key already saved. Leave blank to keep existing."
                  : "Paste MaxoTel API key"
              }
            />
          </Field>

          <Field label="Account ID / tenant ID">
            <input
              name="account_id"
              defaultValue={integration?.account_id || ""}
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
              placeholder="Optional account identifier"
            />
          </Field>

          <section className="grid gap-3 rounded-2xl bg-slate-50 p-5">
            <Checkbox
              name="is_enabled"
              defaultChecked={Boolean(integration?.is_enabled)}
              label="Enable MaxoTel integration"
            />
            <Checkbox
              name="auto_import_calls"
              defaultChecked={Boolean(integration?.auto_import_calls)}
              label="Auto-import calls when sync is built"
            />
            <Checkbox
              name="auto_transcribe_calls"
              defaultChecked={Boolean(integration?.auto_transcribe_calls)}
              label="Auto-transcribe imported calls"
            />
            <Checkbox
              name="auto_review_calls"
              defaultChecked={Boolean(integration?.auto_review_calls)}
              label="Auto-review imported calls with AI"
            />
          </section>

          <section className="grid gap-4 rounded-2xl bg-blue-50 p-5">
            <Checkbox
              name="disclaimer_enabled"
              defaultChecked={Boolean(integration?.disclaimer_enabled)}
              label="Phone disclaimer/consent enabled"
            />

            <Field label="Disclaimer wording">
              <textarea
                name="disclaimer_text"
                defaultValue={
                  integration?.disclaimer_text ||
                  "Calls may be recorded and reviewed for training and quality purposes."
                }
                rows={4}
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
              />
            </Field>
          </section>

          <button className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white">
            Save settings
          </button>
        </form>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">
          Test connection
        </h2>

        <p className="mt-2 text-sm leading-6 text-slate-500">
          This currently checks that settings are saved and an API key exists.
          The live MaxoTel API test can be connected once the endpoint details
          are confirmed.
        </p>

        <form action={testMaxotelConnection} className="mt-5">
          <input
            type="hidden"
            name="integration_id"
            value={integration?.id || ""}
          />

          <button className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700">
            Test saved configuration
          </button>
        </form>
      </section>
    </PageLayout>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-2 text-sm font-medium text-slate-700">{label}</div>
      {children}
    </label>
  );
}

function Checkbox({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex items-center gap-3 text-sm font-medium text-slate-700">
      <input
        name={name}
        type="checkbox"
        defaultChecked={defaultChecked}
        className="h-4 w-4"
      />
      {label}
    </label>
  );
}

function StatusCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white/70 p-4 ring-1 ring-blue-100">
      <div className="text-xs font-semibold uppercase tracking-wide text-blue-700">
        {title}
      </div>
      <div className="mt-2 text-xl font-semibold text-slate-950">{value}</div>
    </div>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-AU", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}