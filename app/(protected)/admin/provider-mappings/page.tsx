import { redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { ProviderMappingForm } from "./provider-mapping-form";
import { createProviderNameMapping } from "./actions";

type ProviderRow = {
  id: string;
  name: string | null;
};

type PageProps = {
  searchParams?: {
    status?: string;
    message?: string;
  };
};

function getServiceRoleSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  }

  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

export default async function AdminProviderMappingsPage({ searchParams }: PageProps) {
  const supabase = getServiceRoleSupabaseClient();

  const { data, error } = await supabase
    .from("providers")
    .select("id, name")
    .order("name", { ascending: true });

  if (error) {
    throw new Error(`Failed to load providers: ${error.message}`);
  }

  const providers = ((data ?? []) as ProviderRow[]).map((provider) => ({
    id: provider.id,
    name: provider.name ?? "Unnamed provider",
  }));

  async function saveMappingAction(formData: FormData) {
    "use server";

    const result = await createProviderNameMapping(formData);

    const params = new URLSearchParams();
    params.set("status", result.ok ? "success" : "error");
    params.set("message", result.message || "");

    redirect(`/admin/provider-mappings?${params.toString()}`);
  }

  const status = searchParams?.status ?? "";
  const message = searchParams?.message ?? "";

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight text-gray-900">
            Provider Name Mappings
          </h1>
          <p className="mt-2 text-sm text-gray-600">
            Create mappings from raw CSV provider names to your existing providers.
          </p>
        </div>

        <form action={saveMappingAction}>
          <ProviderMappingForm providers={providers} />
        </form>

        {message ? (
          <div
            className={[
              "mt-6 rounded-2xl border p-4 text-sm",
              status === "success"
                ? "border-green-200 bg-green-50 text-green-800"
                : "border-red-200 bg-red-50 text-red-800",
            ].join(" ")}
          >
            {message}
          </div>
        ) : null}
      </div>
    </main>
  );
}