type ScenarioMessage = {
  role: "patient" | "staff" | "system";
  content: string;
};

type PracticeRule = {
  title: string;
  category: string;
  content: string;
};

type ScenarioReplyParams = {
  scenarioTitle: string;
  patientPersona: string;
  scenarioPrompt: string;
  idealBehaviours: string;
  escalationRules: string;
  practiceRules?: PracticeRule[];
  messages: ScenarioMessage[];
};

type ScenarioScoreParams = {
  scenarioTitle: string;
  patientPersona: string;
  idealBehaviours: string;
  escalationRules: string;
  practiceRules?: PracticeRule[];
  messages: ScenarioMessage[];
};

export type ScenarioScoreResult = {
  score: number;
  empathy_score: number;
  clarity_score: number;
  professionalism_score: number;
  escalation_score: number;
  strengths: string[];
  improvements: string[];
  summary: string;
};

export async function generatePatientReply(params: ScenarioReplyParams) {
  if (!process.env.OPENAI_API_KEY) {
    return buildFallbackPatientReply(params.messages);
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
        input: [
          {
            role: "system",
            content: `
You are roleplaying as a dental patient in a staff communication training scenario.

Stay in character as the patient.
Do not coach the staff member.
Do not score the staff member.
Reply naturally in 1-3 short paragraphs.

Scenario title:
${params.scenarioTitle}

Patient persona:
${params.patientPersona}

Scenario situation:
${params.scenarioPrompt}

Practice communication rules:
${formatPracticeRules(params.practiceRules ?? [])}

Escalation rules the staff should follow:
${params.escalationRules}
`,
          },
          ...params.messages.map((message) => ({
            role: message.role === "staff" ? "user" : "assistant",
            content: message.content,
          })),
        ],
        max_output_tokens: 250,
      }),
    });

    if (!response.ok) {
      console.error("OpenAI reply failed:", await response.text());
      return buildFallbackPatientReply(params.messages);
    }

    const json = await response.json();
    const text = extractResponseText(json);

    return text || buildFallbackPatientReply(params.messages);
  } catch (error) {
    console.error("AI scenario reply failed:", error);
    return buildFallbackPatientReply(params.messages);
  }
}

export async function scoreScenario(
  params: ScenarioScoreParams
): Promise<ScenarioScoreResult> {
  if (!process.env.OPENAI_API_KEY) {
    return scoreScenarioFallback(params.messages);
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
        input: [
          {
            role: "system",
            content: `
You are scoring a dental practice staff communication training scenario.

Score based on:
- empathy
- clarity
- professionalism
- escalation judgement
- alignment with practice communication rules
- avoidance of unsafe clinical advice

Return ONLY valid JSON with this exact shape:
{
  "score": number,
  "empathy_score": number,
  "clarity_score": number,
  "professionalism_score": number,
  "escalation_score": number,
  "strengths": string[],
  "improvements": string[],
  "summary": string
}

Scores must be integers from 0 to 100.

Scenario title:
${params.scenarioTitle}

Patient persona:
${params.patientPersona}

Ideal behaviours:
${params.idealBehaviours}

Escalation rules:
${params.escalationRules}

Practice communication rules:
${formatPracticeRules(params.practiceRules ?? [])}
`,
          },
          {
            role: "user",
            content: JSON.stringify(params.messages, null, 2),
          },
        ],
        max_output_tokens: 700,
      }),
    });

    if (!response.ok) {
      console.error("OpenAI scoring failed:", await response.text());
      return scoreScenarioFallback(params.messages);
    }

    const json = await response.json();
    const text = extractResponseText(json);
    const parsed = JSON.parse(text);

    return normalizeScore(parsed);
  } catch (error) {
    console.error("AI scenario scoring failed:", error);
    return scoreScenarioFallback(params.messages);
  }
}

function formatPracticeRules(rules: PracticeRule[]) {
  if (rules.length === 0) {
    return "No additional practice rules supplied.";
  }

  return rules
    .map(
      (rule, index) =>
        `${index + 1}. [${rule.category}] ${rule.title}: ${rule.content}`
    )
    .join("\n");
}

function extractResponseText(json: any) {
  if (typeof json.output_text === "string") return json.output_text;

  const output = json.output ?? [];
  const chunks: string[] = [];

  for (const item of output) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text) {
        chunks.push(content.text);
      }
    }
  }

  return chunks.join("\n").trim();
}

function normalizeScore(value: any): ScenarioScoreResult {
  return {
    score: clampScore(value.score),
    empathy_score: clampScore(value.empathy_score),
    clarity_score: clampScore(value.clarity_score),
    professionalism_score: clampScore(value.professionalism_score),
    escalation_score: clampScore(value.escalation_score),
    strengths: Array.isArray(value.strengths) ? value.strengths.map(String) : [],
    improvements: Array.isArray(value.improvements)
      ? value.improvements.map(String)
      : [],
    summary: String(value.summary || "Scenario completed."),
  };
}

function clampScore(value: any) {
  const number = Number(value);
  if (Number.isNaN(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function buildFallbackPatientReply(messages: ScenarioMessage[]) {
  const staffMessages = messages.filter((message) => message.role === "staff");
  const lastStaffMessage = staffMessages[staffMessages.length - 1]?.content ?? "";
  const lower = lastStaffMessage.toLowerCase();

  if (staffMessages.length >= 4) {
    return "Thank you. That helps me understand what happens next.";
  }

  if (
    lower.includes("understand") ||
    lower.includes("appreciate") ||
    lower.includes("sorry")
  ) {
    return "Thank you for saying that. I still feel nervous, but I do feel more listened to.";
  }

  if (
    lower.includes("clinician") ||
    lower.includes("doctor") ||
    lower.includes("surgeon")
  ) {
    return "That would be helpful. I just want to make sure I’m getting the right information.";
  }

  if (
    lower.includes("cost") ||
    lower.includes("fee") ||
    lower.includes("payment")
  ) {
    return "I’m worried about the cost. I don’t want to start something I can’t afford.";
  }

  return "I’m not sure. I still feel anxious and I don’t really know what happens next.";
}

function scoreScenarioFallback(messages: ScenarioMessage[]): ScenarioScoreResult {
  const staffMessages = messages
    .filter((message) => message.role === "staff")
    .map((message) => message.content);

  const joined = staffMessages.join(" ").toLowerCase();

  let score = 50;
  const strengths: string[] = [];
  const improvements: string[] = [];

  if (joined.includes("understand") || joined.includes("appreciate")) {
    score += 10;
    strengths.push("Acknowledged the patient's concern.");
  } else {
    improvements.push("Use clearer empathy statements.");
  }

  if (joined.includes("next step") || joined.includes("help")) {
    score += 10;
    strengths.push("Provided clear next steps.");
  } else {
    improvements.push("Explain the next step more clearly.");
  }

  if (
    joined.includes("clinician") ||
    joined.includes("doctor") ||
    joined.includes("surgeon")
  ) {
    score += 10;
    strengths.push("Recognised when clinician input may be appropriate.");
  } else {
    improvements.push("Escalate clinical uncertainty rather than guessing.");
  }

  if (staffMessages.length >= 3) {
    score += 10;
    strengths.push("Sustained the conversation over multiple turns.");
  } else {
    improvements.push("Continue the scenario for longer before finishing.");
  }

  score = clampScore(score);

  return {
    score,
    empathy_score: score,
    clarity_score: score,
    professionalism_score: score,
    escalation_score: score,
    strengths,
    improvements,
    summary:
      score >= 80
        ? "Strong scenario performance."
        : "This scenario needs further practice.",
  };
}