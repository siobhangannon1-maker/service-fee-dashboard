import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  analyseVoiceDelivery,
  generatePatientVoiceReply,
  transcribeVoiceRoleplayAudio,
} from "@/lib/communication-excellence/voice-roleplay-ai";

type RouteProps = {
  params: Promise<{
    attemptId: string;
  }>;
};

export async function POST(request: NextRequest, { params }: RouteProps) {
  try {
    const { attemptId } = await params;
    const supabase = await createClient();

    const formData = await request.formData();

    const audio = formData.get("audio");
    const durationRaw = formData.get("durationSeconds");

    if (!(audio instanceof File)) {
      return NextResponse.json(
        { error: "No audio file received." },
        { status: 400 }
      );
    }

    const audioDurationSeconds = durationRaw ? Number(durationRaw) : null;

    const { text } = await transcribeVoiceRoleplayAudio(audio);

    if (!text) {
      return NextResponse.json(
        { error: "No speech could be transcribed. Please try again." },
        { status: 400 }
      );
    }

    const wordCount = text.split(/\s+/).filter(Boolean).length;
    const wordsPerMinute =
      audioDurationSeconds && audioDurationSeconds > 0
        ? Math.round((wordCount / audioDurationSeconds) * 60)
        : null;

    const deliveryNotes = await analyseVoiceDelivery({
      transcript: text,
      audioDurationSeconds,
      wordsPerMinute,
    });

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

    const { error: staffMessageError } = await supabase
      .from("communication_voice_roleplay_messages")
      .insert({
        attempt_id: attemptId,
        speaker: "staff",
        message: text,
        audio_duration_seconds: audioDurationSeconds,
        words_per_minute: wordsPerMinute,
        delivery_notes: deliveryNotes,
      });

    if (staffMessageError) {
      return NextResponse.json(
        { error: staffMessageError.message },
        { status: 500 }
      );
    }

    const { data: messages, error: messagesError } = await supabase
      .from("communication_voice_roleplay_messages")
      .select("speaker, message")
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

    const patientReply = await generatePatientVoiceReply({
      scenario,
      conversationTranscript,
    });

    const { error: patientMessageError } = await supabase
      .from("communication_voice_roleplay_messages")
      .insert({
        attempt_id: attemptId,
        speaker: "patient",
        message: patientReply,
      });

    if (patientMessageError) {
      return NextResponse.json(
        { error: patientMessageError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      staffTranscript: text,
      patientReply,
      audioDurationSeconds,
      wordsPerMinute,
      deliveryNotes,
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      { error: "Voice turn failed. Please try again." },
      { status: 500 }
    );
  }
}