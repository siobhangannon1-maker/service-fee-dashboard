import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import ResponseTemplatesClient from "./ResponseTemplatesClient";

export default async function ResponseTemplatesPage() {
  await requireRole(["super_admin"]);

  const { data, error } = await supabaseAdmin
    .from("ai_response_templates")
    .select("*")
    .order("category", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-semibold">Response Templates</h1>
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error.message}
        </div>
      </main>
    );
  }

  return <ResponseTemplatesClient initialTemplates={data || []} />;
}