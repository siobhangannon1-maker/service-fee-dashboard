import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type Scenario = {
  title: string;
  category?: string | null;
  difficulty?: string | null;
  opening_message?: string | null;
  patient_persona?: string | null;
  scenario_goal?: string | null;
  success_criteria?: string | null;
  escalation_triggers?: string | null;
  ideal_phrases?: string | null;
  poor_phrases?: string | null;
  ethical_conversion_goal?: string | null;
  ai_scoring_focus?: string | null;
};

type VoiceMetricInput = {
  transcript: string;
  audioDurationSeconds?: number | null;
  wordsPerMinute?: number | null;
};

export async function transcribeVoiceRoleplayAudio(file: File) {
  const transcription = await openai.audio.transcriptions.create({
    file,
    model: "gpt-4o-transcribe",
  });

  return {
    text: transcription.text?.trim() ?? "",
  };
}

export async function analyseVoiceDelivery(input: VoiceMetricInput) {
  const response = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `
You are a dental communication voice coach.

Analyse the STAFF MEMBER'S delivery using the transcript and objective timing data.

Important:
- Do not claim to diagnose emotion.
- Do not say the staff member "was anxious" or "was uncaring".
- Use coaching language: "may have sounded", "could improve by", "came across as".
- Score based on dental reception / treatment coordination communication.
- Focus on warmth, calmness, pace, clarity, confidence, reassurance, professionalism.

Return JSON only with this shape:
{
  "warmth_score": number,
  "calmness_score": number,
  "pace_score": number,
  "clarity_score": number,
  "confidence_score": number,
  "reassurance_score": number,
  "professionalism_score": number,
  "overall_delivery_score": number,
  "strengths": string[],
  "improvements": string[],
  "coaching_note": string
}

Scores are 0-10.
        `,
      },
      {
        role: "user",
        content: `
Staff transcript:
${input.transcript}

Audio duration seconds:
${input.audioDurationSeconds ?? "unknown"}

Words per minute:
${input.wordsPerMinute ?? "unknown"}
        `,
      },
    ],
  });

  return JSON.parse(response.choices[0]?.message?.content ?? "{}");
}

export async function generatePatientVoiceReply(params: {
  scenario: Scenario;
  conversationTranscript: string;
}) {
  const response = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0.7,
    messages: [
      {
        role: "system",
        content: `
You are roleplaying as a dental patient.

Stay in character.
Reply naturally as the patient.
Keep replies short: 1-3 sentences.
Do not coach the staff member.
Do not reveal the scoring rubric.
Escalate only if the staff member ignores concern, pressures the patient, or sounds dismissive.

Scenario:
${JSON.stringify(params.scenario, null, 2)}
        `,
      },
      {
        role: "user",
        content: params.conversationTranscript,
      },
    ],
  });

  return response.choices[0]?.message?.content?.trim() || "Okay, I understand.";
}

export async function scoreVoiceRoleplay(params: {
  scenario: Scenario;
  conversationTranscript: string;
  deliverySummary: unknown[];
}) {
  const response = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `
You are scoring a dental communication voice roleplay.

Score both:
1. Content of what the staff member said
2. Voice delivery coaching indicators

Do not diagnose emotions.
Keep feedback practical, kind, specific, and suitable for staff training.

Return JSON only:
{
  "content_score": number,
  "delivery_score": number,
  "overall_score": number,
  "passed": boolean,
  "strengths": string[],
  "improvements": string[],
  "missed_opportunities": string[],
  "recommended_phrases": string[],
  "manager_summary": string,
  "staff_coaching": string
}
        `,
      },
      {
        role: "user",
        content: `
Scenario:
${JSON.stringify(params.scenario, null, 2)}

Conversation:
${params.conversationTranscript}

Delivery analysis:
${JSON.stringify(params.deliverySummary, null, 2)}
        `,
      },
    ],
  });

  return JSON.parse(response.choices[0]?.message?.content ?? "{}");
}