import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { writePraktikaConfirmationBack } from "@/lib/reception/praktika-writeback";

async function requireUser() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user;
}

async function processQueueItem(item: any) {
  if (item.writeback_type === "appointment_confirmation") {
    const result = await writePraktikaConfirmationBack({
      conversationId: item.conversation_id,
      appointmentId: String(item.praktika_appointment_id),
      note: item.payload?.note || "Confirmed YES via text message",
    });

    if (result.errors.length > 0) {
      throw new Error(result.errors.join("; "));
    }

    return result;
  }

  throw new Error(`Unsupported writeback type: ${item.writeback_type}`);
}

export async function GET(request: NextRequest) {
  const user = await requireUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const status = request.nextUrl.searchParams.get("status") || "pending";

  const { data, error } = await supabaseAdmin
    .from("reception_praktika_writeback_queue")
    .select("*")
    .eq("status", status)
    .order("created_at", { ascending: true })
    .limit(100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ items: data || [] });
}

export async function POST(request: NextRequest) {
  const user = await requireUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const id = body.id ? String(body.id) : null;
  const processAll = Boolean(body.processAll);

  let query = supabaseAdmin
    .from("reception_praktika_writeback_queue")
    .select("*")
    .in("status", ["pending", "failed"])
    .order("created_at", { ascending: true });

  if (id) {
    query = query.eq("id", id);
  } else if (!processAll) {
    return NextResponse.json(
      { error: "Provide id or processAll=true." },
      { status: 400 }
    );
  }

  const { data: items, error } = await query.limit(processAll ? 50 : 1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results = [];

  for (const item of items || []) {
    try {
      await supabaseAdmin
        .from("reception_praktika_writeback_queue")
        .update({
          status: "processing",
          attempts: (item.attempts || 0) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", item.id);

      const result = await processQueueItem(item);

      await supabaseAdmin
        .from("reception_praktika_writeback_queue")
        .update({
          status: "completed",
          last_error: null,
          processed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", item.id);

      await supabaseAdmin.from("reception_audit_logs").insert({
        conversation_id: item.conversation_id,
        action: "praktika_writeback_queue_item_completed",
        details: {
          queue_id: item.id,
          writeback_type: item.writeback_type,
          praktika_appointment_id: item.praktika_appointment_id,
          result,
        },
      });

      results.push({
        id: item.id,
        ok: true,
        result,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not process writeback.";

      await supabaseAdmin
        .from("reception_praktika_writeback_queue")
        .update({
          status: "failed",
          last_error: message,
          updated_at: new Date().toISOString(),
        })
        .eq("id", item.id);

      await supabaseAdmin.from("reception_audit_logs").insert({
        conversation_id: item.conversation_id,
        action: "praktika_writeback_queue_item_failed",
        details: {
          queue_id: item.id,
          writeback_type: item.writeback_type,
          praktika_appointment_id: item.praktika_appointment_id,
          error: message,
        },
      });

      results.push({
        id: item.id,
        ok: false,
        error: message,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    processedCount: results.length,
    successCount: results.filter((item) => item.ok).length,
    failedCount: results.filter((item) => !item.ok).length,
    results,
  });
}
