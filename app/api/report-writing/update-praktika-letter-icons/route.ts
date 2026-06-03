import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentUserPraktikaSessionMode } from "@/lib/praktika/hybrid-session-store";
import { praktikaHelperPost } from "@/lib/praktika/helper-job-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const TYPIST_LETTER_ICON_ID = 7360;
const LETTER_SENT_ICON_ID = 6597;

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildRequestId() {
  return `letter_icon_${Date.now()}_${crypto.randomUUID()}`;
}

function replaceTypistLetterIcon(iconIds: number[]) {
  const updated = iconIds.map((id) =>
    id === TYPIST_LETTER_ICON_ID ? LETTER_SENT_ICON_ID : id,
  );

  if (!updated.includes(LETTER_SENT_ICON_ID)) {
    const emptyIndex = updated.findIndex((id) => id === 0);

    if (emptyIndex >= 0) {
      updated[emptyIndex] = LETTER_SENT_ICON_ID;
    }
  }

  return updated.slice(0, 4);
}

async function findQueueItem(params: { queueId?: string; draftId?: string }) {
  if (params.queueId) {
    const { data, error } = await supabase
      .from("report_letter_queue")
      .select("*")
      .eq("id", params.queueId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (data) return data;
  }

  if (params.draftId) {
    const { data, error } = await supabase
      .from("report_letter_queue")
      .select("*")
      .eq("report_draft_id", params.draftId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (data) return data;
  }

  return null;
}

export async function POST(req: Request) {
  try {
    const mode = await getCurrentUserPraktikaSessionMode();
    const body = await req.json();
    const queueId = clean(body.queueId);
    const draftId = clean(body.draftId);

    if (!queueId && !draftId) {
      return NextResponse.json(
        { success: false, error: "Missing queueId or draftId." },
        { status: 400 },
      );
    }

    const practiceId = Number(process.env.PRAKTIKA_PRACTICE_ID || "1181");
    const queueItem = await findQueueItem({ queueId, draftId });

    if (!queueItem) {
      return NextResponse.json(
        {
          success: false,
          error:
            "No linked queue item found for this draft. Open the item from the queue before creating the draft, or link the queue item to the draft.",
        },
        { status: 404 },
      );
    }

    const raw = queueItem.raw_json || {};
    const appointmentId =
      clean(queueItem.appointment_id) || clean(raw.iAppointmentId);

    if (!appointmentId) {
      return NextResponse.json(
        { success: false, error: "Missing appointment ID." },
        { status: 400 },
      );
    }

    const currentIconIds = [
      numberValue(raw.iIcon1Id),
      numberValue(raw.iIcon2Id),
      numberValue(raw.iIcon3Id),
      numberValue(raw.iIcon4Id),
    ];

    const updatedIconIds = replaceTypistLetterIcon(currentIconIds);

    const response = await praktikaHelperPost<any>({
      mode,
      jobType: "update_praktika_letter_icons",
      path: "/php/forms/db_commitFormData.php",
      contentType: "json",
      referer: "https://praktika.praktika.net.au/v2/scheduler",
      priority: 20,
      body: [
        {
          request_id: buildRequestId(),
          practice_id: practiceId,
          appointment_id: Number(appointmentId),
          appointment_icon1id: updatedIconIds[0],
          appointment_icon2id: updatedIconIds[1],
          appointment_icon3id: updatedIconIds[2],
          appointment_icon4id: updatedIconIds[3],
        },
      ],
    });

    const responsePreview =
      typeof response === "string"
        ? response.slice(0, 500)
        : JSON.stringify(response).slice(0, 500);

    const now = new Date().toISOString();

    const { error: updateError } = await supabase
      .from("report_letter_queue")
      .update({
        status: "completed",
        report_draft_id: draftId || queueItem.report_draft_id || null,
        updated_at: now,
        raw_json: {
          ...raw,
          iIcon1Id: String(updatedIconIds[0]),
          iIcon2Id: String(updatedIconIds[1]),
          iIcon3Id: String(updatedIconIds[2]),
          iIcon4Id: String(updatedIconIds[3]),
          letterIconUpdatedAt: now,
          letterIconUpdateResponsePreview: responsePreview,
        },
      })
      .eq("id", queueItem.id);

    if (updateError) {
      return NextResponse.json(
        {
          success: false,
          error: `Praktika icons updated, but queue status failed: ${updateError.message}`,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      queueId: queueItem.id,
      appointmentId,
      oldIconIds: currentIconIds,
      newIconIds: updatedIconIds,
    });
  } catch (error) {
    console.error("Update Praktika letter icons failed:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to update Praktika letter icons.",
      },
      { status: 500 },
    );
  }
}
