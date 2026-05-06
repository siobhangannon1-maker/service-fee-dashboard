import { NextResponse } from "next/server";
import OpenAI from "openai";

import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function buildSourceText({
  inboxItem,
  fallbackEmailBody,
}: {
  inboxItem: any;
  fallbackEmailBody?: string | null;
}) {
  return String(
    inboxItem?.extracted_text ||
      inboxItem?.raw_text ||
      inboxItem?.body ||
      inboxItem?.email_body ||
      inboxItem?.summary ||
      fallbackEmailBody ||
      ""
  ).trim();
}

export async function POST(req: Request) {
  try {
    await requireRole(["super_admin"]);

    const body = await req.json();

    const {
      inboxItemId,
      subject,
      senderName,
      senderEmail,
      emailBody,
      existingCategory,
      patientName,
      patientDob,
    } = body;

    if (!inboxItemId) {
      return NextResponse.json(
        { error: "Missing inboxItemId" },
        { status: 400 }
      );
    }

    const { data: inboxItem, error: inboxError } = await supabaseAdmin
      .from("ai_inbox_items")
      .select("*")
      .eq("id", inboxItemId)
      .single();

    if (inboxError || !inboxItem) {
      return NextResponse.json(
        { error: inboxError?.message || "Inbox item not found." },
        { status: 404 }
      );
    }

    const sourceText = buildSourceText({
      inboxItem,
      fallbackEmailBody: emailBody,
    });

    if (!sourceText) {
      return NextResponse.json(
        { error: "No correspondence text found to analyse." },
        { status: 400 }
      );
    }

    const prompt = `
You are the AI Reception Brain for a specialist dental practice:
- oral and maxillofacial surgery
- periodontics
- implant dentistry
- referral-based specialist care

Analyse the incoming correspondence and return ONLY valid JSON.

Use this exact structure:

{
  "title": "short human-readable case title",
  "category": "new_referral | appointment_request | billing | post_op | clinical_question | complaint | admin | unknown",
  "operational_intent": "new_referral | urgent_post_op_issue | implant_consult | perio_consult | missing_information | appointment_request | billing_query | records_request | radiology_received | clinical_review_required | general_correspondence | unknown",
  "confidence": 0.0,
  "patient_name": "string or null",
  "patient_dob": "string or null",
  "risk_level": "low | medium | high",
  "requires_clinical_review": false,
  "safe_to_auto_draft": true,
  "risks": ["risk 1", "risk 2"],
  "missing_information": ["missing item 1"],
  "recommended_next_step": "what reception should do next",
  "summary": "short receptionist-friendly summary of the correspondence",
  "suggested_action": "short practical action for reception",
  "explanation": "brief explanation of why you made this decision"
}

Clinical safety rules:
- Do not give medical advice.
- Do not diagnose.
- Do not recommend treatment.
- Do not invent fees, appointment times, clinical opinions or availability.
- Be conservative.
- Human review is always required.
- If patient identity is uncertain, risk_level must be medium or high.
- If DOB is missing, include "patient DOB" in missing_information.
- If the message sounds clinically urgent, risk_level must be high.
- If swelling, bleeding, severe pain, trauma, infection, paraesthesia, fever, breathing difficulty, swallowing difficulty, medication reaction, anticoagulant concern, bisphosphonate concern or post-operative complication is mentioned, requires_clinical_review must be true.
- If clinical advice is being requested, requires_clinical_review must be true.
- If the correspondence is administrative only, requires_clinical_review should usually be false.
- If clinically risky, safe_to_auto_draft must be false.
- If it is safe administrative correspondence, safe_to_auto_draft may be true.

Operational rules:
- If this is a referral, operational_intent should usually be "new_referral".
- If the referral is missing DOB, contact details, referral reason, radiographs, CBCT, tooth/site details or medical history, include those in missing_information.
- If important information is missing, operational_intent should usually be "missing_information".
- If this is a post-operative concern, operational_intent should usually be "urgent_post_op_issue" or "clinical_review_required".
- If this is about implants, operational_intent should usually be "implant_consult".
- If this is about periodontal treatment, gum disease, gum grafting or perio maintenance, operational_intent should usually be "perio_consult".
- If this is about images, OPG, CBCT, x-rays or radiology reports, operational_intent should usually be "radiology_received" or "records_request".
- If this is a billing, quote, invoice or payment question, operational_intent should usually be "billing_query".
- If there is not enough information, use category "unknown" and operational_intent "unknown".
- confidence must be a number between 0 and 1.
- Extract patient name and DOB from the email body or PDF attachment text where present.
- Prefer concrete details from the correspondence over generic statements.
`;

    const userContent = `
Subject: ${subject ?? inboxItem.subject ?? ""}
Sender name: ${senderName ?? inboxItem.sender_name ?? ""}
Sender email: ${senderEmail ?? inboxItem.sender_email ?? ""}
Existing category: ${existingCategory ?? inboxItem.category ?? ""}
Known patient name: ${patientName ?? inboxItem.patient_name ?? ""}
Known patient DOB: ${patientDob ?? inboxItem.patient_dob ?? ""}
File name: ${inboxItem.file_name ?? ""}

Correspondence text:
${sourceText}
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: userContent },
      ],
    });

    const raw = completion.choices[0]?.message?.content;

    if (!raw) {
      return NextResponse.json(
        { error: "No AI response returned." },
        { status: 500 }
      );
    }

    const decision = JSON.parse(raw);

    const finalCategory =
      decision.category || inboxItem.category || existingCategory || "unknown";

    const finalPatientName =
      decision.patient_name || inboxItem.patient_name || patientName || null;

    const finalPatientDob =
      decision.patient_dob || inboxItem.patient_dob || patientDob || null;

    const finalSummary =
      decision.summary ||
      inboxItem.summary ||
      decision.explanation ||
      "AI Brain analysis completed.";

    const finalSuggestedAction =
      decision.suggested_action ||
      decision.recommended_next_step ||
      inboxItem.suggested_action ||
      "Review this correspondence.";

    const { data: existingCase, error: existingCaseError } = await supabaseAdmin
      .from("ai_cases")
      .select("id")
      .eq("inbox_item_id", inboxItemId)
      .maybeSingle();

    if (existingCaseError) {
      return NextResponse.json(
        { error: existingCaseError.message },
        { status: 500 }
      );
    }

    let aiCase;

    if (existingCase) {
      const { data: updatedCase, error: updateError } = await supabaseAdmin
        .from("ai_cases")
        .update({
          title: decision.title,
          patient_name: finalPatientName,
          patient_dob: finalPatientDob,
          category: finalCategory,
          confidence: decision.confidence,
          risk_level: decision.risk_level,
          recommended_next_step: decision.recommended_next_step,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingCase.id)
        .select()
        .single();

      if (updateError) {
        return NextResponse.json(
          { error: updateError.message },
          { status: 500 }
        );
      }

      aiCase = updatedCase;
    } else {
      const { data: newCase, error: insertError } = await supabaseAdmin
        .from("ai_cases")
        .insert({
          inbox_item_id: inboxItemId,
          status: "open",
          title: decision.title,
          patient_name: finalPatientName,
          patient_dob: finalPatientDob,
          category: finalCategory,
          confidence: decision.confidence,
          risk_level: decision.risk_level,
          recommended_next_step: decision.recommended_next_step,
        })
        .select()
        .single();

      if (insertError) {
        return NextResponse.json(
          { error: insertError.message },
          { status: 500 }
        );
      }

      aiCase = newCase;
    }

    const { error: decisionError } = await supabaseAdmin
      .from("ai_decisions")
      .insert({
        case_id: aiCase.id,
        decision_type: "initial_analysis",
        decision,
        confidence: decision.confidence,
        risks: decision.risks ?? [],
        explanation: decision.explanation,
      });

    if (decisionError) {
      return NextResponse.json(
        { error: decisionError.message },
        { status: 500 }
      );
    }

    const { error: inboxUpdateError } = await supabaseAdmin
      .from("ai_inbox_items")
      .update({
        status: "classified",
        category: finalCategory,
        patient_name: finalPatientName,
        patient_dob: finalPatientDob,
        summary: finalSummary,
        suggested_action: finalSuggestedAction,
      })
      .eq("id", inboxItemId);

    if (inboxUpdateError) {
      return NextResponse.json(
        { error: inboxUpdateError.message },
        { status: 500 }
      );
    }

    const { error: eventError } = await supabaseAdmin
      .from("ai_case_events")
      .insert({
        case_id: aiCase.id,
        event_type: existingCase
          ? "ai_analysis_updated"
          : "ai_analysis_created",
        event_summary: existingCase
          ? "AI Brain analysis was updated."
          : "AI Brain analysis was created.",
        metadata: {
          ...decision,
          source_text_length: sourceText.length,
          source_fields_used: [
            inboxItem?.extracted_text ? "extracted_text" : null,
            inboxItem?.raw_text ? "raw_text" : null,
            inboxItem?.body ? "body" : null,
            inboxItem?.email_body ? "email_body" : null,
            inboxItem?.summary ? "summary" : null,
          ].filter(Boolean),
        },
      });

    if (eventError) {
      return NextResponse.json(
        { error: eventError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      case: aiCase,
      decision,
      source_text_length: sourceText.length,
    });
  } catch (error: any) {
    console.error("AI Brain analyse error:", error);

    return NextResponse.json(
      {
        error: error.message || "Something went wrong while analysing item.",
      },
      { status: 500 }
    );
  }
}