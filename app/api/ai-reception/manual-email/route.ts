import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function mapInboxCategoryToTemplateCategory(category: string | null) {
  if (category === "new_referral") return "referral_received";
  if (category === "existing_patient_correspondence") {
    return "existing_patient_correspondence_received";
  }
  if (category === "billing_question") return "invoice_request";
  if (category === "reschedule_request") return "reschedule_request";
  if (category === "patient_request") return "procedure_question";
  return null;
}

export async function POST(req: Request) {
  try {
    await requireRole(["super_admin"]);

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "Missing OPENAI_API_KEY" },
        { status: 500 }
      );
    }

    const { senderName, senderEmail, subject, body } = await req.json();

    if (!body) {
      return NextResponse.json(
        { error: "Email body required" },
        { status: 400 }
      );
    }

    const classificationResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: `
You are a specialist dental reception assistant.

Classify this email.

Allowed categories:
- new_referral
- existing_patient_correspondence
- patient_request
- reschedule_request
- billing_question
- unknown

Extract:
- patient_name
- patient_dob
- category
- summary
- suggested_action

Return JSON only:
{
  "patient_name": "",
  "patient_dob": "",
  "category": "",
  "summary": "",
  "suggested_action": ""
}

Email subject:
${subject || "No subject"}

Email body:
${body}
`,
        },
      ],
    });

    const classification = JSON.parse(
      classificationResponse.choices[0]?.message?.content || "{}"
    );

    const category = classification.category || "unknown";
    const templateCategory = mapInboxCategoryToTemplateCategory(category);

    let templatesText = "No approved templates found.";

    if (templateCategory) {
      const { data: templates } = await supabaseAdmin
        .from("ai_response_templates")
        .select("*")
        .eq("category", templateCategory)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(3);

      if (templates && templates.length > 0) {
        templatesText = templates
          .map(
            (template, index) => `
Template ${index + 1}
Title: ${template.title}
Subject: ${template.subject_template || ""}
Body:
${template.body_template}

Tone notes:
${template.tone_notes || ""}

Avoid:
${template.avoid_notes || ""}
`
          )
          .join("\n\n");
      }
    }

    const draftResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: `
You are a receptionist at a specialist dental practice.

Draft a professional, warm, concise email reply.

Important rules:
- Use approved templates as the style guide.
- Do not invent appointment times, fees, diagnoses, treatment plans, or clinical advice.
- If staff need to review something, say the team will review and respond.
- If this is a referral or correspondence from another dental practice, acknowledge receipt.
- If this is from a patient, be friendly and clear.
- Do not say the email was written by AI.
- Use Australian English.
- Sign off as "Focus Dental Specialists".

Approved response templates:
${templatesText}

Context:
Sender name: ${senderName || "Unknown"}
Sender email: ${senderEmail || "Unknown"}
Email subject: ${subject || "No subject"}
Category: ${category}
Patient name: ${classification.patient_name || "Unknown"}
Patient DOB: ${classification.patient_dob || "Unknown"}
Summary: ${classification.summary || ""}
Suggested action: ${classification.suggested_action || ""}

Original email:
${body}

Return JSON only:
{
  "subject": "",
  "body": ""
}
`,
        },
      ],
    });

    const draft = JSON.parse(
      draftResponse.choices[0]?.message?.content || "{}"
    );

    const { data, error } = await supabaseAdmin
      .from("ai_inbox_items")
      .insert({
        source: "manual_email",
        file_name: subject || "Manual email",
        status: "classified",
        category,
        patient_name: classification.patient_name || null,
        patient_dob: classification.patient_dob || null,
        summary: classification.summary || null,
        suggested_action: classification.suggested_action || null,
        sender_name: senderName || null,
        sender_email: senderEmail || null,
        email_subject: subject || null,
        email_body: body,
        extracted_text: body,
        draft_reply_subject: draft.subject || `Re: ${subject || ""}`,
        draft_reply_body: draft.body || "",
        draft_status: "drafted",
        confidence: 0.8,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      id: data.id,
      category,
      draft,
    });
  } catch (err) {
    console.error("manual-email error:", err);

    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Manual email processing failed",
      },
      { status: 500 }
    );
  }
}