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

    const { id } = await req.json();

    if (!id) {
      return NextResponse.json({ error: "Missing item id" }, { status: 400 });
    }

    const { data: item, error } = await supabaseAdmin
      .from("ai_inbox_items")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !item) {
      return NextResponse.json(
        { error: error?.message || "Item not found" },
        { status: 404 }
      );
    }

    const templateCategory = mapInboxCategoryToTemplateCategory(item.category);

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

    const prompt = `
You are a receptionist at a specialist dental practice.

Draft a professional, warm, concise email reply.

Important rules:
- Use the approved templates as the main style guide.
- Do not copy placeholders literally if the real information is available.
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
Sender name: ${item.sender_name || "Unknown"}
Sender email: ${item.sender_email || "Unknown"}
Email subject: ${item.email_subject || item.file_name || "No subject"}
Category: ${item.category || "unknown"}
Patient name: ${item.patient_name || "Unknown"}
Patient DOB: ${item.patient_dob || "Unknown"}
Summary: ${item.summary || ""}
Suggested action: ${item.suggested_action || ""}
Reception notes: ${item.reception_notes || ""}
Email body / extracted document text:
${item.email_body || item.extracted_text || ""}

Return JSON only:
{
  "subject": "",
  "body": ""
}
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });

    const result = JSON.parse(completion.choices[0].message.content || "{}");

    const { error: updateError } = await supabaseAdmin
      .from("ai_inbox_items")
      .update({
        draft_reply_subject:
          result.subject || `Re: ${item.email_subject || item.file_name || ""}`,
        draft_reply_body: result.body || "",
        draft_status: "drafted",
      })
      .eq("id", id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, draft: result });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Draft generation failed" },
      { status: 500 }
    );
  }
}