import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: Request) {
  const formData = await request.formData();

  const xeroEmployeeId = String(formData.get("xero_employee_id") || "");
  const xeroEmployeeName = String(formData.get("xero_employee_name") || "");
  const connecteamUserId = String(formData.get("connecteam_user_id") || "");

  if (!xeroEmployeeId || !xeroEmployeeName || !connecteamUserId) {
    return NextResponse.json(
      { error: "Missing required mapping fields" },
      { status: 400 }
    );
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: connecteamUser, error: userError } = await supabase
    .from("connecteam_users")
    .select("display_name, email")
    .eq("connecteam_user_id", connecteamUserId)
    .single();

  if (userError) {
    return NextResponse.json({ error: userError.message }, { status: 500 });
  }

  const connecteamUserName =
    connecteamUser?.display_name || connecteamUser?.email || connecteamUserId;

  await supabase
    .from("employee_mapping")
    .update({ is_active: false })
    .eq("xero_employee_id", xeroEmployeeId);

  const { error } = await supabase.from("employee_mapping").insert({
    xero_employee_id: xeroEmployeeId,
    xero_employee_name: xeroEmployeeName,
    connecteam_user_id: connecteamUserId,
    connecteam_user_name: connecteamUserName,
    is_active: true,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.redirect(
    new URL("/practice-manager/employee-mapping", request.url)
  );
}