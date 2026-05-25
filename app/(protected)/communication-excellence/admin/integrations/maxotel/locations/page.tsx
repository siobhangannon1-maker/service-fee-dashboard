import { revalidatePath } from "next/cache";
import Link from "next/link";
import PageLayout from "@/components/ui/PageLayout";
import { requireRole } from "@/lib/auth";

type ProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
};

type MappingRow = {
  id: string;
  extension_name: string;
  extension_number: string | null;
  location_name: string;
  department: string | null;
  default_review_category: string | null;
  import_enabled: boolean;
  fallback_user_id: string | null;
  notes: string | null;
};

async function createLocationMapping(formData: FormData) {
  "use server";

  const { supabase, user } = await requireRole([
    "super_admin",
    "admin",
    "practice_manager",
  ]);

  const extensionName = String(formData.get("extension_name") || "").trim();
  const extensionNumber = String(formData.get("extension_number") || "").trim();
  const locationName = String(formData.get("location_name") || "").trim();
  const department = String(formData.get("department") || "").trim();
  const defaultReviewCategory = String(
    formData.get("default_review_category") || ""
  ).trim();
  const fallbackUserId = String(formData.get("fallback_user_id") || "").trim();
  const notes = String(formData.get("notes") || "").trim();
  const importEnabled = formData.get("import_enabled") === "on";

  if (!extensionName || !locationName) {
    throw new Error("Extension name and location name are required.");
  }

  const { error } = await supabase
    .from("communication_maxotel_location_mappings")
    .insert({
      extension_name: extensionName,
      extension_number: extensionNumber || null,
      location_name: locationName,
      department: department || null,
      default_review_category: defaultReviewCategory || null,
      import_enabled: importEnabled,
      fallback_user_id: fallbackUserId || null,
      notes: notes || null,
      created_by: user.id,
      updated_by: user.id,
    });

  if (error) throw new Error(error.message);

  await supabase.from("audit_log").insert({
    action: "communication_maxotel_location_mapping_created",
    entity_type: "communication_maxotel_location_mapping",
    actor_user_id: user.id,
    metadata: {
      extension_name: extensionName,
      extension_number: extensionNumber || null,
      location_name: locationName,
      department: department || null,
      import_enabled: importEnabled,
    },
  });

  revalidatePath("/communication-excellence/admin/integrations/maxotel/locations");
}

async function updateLocationMapping(formData: FormData) {
  "use server";

  const { supabase, user } = await requireRole([
    "super_admin",
    "admin",
    "practice_manager",
  ]);

  const mappingId = String(formData.get("mapping_id") || "");
  const extensionName = String(formData.get("extension_name") || "").trim();
  const extensionNumber = String(formData.get("extension_number") || "").trim();
  const locationName = String(formData.get("location_name") || "").trim();
  const department = String(formData.get("department") || "").trim();
  const defaultReviewCategory = String(
    formData.get("default_review_category") || ""
  ).trim();
  const fallbackUserId = String(formData.get("fallback_user_id") || "").trim();
  const notes = String(formData.get("notes") || "").trim();
  const importEnabled = formData.get("import_enabled") === "on";

  if (!mappingId || !extensionName || !locationName) {
    throw new Error("Mapping, extension name and location name are required.");
  }

  const { error } = await supabase
    .from("communication_maxotel_location_mappings")
    .update({
      extension_name: extensionName,
      extension_number: extensionNumber || null,
      location_name: locationName,
      department: department || null,
      default_review_category: defaultReviewCategory || null,
      import_enabled: importEnabled,
      fallback_user_id: fallbackUserId || null,
      notes: notes || null,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", mappingId);

  if (error) throw new Error(error.message);

  await supabase.from("audit_log").insert({
    action: "communication_maxotel_location_mapping_updated",
    entity_type: "communication_maxotel_location_mapping",
    entity_id: mappingId,
    actor_user_id: user.id,
    metadata: {
      extension_name: extensionName,
      extension_number: extensionNumber || null,
      location_name: locationName,
      department: department || null,
      import_enabled: importEnabled,
    },
  });

  revalidatePath("/communication-excellence/admin/integrations/maxotel/locations");
}

export default async function MaxotelLocationMappingsPage() {
  const { supabase } = await requireRole([
    "super_admin",
    "admin",
    "practice_manager",
  ]);

  const [profilesResult, mappingsResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, email")
      .order("full_name", { ascending: true }),

    supabase
      .from("communication_maxotel_location_mappings")
      .select("*")
      .order("location_name", { ascending: true }),
  ]);

  if (profilesResult.error) throw new Error(profilesResult.error.message);
  if (mappingsResult.error) throw new Error(mappingsResult.error.message);

  const profiles = (profilesResult.data ?? []) as ProfileRow[];
  const mappings = (mappingsResult.data ?? []) as MappingRow[];
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));

  return (
    <PageLayout
      eyebrow="Communication Excellence"
      title="MaxoTel Location Mappings"
      description="Map MaxoTel extensions or phone locations to practice areas before live call sync."
    >
      <div className="flex flex-wrap gap-3">
        <Link
          href="/communication-excellence/admin/integrations/maxotel"
          className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
        >
          ← Back to MaxoTel settings
        </Link>

        <Link
          href="/communication-excellence/admin/integrations/maxotel/import-call"
          className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
        >
          Import test call
        </Link>
      </div>

      <section className="rounded-3xl border border-blue-200 bg-blue-50 p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">
          Why locations instead of staff?
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-700">
          Your MaxoTel extensions are location-based, so calls should first map
          to a desk, room, branch or department. Staff assignment can stay
          optional until you know who handled the call.
        </p>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">
          Add location mapping
        </h2>

        <form action={createLocationMapping} className="mt-5 grid gap-5">
          <MappingFields profiles={profiles} />

          <button className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white">
            Add mapping
          </button>
        </form>
      </section>

      <section className="space-y-4">
        {mappings.length === 0 ? (
          <EmptyState text="No MaxoTel location mappings yet." />
        ) : (
          mappings.map((mapping) => {
            const fallbackUser = mapping.fallback_user_id
              ? profileById.get(mapping.fallback_user_id)
              : null;

            return (
              <section
                key={mapping.id}
                className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
              >
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-950">
                      {mapping.location_name}
                    </h2>

                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge label={mapping.extension_name} />
                      {mapping.extension_number ? (
                        <Badge label={`Ext ${mapping.extension_number}`} />
                      ) : null}
                      {mapping.department ? (
                        <Badge label={mapping.department} />
                      ) : null}
                      <Badge
                        label={mapping.import_enabled ? "Import on" : "Import off"}
                      />
                    </div>

                    {fallbackUser ? (
                      <p className="mt-3 text-sm text-slate-500">
                        Fallback staff:{" "}
                        {fallbackUser.full_name || fallbackUser.email}
                      </p>
                    ) : null}
                  </div>
                </div>

                <form action={updateLocationMapping} className="mt-6 grid gap-5">
                  <input type="hidden" name="mapping_id" value={mapping.id} />

                  <MappingFields
                    profiles={profiles}
                    mapping={mapping}
                  />

                  <button className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700">
                    Save mapping
                  </button>
                </form>
              </section>
            );
          })
        )}
      </section>
    </PageLayout>
  );
}

