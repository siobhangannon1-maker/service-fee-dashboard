import { supabaseAdmin } from "@/lib/supabase/admin";

type AppointmentLike = {
  tx_type?: string | null;
  tx_label?: string | null;
  appointment_notes?: string | null;
  resource_name?: string | null;
  provider_name?: string | null;
};

function getValueForField(appointment: AppointmentLike, field: string): string {
  if (field === "tx_type") return appointment.tx_type || "";
  if (field === "tx_label") return appointment.tx_label || "";
  if (field === "appointment_notes") return appointment.appointment_notes || "";
  if (field === "resource_name") return appointment.resource_name || "";
  if (field === "provider_name") return appointment.provider_name || "";
  return "";
}

function ruleMatches(value: string, matchType: string, matchValue: string) {
  const cleanValue = value.toLowerCase();
  const cleanMatch = matchValue.toLowerCase();

  if (matchType === "equals") return cleanValue === cleanMatch;
  if (matchType === "starts_with") return cleanValue.startsWith(cleanMatch);
  return cleanValue.includes(cleanMatch);
}

export async function resolveAppointmentLocation(appointment: AppointmentLike) {
  const { data: rules, error } = await supabaseAdmin
    .from("praktika_location_rules")
    .select("*")
    .eq("is_active", true)
    .order("priority", { ascending: true });

  if (error) throw new Error(error.message);

  for (const rule of rules || []) {
    const value = getValueForField(appointment, rule.match_field);

    if (ruleMatches(value, rule.match_type, rule.match_value)) {
      return {
        locationName: rule.location_name as string,
        ruleId: rule.id as string,
      };
    }
  }

  return {
    locationName: "Focus Dental Specialists",
    ruleId: null,
  };
}