export type CallReviewResult = {
  overall_score: number;
  empathy_score: number;
  clarity_score: number;
  professionalism_score: number;
  escalation_score: number;
  strengths: string[];
  improvements: string[];
  recommended_focus: string[];
  ai_summary: string;
};

type RubricRow = {
  rubric_text: string;
};

export async function reviewCommunicationCall({
  transcript,
  rubricText,
}: {
  transcript: string;
  rubricText?: string | null;
}): Promise<CallReviewResult> {
  if (!process.env.OPENAI_API_KEY) return fallbackReview();

  const activeRubric = rubricText || fallbackRubric();

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: `
You are reviewing a dental practice phone call for communication coaching.

Use the scoring rubric below.

SCORING RUBRIC:
${activeRubric}

IMPORTANT:
All scores MUST be numbers from 0 to 100.
Do not use a 0 to 10 scale.

Return ONLY valid JSON:

{
  "overall_score": number,
  "empathy_score": number,
  "clarity_score": number,
  "professionalism_score": number,
  "escalation_score": number,
  "strengths": string[],
  "improvements": string[],
  "recommended_focus": string[],
  "ai_summary": string
}

Transcript:
${transcript}
`,
        max_output_tokens: 1000,
      }),
    });

    if (!response.ok) {
      console.error(await response.text());
      return fallbackReview();
    }

    const json = await response.json();
    const text =
      json.output_text || json.output?.[0]?.content?.[0]?.text || "{}";

    const parsed = JSON.parse(text);

    return {
      overall_score: normalizeScore(parsed.overall_score),
      empathy_score: normalizeScore(parsed.empathy_score),
      clarity_score: normalizeScore(parsed.clarity_score),
      professionalism_score: normalizeScore(parsed.professionalism_score),
      escalation_score: normalizeScore(parsed.escalation_score),
      strengths: Array.isArray(parsed.strengths)
        ? parsed.strengths.map(String)
        : [],
      improvements: Array.isArray(parsed.improvements)
        ? parsed.improvements.map(String)
        : [],
      recommended_focus: Array.isArray(parsed.recommended_focus)
        ? parsed.recommended_focus.map(String)
        : [],
      ai_summary: String(parsed.ai_summary || ""),
    };
  } catch (error) {
    console.error(error);
    return fallbackReview();
  }
}

export async function getActiveCallScoringRubric(
  supabase: any
): Promise<string> {
  const { data, error } = await supabase
    .from("communication_call_scoring_rubrics")
    .select("rubric_text")
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return fallbackRubric();
  }

  return String((data as RubricRow).rubric_text || fallbackRubric());
}

function normalizeScore(value: unknown): number {
  const numberValue = Number(value);

  if (Number.isNaN(numberValue)) return 0;

  if (numberValue > 0 && numberValue <= 10) {
    return Math.round(numberValue * 10);
  }

  if (numberValue < 0) return 0;
  if (numberValue > 100) return 100;

  return Math.round(numberValue);
}

function fallbackReview(): CallReviewResult {
  return {
    overall_score: 75,
    empathy_score: 75,
    clarity_score: 75,
    professionalism_score: 75,
    escalation_score: 75,
    strengths: ["Professional tone maintained."],
    improvements: ["Improve clarity and patient reassurance."],
    recommended_focus: ["Clarity", "Empathy"],
    ai_summary:
      "The call was generally professional but could improve in empathy and communication clarity.",
  };
}

function fallbackRubric() {
  return `
Dental Communication Excellence Call Scoring Rubric

All scores must be 0–100.

Empathy:
90–100 excellent emotional acknowledgement, calm reassurance, supportive tone.
80–89 warm and appropriate.
70–79 acceptable but emotionally limited.
60–69 weak reassurance.
Below 60 dismissive or ignores distress.

Clarity:
90–100 clear explanation, avoids jargon, gives next steps.
80–89 mostly clear.
70–79 understandable with gaps.
60–69 confusing.
Below 60 patient likely remains confused.

Professionalism:
90–100 calm, respectful, organised, confident.
80–89 professional with minor gaps.
70–79 acceptable.
60–69 disorganised or uncertain.
Below 60 defensive or inappropriate.

Escalation:
90–100 identifies risk and escalates appropriately.
80–89 good judgement.
70–79 acceptable but delayed.
60–69 missed cues.
Below 60 fails to escalate complaint, safety concern, legal threat, or distress.
`;
}