import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

async function requireUser() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user;
}

function normalizeQuestions(questions: any[]) {
  return (questions || [])
    .map((question, index) => ({
      id:
        question.id ||
        String(question.label || `question_${index + 1}`)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_+|_+$/g, ""),
      label: String(question.label || "").trim(),
      type: question.type === "textarea" ? "textarea" : "yes_no",
      urgentOn:
        question.urgentOn === "yes" ||
        question.urgentOn === "no" ||
        question.urgentOn === "any_text"
          ? question.urgentOn
          : null,
    }))
    .filter((question) => question.label);
}

export async function GET() {
  const user = await requireUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin
    .from("reception_questionnaire_templates")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ templates: data || [] });
}

export async function POST(request: NextRequest) {
  const user = await requireUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();

  if (!body.name?.trim()) {
    return NextResponse.json({ error: "Name is required." }, { status: 400 });
  }

  const questions = normalizeQuestions(body.questions || []);

  if (questions.length === 0) {
    return NextResponse.json(
      { error: "At least one question is required." },
      { status: 400 }
    );
  }

  const { data, error } = await supabaseAdmin
    .from("reception_questionnaire_templates")
    .insert({
      name: body.name.trim(),
      description: body.description?.trim() || null,
      trigger_keywords: String(body.triggerKeywords || "")
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
      sms_body: body.smsBody || "",
      questions,
      is_active: body.isActive !== false,
      updated_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ template: data });
}

export async function PATCH(request: NextRequest) {
  const user = await requireUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();

  if (!body.id) {
    return NextResponse.json(
      { error: "Template ID is required." },
      { status: 400 }
    );
  }

  const updatePayload: any = {
    updated_at: new Date().toISOString(),
  };

  if (body.name !== undefined) {
    updatePayload.name = String(body.name).trim();
  }

  if (body.description !== undefined) {
    updatePayload.description = String(body.description || "").trim() || null;
  }

  if (body.triggerKeywords !== undefined) {
    updatePayload.trigger_keywords = String(body.triggerKeywords || "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
  }

  if (body.smsBody !== undefined) {
    updatePayload.sms_body = String(body.smsBody || "");
  }

  if (body.questions !== undefined) {
    const questions = normalizeQuestions(body.questions || []);

    if (questions.length === 0) {
      return NextResponse.json(
        { error: "At least one question is required." },
        { status: 400 }
      );
    }

    updatePayload.questions = questions;
  }

  if (typeof body.isActive === "boolean") {
    updatePayload.is_active = body.isActive;
  }

  const { data, error } = await supabaseAdmin
    .from("reception_questionnaire_templates")
    .update(updatePayload)
    .eq("id", body.id)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ template: data });
}

export async function DELETE(request: NextRequest) {
  const user = await requireUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = request.nextUrl.searchParams.get("id");

  if (!id) {
    return NextResponse.json(
      { error: "Template ID is required." },
      { status: 400 }
    );
  }

  const { error } = await supabaseAdmin
    .from("reception_questionnaire_templates")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
