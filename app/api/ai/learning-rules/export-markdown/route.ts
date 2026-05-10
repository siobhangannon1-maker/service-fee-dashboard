import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

function escapeMarkdown(value: string | null | undefined) {
  return String(value || "").trim();
}

export async function GET() {
  await requireRole(["super_admin"]);

  const { data: rules, error } = await supabaseAdmin
    .from("ai_learning_rules")
    .select("*")
    .eq("is_active", true)
    .order("priority", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const grouped = new Map<string, any[]>();

  for (const rule of rules || []) {
    const type = rule.rule_type || "general";
    grouped.set(type, [...(grouped.get(type) || []), rule]);
  }

  const lines: string[] = [];

  lines.push("# AI Practice Learning Rules");
  lines.push("");
  lines.push(`Last exported: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("> Supabase is the source of truth. This note is an exported copy.");
  lines.push("");

  for (const [type, groupRules] of grouped.entries()) {
    lines.push(`## ${type}`);
    lines.push("");

    for (const rule of groupRules) {
      lines.push(`### ${escapeMarkdown(rule.title || "Untitled rule")}`);
      lines.push("");
      lines.push(`- Category: ${escapeMarkdown(rule.category || "all")}`);
      lines.push(`- Priority: ${rule.priority ?? 100}`);
      lines.push("");
      lines.push(escapeMarkdown(rule.rule));
      lines.push("");
    }
  }

  return new NextResponse(lines.join("\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition":
        'attachment; filename="AI Practice Learning Rules.md"',
    },
  });
}