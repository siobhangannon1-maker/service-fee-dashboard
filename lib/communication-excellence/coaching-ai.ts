type CoachingInput = {
  scenarioTitle: string;
  score: number;
  empathyScore: number;
  clarityScore: number;
  professionalismScore: number;
  escalationScore: number;
  summary: string;
  strengths: string[];
  improvements: string[];
};

export type CoachingResult = {
  overall_summary: string;
  strengths: string[];
  improvement_areas: string[];
  recommended_focus: string[];
};

export async function generateCoachingFeedback(
  input: CoachingInput
): Promise<CoachingResult> {
  if (!process.env.OPENAI_API_KEY) {
    return fallbackCoaching(input);
  }

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
You are generating coaching feedback for a dental practice communication training platform.

Return ONLY valid JSON in this exact shape:

{
  "overall_summary": string,
  "strengths": string[],
  "improvement_areas": string[],
  "recommended_focus": string[]
}

Scenario:
${input.scenarioTitle}

Scores:
- Overall: ${input.score}
- Empathy: ${input.empathyScore}
- Clarity: ${input.clarityScore}
- Professionalism: ${input.professionalismScore}
- Escalation: ${input.escalationScore}

Scenario summary:
${input.summary}

Strengths:
${input.strengths.join("\n")}

Improvements:
${input.improvements.join("\n")}
`,
        max_output_tokens: 500,
      }),
    });

    if (!response.ok) {
      console.error(await response.text());
      return fallbackCoaching(input);
    }

    const json = await response.json();

    const text =
      json.output_text ||
      json.output?.[0]?.content?.[0]?.text ||
      "{}";

    const parsed = JSON.parse(text);

    return {
      overall_summary: String(parsed.overall_summary || ""),
      strengths: Array.isArray(parsed.strengths)
        ? parsed.strengths.map(String)
        : [],
      improvement_areas: Array.isArray(parsed.improvement_areas)
        ? parsed.improvement_areas.map(String)
        : [],
      recommended_focus: Array.isArray(parsed.recommended_focus)
        ? parsed.recommended_focus.map(String)
        : [],
    };
  } catch (error) {
    console.error(error);
    return fallbackCoaching(input);
  }
}

function fallbackCoaching(input: CoachingInput): CoachingResult {
  const focus: string[] = [];

  if (input.empathyScore < 75) {
    focus.push("Empathy and emotional acknowledgement");
  }

  if (input.clarityScore < 75) {
    focus.push("Clearer explanations and next steps");
  }

  if (input.escalationScore < 75) {
    focus.push("Escalation judgement and clinician involvement");
  }

  if (input.professionalismScore < 75) {
    focus.push("Professional wording and confidence");
  }

  return {
    overall_summary:
      input.score >= 80
        ? "Strong communication performance overall."
        : "Further communication coaching is recommended.",

    strengths: input.strengths,

    improvement_areas: input.improvements,

    recommended_focus:
      focus.length > 0 ? focus : ["Continue advanced scenario practice"],
  };
}