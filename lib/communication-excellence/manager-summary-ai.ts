export type ManagerSummaryInput = {
  averageScenarioScore: number;
  averageEmpathy: number;
  averageClarity: number;
  averageEscalation: number;
  overdueTrainingCount: number;
  openMicrolearningCount: number;
  coachingThemes: string[];
  weakestCompetencies: string[];
  lowScoringScenarios: string[];
};

export type ManagerSummaryResult = {
  overall_summary: string;
  strengths: string[];
  risks: string[];
  coaching_priorities: string[];
  recommended_actions: string[];
};

export async function generateManagerSummary(
  input: ManagerSummaryInput
): Promise<ManagerSummaryResult> {
  if (!process.env.OPENAI_API_KEY) {
    return fallbackSummary(input);
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
You are generating a practice manager summary for a dental practice Communication Excellence platform.

Return ONLY valid JSON in this exact shape:

{
  "overall_summary": string,
  "strengths": string[],
  "risks": string[],
  "coaching_priorities": string[],
  "recommended_actions": string[]
}

Use practical, concise, manager-friendly language.

Data:
${JSON.stringify(input, null, 2)}
`,
        max_output_tokens: 700,
      }),
    });

    if (!response.ok) {
      console.error(await response.text());
      return fallbackSummary(input);
    }

    const json = await response.json();
    const text =
      json.output_text || json.output?.[0]?.content?.[0]?.text || "{}";

    const parsed = JSON.parse(text);

    return {
      overall_summary: String(parsed.overall_summary || ""),
      strengths: Array.isArray(parsed.strengths)
        ? parsed.strengths.map(String)
        : [],
      risks: Array.isArray(parsed.risks) ? parsed.risks.map(String) : [],
      coaching_priorities: Array.isArray(parsed.coaching_priorities)
        ? parsed.coaching_priorities.map(String)
        : [],
      recommended_actions: Array.isArray(parsed.recommended_actions)
        ? parsed.recommended_actions.map(String)
        : [],
    };
  } catch (error) {
    console.error(error);
    return fallbackSummary(input);
  }
}

function fallbackSummary(input: ManagerSummaryInput): ManagerSummaryResult {
  const risks: string[] = [];
  const coachingPriorities: string[] = [];

  if (input.averageEscalation < 75) {
    risks.push("Escalation judgement appears to need attention.");
    coachingPriorities.push("Practise escalation language and clinician handoff scenarios.");
  }

  if (input.averageClarity < 75) {
    risks.push("Clarity scores suggest staff may need support explaining next steps.");
    coachingPriorities.push("Focus on clear explanations and summarising next steps.");
  }

  if (input.overdueTrainingCount > 0) {
    risks.push(`${input.overdueTrainingCount} training assignment(s) are overdue.`);
  }

  if (input.openMicrolearningCount > 0) {
    coachingPriorities.push("Follow up open microlearning tasks.");
  }

  return {
    overall_summary:
      "Communication training data has been reviewed. Focus on the lowest scoring competencies and outstanding remediation tasks.",
    strengths:
      input.averageEmpathy >= 80
        ? ["Empathy performance appears strong overall."]
        : [],
    risks,
    coaching_priorities:
      coachingPriorities.length > 0
        ? coachingPriorities
        : ["Continue scenario practice and monitor score trends."],
    recommended_actions: [
      "Review staff with low scenario scores.",
      "Follow up overdue training and open microlearning.",
      "Assign targeted scenarios for the weakest competencies.",
    ],
  };
}