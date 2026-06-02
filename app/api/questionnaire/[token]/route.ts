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

  const { data: response, error: responseError } = await supabaseAdmin
    .from("reception_questionnaire_responses")
    .insert({
      queue_id: queueItem.id,
      token,
      answers,
      is_urgent: urgency.isUrgent,
      urgent_reasons: urgency.urgentReasons,
    })
    .select("*")
    .single();

  if (responseError || !response) {
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
    await supabaseAdmin
      .from("reception_conversations")
      .update({
        workflow_status: urgency.isUrgent ? "needs_follow_up" : "waiting_on_practice",
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
      action: urgency.isUrgent
        ? "urgent_post_op_questionnaire_completed"
        : "post_op_questionnaire_completed",
      details: {
        questionnaire_queue_id: queueItem.id,
        response_id: response.id,
        praktika_appointment_id: queueItem.praktika_appointment_id,
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
