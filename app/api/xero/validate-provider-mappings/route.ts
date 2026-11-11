import { NextResponse } from "next/server";
import { requireActiveApiUser, ApiAuthorizationError } from "@/lib/auth";
import { xeroFetch } from "@/lib/xero";
import { validateXeroMappings } from "@/lib/billing/validate-xero-mappings";

export async function GET() {
  try {
    const { supabase } = await requireActiveApiUser(["admin", "super_admin"]);
    const providers = await supabase
      .from("providers")
      .select("id,name,xero_contact_id")
      .eq("is_active", true)
      .order("name");
    if (providers.error) throw new Error("Provider mappings unavailable.");
    const organisation = await xeroFetch("/Organisation");
    const name = organisation?.Organisations?.[0]?.Name;
    if (!name) throw new Error("Connected organisation could not be verified.");
    const mappings = await validateXeroMappings(providers.data || [], (path) =>
      xeroFetch(path),
    );
    return NextResponse.json(
      {
        success: true,
        organisationName: name,
        checkedAt: new Date().toISOString(),
        mappings,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof ApiAuthorizationError
            ? error.message
            : "Mapping validation could not be completed. Check the Xero connection and try again. No mappings were changed.",
      },
      { status: error instanceof ApiAuthorizationError ? error.status : 502 },
    );
  }
}