function MappingFields({
  profiles,
  mapping,
}: {
  profiles: ProfileRow[];
  mapping?: MappingRow;
}) {
  return (
    <>
      <section className="grid gap-4 md:grid-cols-2">
        <Field label="MaxoTel extension/location name">
          <input
            name="extension_name"
            defaultValue={mapping?.extension_name || ""}
            required
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
            placeholder="Example: Reception Desk 1"
          />
        </Field>

        <Field label="Extension number">
          <input
            name="extension_number"
            defaultValue={mapping?.extension_number || ""}
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
            placeholder="Example: 101"
          />
        </Field>

        <Field label="Practice location / area">
          <input
            name="location_name"
            defaultValue={mapping?.location_name || ""}
            required
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
            placeholder="Example: Main Reception"
          />
        </Field>

        <Field label="Department">
          <input
            name="department"
            defaultValue={mapping?.department || ""}
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
            placeholder="Example: Front office"
          />
        </Field>

        <Field label="Default review category">
          <select
            name="default_review_category"
            defaultValue={mapping?.default_review_category || ""}
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
          >
            <option value="">None</option>
            <option value="phone_skills">Phone Skills</option>
            <option value="nervous_patients">Nervous Patients</option>
            <option value="cost_conversations">Cost Conversations</option>
            <option value="complaints">Complaints</option>
            <option value="referrals">Referrals</option>
            <option value="surgical_communication">
              Surgical Communication
            </option>
            <option value="general">General</option>
          </select>
        </Field>

        <Field label="Fallback staff member optional">
          <select
            name="fallback_user_id"
            defaultValue={mapping?.fallback_user_id || ""}
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
          >
            <option value="">No fallback staff</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.full_name || profile.email}
              </option>
            ))}
          </select>
        </Field>
      </section>

      <Field label="Notes">
        <textarea
          name="notes"
          defaultValue={mapping?.notes || ""}
          rows={3}
          className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
          placeholder="Example: Used by reception team, not linked to one specific staff member."
        />
      </Field>

      <label className="flex items-center gap-3 rounded-2xl bg-slate-50 p-4 text-sm font-medium text-slate-700">
        <input
          name="import_enabled"
          type="checkbox"
          defaultChecked={mapping ? mapping.import_enabled : true}
          className="h-4 w-4"
        />
        Import calls from this MaxoTel location when sync is connected
      </label>
    </>
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

function Badge({ label }: { label: string }) {
  return (
    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold capitalize text-slate-600">
      {label}
    </span>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
      {text}
    </div>
  );
}