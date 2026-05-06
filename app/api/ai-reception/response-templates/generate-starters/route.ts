import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST() {
  try {
    await requireRole(["super_admin"]);

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "Missing OPENAI_API_KEY" },
        { status: 500 }
      );
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: `
Create starter email response templates for a specialist dental practice.

Categories:
- referral_received
- existing_patient_correspondence_received
- invoice_request
- medical_certificate_request
- reschedule_request
- quote_enquiry
- appointment_availability
- procedure_question
- post_op_concern
- missing_referral_information

Rules:
- Use Australian English.
- Warm, professional and concise.
- Do not provide clinical advice.
- Do not invent fees or appointment times.
- Sign off as "Focus Dental Specialists".
- Use placeholders like [Patient Name], [Dr Name], [Appointment Date], [Procedure].

Return JSON only:
{
  "templates": [
    {
      "category": "",
      "title": "",
      "subject_template": "",
      "body_template": "",
      "tone_notes": "",
      "avoid_notes": ""
    }
  ]
}
`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content || "{}";
    const result = JSON.parse(raw);

    const templates = Array.isArray(result.templates) ? result.templates : [];

    if (templates.length === 0) {
      return NextResponse.json(
        { error: "No templates were generated." },
        { status: 500 }
      );
    }

    const rows = templates.map((template: any) => ({
      category: template.category || "unknown",
      title: template.title || "Untitled template",
      subject_template: template.subject_template || null,
      body_template: template.body_template || "",
      tone_notes: template.tone_notes || null,
      avoid_notes: template.avoid_notes || null,
      is_active: true,
      updated_at: new Date().toISOString(),
    }));

    const { error } = await supabaseAdmin
      .from("ai_response_templates")
      .insert(rows);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      count: rows.length,
    });
  } catch (err) {
    console.error("generate-starters error:", err);

    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to generate starter templates.",
      },
      { status: 500 }
    );
  }
}