import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentUserPraktikaSessionMode } from "@/lib/praktika/hybrid-session-store";
import { praktikaHelperPost } from "@/lib/praktika/helper-job-client";

type ConfirmAppointmentInput = {
  praktikaAppointmentId: string;
  practiceId?: number;
};

export async function confirmPraktikaAppointment({
  praktikaAppointmentId,
  practiceId = 1181,
}: ConfirmAppointmentInput) {
  const mode = await getCurrentUserPraktikaSessionMode();
  const requestId = `${Date.now()}_confirm_${praktikaAppointmentId}`;

  const response = await praktikaHelperPost<any>({
    mode,
    jobType: "confirm_appointment",
    path: "/php/forms/db_commitFormData.php",
    contentType: "json",
    referer: "https://praktika.praktika.net.au/v2/scheduler",
    priority: 20,
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
