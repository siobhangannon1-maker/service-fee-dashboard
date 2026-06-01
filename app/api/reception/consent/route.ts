import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getStaffDisplayInfo } from "@/lib/reception/staff-display";
import { normalizePhone } from "@/lib/reception/phone";

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { phoneNumber, status, reason, praktikaPatientId } =
    await request.json();

  if (!phoneNumber || !["subscribed", "unsubscribed"].includes(status)) {
    return NextResponse.json(
      { error: "Phone number and valid status are required." },
      { status: 400 }
    );
  }

  const staff = await getStaffDisplayInfo(user.id);
  const normalizedPhone = normalizePhone(phoneNumber);

  const { data, error } = await supabaseAdmin
    .from("reception_sms_consent")
    .upsert(
      {
        phone_number: normalizedPhone,
        praktika_patient_id: praktikaPatientId || null,
        status,
        source: "staff_manual",
        changed_by_user_id: user.id,
        changed_by_display_name: staff.displayName,
        reason: reason || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "phone_number" }
    )
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ consent: data });
}