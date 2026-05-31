import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type RouteProps = {
  params: Promise<{
    attemptId: string;
  }>;
};

export async function GET(_request: Request, { params }: RouteProps) {
  const { attemptId } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("communication_voice_roleplay_messages")
    .select("*")
    .eq("attempt_id", attemptId)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ messages: data ?? [] });
}