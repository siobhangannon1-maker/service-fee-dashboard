import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

function analyseUrgency(questions: any[], answers: Record<string, any>) {
  const urgentReasons: string[] = [];

  for (const question of questions || []) {
    const answer = answers[question.id];

    if (question.urgentOn === "yes" && answer === "yes") {
      urgentReasons.push(question.label);
    }

    if (question.urgentOn === "no" && answer === "no") {
      urgentReasons.push(question.label);
    }

    if (
      question.urgentOn === "any_text" &&
      typeof answer === "string" &&
      answer.trim().length > 0
    ) {
      urgentReasons.push(question.label);
    }
  }

  return {
    isUrgent: urgentReasons.length > 0,
    urgentReasons,
  };
}

function buildSummary(questions: any[], answers: Record<string, any>) {
  return (questions || [])
    .map((question) => {
      const answer = answers[question.id];
      return `${question.label}: ${answer || "No response"}`;
    })
    .join("\n");
}

function buildChatBody({
  templateName,
  summary,
  isUrgent,
  urgentReasons,
}: {
  templateName: string;
  summary: string;
  isUrgent: boolean;
  urgentReasons: string[];
}) {
  return [
    `Questionnaire completed: ${templateName}`,
    "",
    summary,
    "",
    isUrgent ? `⚠ Review needed: ${urgentReasons.join("; ")}` : "No urgent flags detected.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params;

  const { data: queueItem, error } = await supabaseAdmin
    .from("reception_questionnaire_queue")
    .select("*, template:reception_questionnaire_templates(*)")
    .eq("token", token)
    .maybeSingle();

  if (error || !queueItem) {
    return NextResponse.json(
      { error: "Questionnaire not found." },
      { status: 404 }
    );
  }

  return NextResponse.json({
    queueItem,
    template: queueItem.template,
  });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params;
  const body = await request.json();
  const answers = body.answers || {};

  const { data: queueItem, error } = await supabaseAdmin
    .from("reception_questionnaire_queue")
    .select("*, template:reception_questionnaire_templates(*)")
    .eq("token", token)
    .maybeSingle();

  if (error || !queueItem) {
    return NextResponse.json(
      { error: "Questionnaire not found." },
      { status: 404 }
    );
  }

  if (queueItem.status === "completed") {
    return NextResponse.json({
      ok: true,
      alreadyCompleted: true,
    });
  }

  const questions = queueItem.template?.questions || [];
  const urgency = analyseUrgency(questions, answers);
  const summary = buildSummary(questions, answers);
  const now = new Date().toISOString();

  const responsePayload: any = {
    queue_id: queueItem.id,
    token,
    answers,
    is_urgent: urgency.isUrgent,
    urgent_reasons: urgency.urgentReasons,
    submitted_at: now,
    patient_mobile: queueItem.patient_mobile || "unknown",
    patient_first_name: queueItem.patient_first_name || null,
    patient_last_name: queueItem.patient_last_name || null,
    praktika_patient_id: queueItem.praktika_patient_id || null,
    praktika_appointment_id: queueItem.praktika_appointment_id || null,
    response_summary: summary,
  };

  const { data: response, error: responseError } = await supabaseAdmin
    .from("reception_questionnaire_responses")
    .insert(responsePayload)
    .select("*")
    .single();

  if (responseError || !response) {
    console.error("Could not save questionnaire response", {
      error: responseError,
      responsePayload,
    });

    return NextResponse.json(
      { error: responseError?.message || "Could not save questionnaire." },
      { status: 500 }
    );
  }

  await supabaseAdmin
    .from("reception_questionnaire_queue")
    .update({
      status: "completed",
      completed_at: now,
      response_summary: summary,
      is_urgent: urgency.isUrgent,
      updated_at: now,
    })
    .eq("id", queueItem.id);

  if (queueItem.conversation_id) {
    const chatBody = buildChatBody({
      templateName: queueItem.template?.name || "Questionnaire",
      summary,
      isUrgent: urgency.isUrgent,
      urgentReasons: urgency.urgentReasons,
    });

    const { data: message } = await supabaseAdmin
      .from("reception_messages")
      .insert({
        conversation_id: queueItem.conversation_id,
        direction: "inbound",
        body: chatBody,
        twilio_status: "received",
        message_source: "questionnaire",
      })
      .select("*")
      .single();

    await supabaseAdmin
      .from("reception_conversations")
      .update({
        workflow_status: urgency.isUrgent
          ? "needs_follow_up"
          : "waiting_on_practice",
        is_urgent: urgency.isUrgent,
        last_message_preview: urgency.isUrgent
          ? "Post-op questionnaire completed - review needed"
          : "Post-op questionnaire completed",
        last_message_at: now,
        updated_at: now,
      })
      .eq("id", queueItem.conversation_id);

    await supabaseAdmin.from("reception_audit_logs").insert({
      conversation_id: queueItem.conversation_id,
      message_id: message?.id || null,
      action: urgency.isUrgent
        ? "urgent_post_op_questionnaire_completed"
        : "post_op_questionnaire_completed",
      details: {
        questionnaire_queue_id: queueItem.id,
        response_id: response.id,
        praktika_appointment_id: queueItem.praktika_appointment_id,
        patient_mobile: queueItem.patient_mobile,
        is_urgent: urgency.isUrgent,
        urgent_reasons: urgency.urgentReasons,
        summary,
      },
    });
  }

  return NextResponse.json({
    ok: true,
    isUrgent: urgency.isUrgent,
  });
}
