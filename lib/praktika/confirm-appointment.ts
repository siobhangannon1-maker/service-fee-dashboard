import { praktikaPost } from "@/lib/praktika/praktika-client";
import { supabaseAdmin } from "@/lib/supabase/admin";

type ConfirmAppointmentInput = {
  praktikaAppointmentId: string;
  practiceId?: number;
};

export async function confirmPraktikaAppointment({
  praktikaAppointmentId,
  practiceId = 1181,
}: ConfirmAppointmentInput) {
  const requestId = `${Date.now()}_confirm_${praktikaAppointmentId}`;

  const response = await praktikaPost<any>({
    path: "/php/forms/db_commitFormData.php",
    contentType: "json",
    referer: "https://praktika.praktika.net.au/v2/scheduler",
    body: [
      {
        request_id: requestId,
        practice_id: practiceId,
        appointment_id: Number(praktikaAppointmentId),
        appointment_arrivalstatusid: 0,
        appointment_responseid: 1,
      },
    ],
  });

  await supabaseAdmin
    .from("praktika_appointments")
    .update({
      patient_response_id: "1",
      updated_at: new Date().toISOString(),
    })
    .eq("praktika_appointment_id", praktikaAppointmentId);

  return response;
}