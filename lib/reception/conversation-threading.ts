import { supabaseAdmin } from "@/lib/supabase/admin";

export function normalizeReceptionPhone(value: string | null | undefined) {
  return String(value || "").replace(/\s+/g, "");
}

export function normaliseNamePart(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

export function buildPatientThreadLabel({
  firstName,
  lastName,
  mobile,
}: {
  firstName?: string | null;
  lastName?: string | null;
  mobile?: string | null;
}) {
  return {
    firstName: String(firstName || "").trim() || null,
    lastName: String(lastName || "").trim() || null,
    mobile: normalizeReceptionPhone(mobile),
  };
}

type FindOrCreateConversationInput = {
  patientMobile: string;
  patientFirstName?: string | null;
  patientLastName?: string | null;
  praktikaPatientId?: string | null;
  praktikaAppointmentId?: string | null;
  assignedUserId?: string | null;
  assignedDisplayName?: string | null;
  workflowStatus?: string | null;
  lastMessagePreview?: string | null;
};

export async function findExistingPatientConversation({
  patientMobile,
  patientFirstName,
  patientLastName,
  praktikaPatientId,
}: {
  patientMobile: string;
  patientFirstName?: string | null;
  patientLastName?: string | null;
  praktikaPatientId?: string | null;
}) {
  const mobile = normalizeReceptionPhone(patientMobile);
  const firstName = normaliseNamePart(patientFirstName);
  const lastName = normaliseNamePart(patientLastName);

  if (!mobile && !praktikaPatientId) return null;

  // Best match: same Praktika patient ID. This safely separates family members
  // sharing the same mobile.
  if (praktikaPatientId) {
    const { data } = await supabaseAdmin
      .from("reception_conversations")
      .select("*")
      .eq("praktika_patient_id", String(praktikaPatientId))
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data) return data;
  }

  // Second best: same mobile AND same patient name.
  // This is the key change for shared family numbers.
  if (mobile && (firstName || lastName)) {
    let query = supabaseAdmin
      .from("reception_conversations")
      .select("*")
      .eq("patient_mobile", mobile);

    if (firstName) {
      query = query.ilike("patient_first_name", firstName);
    }

    if (lastName) {
      query = query.ilike("patient_last_name", lastName);
    }

    const { data } = await query
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data) return data;
  }

  return null;
}

export async function findOrCreatePatientConversation({
  patientMobile,
  patientFirstName,
  patientLastName,
  praktikaPatientId,
  praktikaAppointmentId,
  assignedUserId,
  assignedDisplayName,
  workflowStatus = "general",
  lastMessagePreview = "Conversation started",
}: FindOrCreateConversationInput) {
  const mobile = normalizeReceptionPhone(patientMobile);
  const firstName = String(patientFirstName || "").trim() || null;
  const lastName = String(patientLastName || "").trim() || null;

  if (!mobile) {
    throw new Error("Patient mobile is required to create a conversation.");
  }

  const existing = await findExistingPatientConversation({
    patientMobile: mobile,
    patientFirstName: firstName,
    patientLastName: lastName,
    praktikaPatientId,
  });

  if (existing) {
    const updatePayload: any = {
      status: "open",
      updated_at: new Date().toISOString(),
    };

    if (firstName && !existing.patient_first_name) {
      updatePayload.patient_first_name = firstName;
    }

    if (lastName && !existing.patient_last_name) {
      updatePayload.patient_last_name = lastName;
    }

    if (praktikaPatientId && !existing.praktika_patient_id) {
      updatePayload.praktika_patient_id = String(praktikaPatientId);
    }

    // Keep the thread as one patient thread but allow the currently relevant
    // appointment to update as staff links/sends confirmations/questionnaires.
    if (praktikaAppointmentId) {
      updatePayload.praktika_appointment_id = String(praktikaAppointmentId);
    }

    if (assignedUserId && !existing.assigned_user_id) {
      updatePayload.assigned_user_id = assignedUserId;
    }

    if (assignedDisplayName && !existing.assigned_display_name) {
      updatePayload.assigned_display_name = assignedDisplayName;
    }

    const { data, error } = await supabaseAdmin
      .from("reception_conversations")
      .update(updatePayload)
      .eq("id", existing.id)
      .select("*")
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return {
      conversation: data,
      created: false,
    };
  }

  const { data, error } = await supabaseAdmin
    .from("reception_conversations")
    .insert({
      status: "open",
      workflow_status: workflowStatus || "general",
      is_urgent: false,
      unread_count: 0,
      praktika_patient_id: praktikaPatientId ? String(praktikaPatientId) : null,
      praktika_appointment_id: praktikaAppointmentId
        ? String(praktikaAppointmentId)
        : null,
      patient_first_name: firstName,
      patient_last_name: lastName,
      patient_mobile: mobile,
      assigned_user_id: assignedUserId || null,
      assigned_display_name: assignedDisplayName || null,
      last_message_preview: lastMessagePreview || "Conversation started",
      last_message_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Could not create conversation.");
  }

  await supabaseAdmin.from("reception_audit_logs").insert({
    conversation_id: data.id,
    actor_user_id: assignedUserId || null,
    actor_display_name: assignedDisplayName || null,
    action: "conversation_created",
    details: {
      reason: "Created by patient name/mobile thread matching.",
      praktika_patient_id: praktikaPatientId || null,
      praktika_appointment_id: praktikaAppointmentId || null,
      patient_first_name: firstName,
      patient_last_name: lastName,
      patient_mobile: mobile,
    },
  });

  return {
    conversation: data,
    created: true,
  };
}

export async function findBestInboundConversationForMobile({
  patientMobile,
  isPossibleConfirmationReply,
}: {
  patientMobile: string;
  isPossibleConfirmationReply: boolean;
}) {
  const mobile = normalizeReceptionPhone(patientMobile);

  const { data: conversations } = await supabaseAdmin
    .from("reception_conversations")
    .select("*")
    .eq("patient_mobile", mobile)
    .order("updated_at", { ascending: false })
    .limit(20);

  const allConversations = conversations || [];

  if (allConversations.length === 0) {
    return {
      conversation: null,
      pendingRequests: [],
      allConversations,
    };
  }

  if (isPossibleConfirmationReply) {
    const conversationIds = allConversations.map((conversation) => conversation.id);

    const { data: pendingRequests } = await supabaseAdmin
      .from("reception_messages")
      .select("*")
      .eq("direction", "outbound")
      .eq("confirmation_intent", "appointment_confirmation_request")
      .not("praktika_appointment_id", "is", null)
      .in("conversation_id", conversationIds)
      .order("created_at", { ascending: false })
      .limit(20);

    const allRequests = pendingRequests || [];
    const unresponded = allRequests.filter(
      (request) => request.confirmation_response_detected !== true
    );

    const selectedRequests = unresponded.length > 0 ? unresponded : allRequests.slice(0, 1);

    if (selectedRequests.length === 1) {
      const matchingConversation = allConversations.find(
        (conversation) => conversation.id === selectedRequests[0].conversation_id
      );

      if (matchingConversation) {
        return {
          conversation: matchingConversation,
          pendingRequests: selectedRequests,
          allConversations,
        };
      }
    }

    if (selectedRequests.length > 1) {
      return {
        conversation: allConversations[0],
        pendingRequests: selectedRequests,
        allConversations,
      };
    }
  }

  // For general non-confirmation SMS where Twilio only gives the mobile number,
  // use the most recently updated thread for that mobile.
  return {
    conversation: allConversations[0],
    pendingRequests: [],
    allConversations,
  };
}
