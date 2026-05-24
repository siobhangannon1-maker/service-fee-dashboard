import { NextResponse } from "next/server";
import { scoreScenario } from "@/lib/communication-excellence/scenario-ai";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const result = await scoreScenario({
      scenarioTitle: body.scenarioTitle || "",
      patientPersona: body.patientPersona || "",
      idealBehaviours: body.idealBehaviours || "",
      escalationRules: body.escalationRules || "",
      messages: body.messages || [],
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Scenario score route failed:", error);

    return NextResponse.json(
      { error: "Failed to score scenario." },
      { status: 500 }
    );
  }
}