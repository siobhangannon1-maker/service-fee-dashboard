import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { matchPatient } from "@/lib/ai-reception/match-patient";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "Missing OPENAI_API_KEY" },
        { status: 500 }
      );
    }

    const { id, text } = await req.json();

    if (!id || !text) {
      return NextResponse.json(
        { error: "Missing id or text" },
        { status: 400 }
      );
    }

    const prompt = `
You are a dental specialist reception assistant.

Classify this correspondence.

Categories:
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

Important:
Do not assume the patient is new just because the document says referral.
If it is a letter, report, xray, clinical update, or correspondence about a patient, use existing_patient_correspondence unless it clearly says this is a new patient referral.

Return JSON only:
{
  "patient_name": "",
  "patient_dob": "",
  "category": "",
  "summary": "",
  "suggested_action": ""
}

Text:
${text}
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });

    const result = JSON.parse(completion.choices[0].message.content || "{}");

    const match = await matchPatient({
      patientName: result.patient_name || null,
      patientDob: result.patient_dob || null,
    });

    let finalCategory = result.category || "unknown";
    let finalSuggestedAction = result.suggested_action || null;

    if (match.matchStatus === "matched") {
      finalCategory = "existing_patient_correspondence";
      finalSuggestedAction =
        "Matched to an existing patient. Reception should review and attach this document to the existing patient file.";
    }

    if (match.matchStatus === "possible_match") {
      finalSuggestedAction =
        "Possible existing patient match found. Reception should verify patient details before attaching this document.";
    }

    await supabaseAdmin
      .from("ai_inbox_items")
      .update({
        status: "classified",
        extracted_text: text,
        patient_name: result.patient_name || null,
        patient_dob: result.patient_dob || null,
        category: finalCategory,
        summary: result.summary || null,
        suggested_action: finalSuggestedAction,
        confidence: 0.8,
        matched_patient_id: match.matchedPatientId,
        match_status: match.matchStatus,
        match_confidence: match.matchConfidence,
      })
      .eq("id", id);

    return NextResponse.json({ success: true, result, match });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Classification failed" },
      { status: 500 }
    );
  }
}