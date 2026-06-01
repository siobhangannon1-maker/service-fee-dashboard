import { supabaseAdmin } from "@/lib/supabase/admin";
import { TemplateMacroContext } from "@/lib/reception/render-template";

export async function buildMacroContext({
  praktikaPatientId,
  praktikaAppointmentId,
  staffName,
}: {
  praktikaPatientId?: string | null;
  praktikaAppointmentId?: string | null;
  staffName?: string | null;
}): Promise<TemplateMacroContext> {
  let patient: any = null;
  let appointment: any = null;
  let nextAppointment: any = null;

  if (praktikaPatientId) {
    const { data } = await supabaseAdmin
      .from("praktika_patients")
      .select("*")
      .eq("praktika_patient_id", praktikaPatientId)
      .maybeSingle();

    patient = data;
  }

  if (praktikaAppointmentId) {
    const { data } = await supabaseAdmin
      .from("praktika_appointments")
      .select("*")
      .eq("praktika_appointment_id", praktikaAppointmentId)
      .maybeSingle();

    appointment = data;
  }

  if (praktikaPatientId) {
    const { data } = await supabaseAdmin
      .from("praktika_appointments")
      .select("*")
      .eq("praktika_patient_id", praktikaPatientId)
      .gte("appointment_date", new Date().toISOString().slice(0, 10))
      .order("appointment_datetime", { ascending: true })
      .limit(1)
      .maybeSingle();

    nextAppointment = data;
  }

  const firstName =
    patient?.preferred_name ||
    patient?.first_name ||
    appointment?.patient_first_name ||
    "";

  const lastName = patient?.last_name || appointment?.patient_last_name || "";

  return {
    patient: {
      first_name: firstName,
      last_name: lastName,
      preferred_name: patient?.preferred_name || "",
      full_name: [firstName, lastName].filter(Boolean).join(" "),
      mobile: patient?.mobile || appointment?.patient_mobile || "",
      email: patient?.email || appointment?.patient_email || "",
      dob: patient?.dob || "",
      patient_number: patient?.praktika_patient_number || "",
    },
    appointment: appointment
      ? {
          id: appointment.praktika_appointment_id,
          date: appointment.appointment_date,
          day: appointment.appointment_day,
          time: appointment.appointment_time,
          datetime: appointment.appointment_datetime,
          type: appointment.tx_type,
          label: appointment.tx_label,
          provider: appointment.provider_name,
          resource: appointment.resource_name,
          location: appointment.mapped_location,
        }
      : {},
    next_appointment: nextAppointment
      ? {
          id: nextAppointment.praktika_appointment_id,
          date: nextAppointment.appointment_date,
          day: nextAppointment.appointment_day,
          time: nextAppointment.appointment_time,
          datetime: nextAppointment.appointment_datetime,
          type: nextAppointment.tx_type,
          label: nextAppointment.tx_label,
          provider: nextAppointment.provider_name,
          location: nextAppointment.mapped_location,
        }
      : {},
    practice: {
      name: "Focus Dental Specialists",
      phone: "",
    },
    staff: {
      full_name: staffName || "",
      first_name: staffName?.split(" ")[0] || "",
    },
  };
}