import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { scoreVoiceRoleplay } from "@/lib/communication-excellence/voice-roleplay-ai";

type RouteProps = {
  params: Promise<{
    attemptId: string;
  }>;
};

export async function POST(_request: Request, { params }: RouteProps) {
  try {
    const { attemptId } = await params;
    const supabase = await createClient();

    const { data: attempt, error: attemptError } = await supabase
      .from("communication_voice_roleplay_attempts")
      .select("id, scenario_id")
      .eq("id", attemptId)
      .single();

    if (attemptError || !attempt) {
      return NextResponse.json(
        { error: "Voice attempt not found." },
        { status: 404 }
      );
    }

    const { data: scenario, error: scenarioError } = await supabase
      .from("communication_scenarios")
      .select("*")
      .eq("id", attempt.scenario_id)
      .single();

    if (scenarioError || !scenario) {
      return NextResponse.json(
        { error: "Scenario not found." },
        { status: 404 }
      );
    }

    const { data: messages, error: messagesError } = await supabase
      .from("communication_voice_roleplay_messages")
      .select("*")
      .eq("attempt_id", attemptId)
      .order("created_at", { ascending: true });

    if (messagesError) {
      return NextResponse.json(
        { error: messagesError.message },
        { status: 500 }
      );
    }

    const conversationTranscript = (messages ?? [])
      .map((m) => `${String(m.speaker).toUpperCase()}: ${m.message}`)
      .join("\n");

    const deliverySummary = (messages ?? [])
      .filter((m) => m.speaker === "staff")
      .map((m) => ({
        message: m.message,
        audio_duration_seconds: m.audio_duration_seconds,
        words_per_minute: m.words_per_minute,
        delivery_notes: m.delivery_notes,
      }));

    const finalScore = await scoreVoiceRoleplay({
      scenario,
      conversationTranscript,
      deliverySummary,
    });

    const { error: updateError } = await supabase
      .from("communication_voice_roleplay_attempts")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        transcript: conversationTranscript,
        score: finalScore.overall_score ?? null,
        content_score: finalScore.content_score ?? null,
        delivery_score: finalScore.delivery_score ?? null,
        delivery_feedback: deliverySummary,
        final_coaching: finalScore,
        feedback: finalScore,
      })
      .eq("id", attemptId);

    if (updateError) {
      return NextResponse.json(
        { error: updateError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ finalScore });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      { error: "Could not finish voice roleplay." },
      { status: 500 }
    );
  }
}