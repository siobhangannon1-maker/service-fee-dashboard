import { NextResponse } from "next/server";
import { generatePatientReply } from "@/lib/communication-excellence/scenario-ai";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const reply = await generatePatientReply({
      scenarioTitle: body.scenarioTitle || "",
      patientPersona: body.patientPersona || "",
      scenarioPrompt: body.scenarioPrompt || "",
      idealBehaviours: body.idealBehaviours || "",
      escalationRules: body.escalationRules || "",
      messages: body.messages || [],
    });

    return NextResponse.json({ reply });
  } catch (error) {
    console.error("Scenario reply route failed:", error);

    return NextResponse.json(
      { error: "Failed to generate scenario reply." },
      { status: 500 }
    );
  }
}