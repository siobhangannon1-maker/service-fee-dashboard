import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function GET() {
  try {
    await requireRole(["admin", "practice_manager"]);

    const { data, error } = await supabaseAdmin
      .from("ai_response_templates")
      .select("*")
      .order("category", { ascending: true })
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ templates: data || [] });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load templates" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    await requireRole(["admin", "practice_manager"]);

    const body = await req.json();

    const {
      category,
      title,
      subject_template,
      body_template,
      tone_notes,
      avoid_notes,
    } = body;

    if (!category || !title || !body_template) {
      return NextResponse.json(
        { error: "Category, title and body template are required." },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("ai_response_templates")
      .insert({
        category,
        title,
        subject_template: subject_template || null,
        body_template,
        tone_notes: tone_notes || null,
        avoid_notes: avoid_notes || null,
        is_active: true,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, template: data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save template" },
      { status: 500 }
    );
  }
}