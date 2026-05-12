import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { previewLearningRuleAutomationForInboxItem } from "@/lib/ai/automation/learningRuleAutomationPreview";
import { executeLearningRuleAutomationForInboxItem } from "@/lib/ai/automation/executeLearningRuleAutomation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ACTIVE_STATUSES = [
  "uploaded",
  "processing",
  "classified",
  "classification_failed",
  "pending",
  "drafted",
  "ready_to_send",
  "outlook_draft_created",
];

function getInitials(name?: string | null, email?: string | null) {
  const cleanName = String(name || "").trim();

  if (cleanName) {
    return cleanName
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("");
  }

  const cleanEmail = String(email || "").trim();
  if (cleanEmail) return cleanEmail.slice(0, 2).toUpperCase();

  return "AI";
}

function itemDisplayName(item: any) {
  return (
    item.patient_name ||
    [item.extracted_patient_first_name, item.extracted_patient_last_name]
      .filter(Boolean)
      .join(" ") ||
    item.email_subject ||
    item.subject ||
    item.file_name ||
    item.id
  );
}

async function getActor(user: any) {
  let fullName: string | null = null;

  if (user?.id) {
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .maybeSingle();

    fullName = profile?.full_name || null;
  }

  return {
    userId: user?.id || null,
    email: user?.email || null,
    fullName,
    initials: getInitials(fullName, user?.email || null),
  };
}

export async function POST(request: Request) {
  try {
    const { user } = await requireRole(["super_admin"]);
    const actor = await getActor(user);

    const body = await request.json().catch(() => ({}));
    const dryRun = body?.dryRun !== false;
    const limit = Math.min(Math.max(Number(body?.limit || 25), 1), 50);

    const { data: items, error } = await supabaseAdmin
      .from("ai_inbox_items")
      .select(
        "id, patient_name, extracted_patient_first_name, extracted_patient_last_name, email_subject, subject, file_name, status, archived_at, automation_execution_status",
      )
      .is("archived_at", null)
      .in("status", ACTIVE_STATUSES)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 },
      );
    }

    const results: Array<{
      inboxItemId: string;
      status: "eligible" | "executed" | "skipped" | "failed";
      patientName?: string | null;
      subject?: string | null;
      allowedActions?: string[];
      reason?: string;
      error?: string;
    }> = [];

    for (const item of items || []) {
      try {
        if (item.automation_execution_status === "running") {
          results.push({
            inboxItemId: item.id,
            status: "skipped",
            patientName: itemDisplayName(item),
            reason: "Automation is already running for this item.",
          });
          continue;
        }

        const preview = await previewLearningRuleAutomationForInboxItem({
          inboxItemId: item.id,
        });

        const allowedActions = preview.allowedActions || [];

        if (!allowedActions.includes("file_to_praktika")) {
          results.push({
            inboxItemId: item.id,
            status: "skipped",
            patientName: itemDisplayName(item),
            allowedActions,
            reason:
              preview.blockedActions.find(
                (blocked) => blocked.action === "file_to_praktika",
              )?.reason || "File to Praktika is not allowed by preview.",
          });
          continue;
        }

        if (dryRun) {
          results.push({
            inboxItemId: item.id,
            status: "eligible",
            patientName: itemDisplayName(item),
            allowedActions,
            reason: "Preview only. Safe filing automation is eligible.",
          });
          continue;
        }

        const execution = await executeLearningRuleAutomationForInboxItem({
          inboxItemId: item.id,
          actor,
        });

        if (!execution.ok) {
          results.push({
            inboxItemId: item.id,
            status: "failed",
            patientName: itemDisplayName(item),
            allowedActions,
            error: execution.error || "Automation execution failed.",
          });
          continue;
        }

        results.push({
          inboxItemId: item.id,
          status: "executed",
          patientName: itemDisplayName(item),
          allowedActions,
          reason: execution.message || "Automation executed.",
        });
      } catch (error: any) {
        results.push({
          inboxItemId: item.id,
          status: "failed",
          patientName: itemDisplayName(item),
          error: error?.message || "Automation preview/execution failed.",
        });
      }
    }

    const eligible = results.filter((row) => row.status === "eligible").length;
    const executed = results.filter((row) => row.status === "executed").length;
    const failed = results.filter((row) => row.status === "failed").length;
    const skipped = results.filter((row) => row.status === "skipped").length;

    return NextResponse.json(
      {
        ok: true,
        mode: dryRun ? "preview" : "execute",
        scanned: items?.length || 0,
        eligible,
        executed,
        skipped,
        failed,
        message: dryRun
          ? eligible > 0
            ? `${eligible} item${eligible === 1 ? "" : "s"} eligible for safe automation.`
            : "No items are currently eligible for safe automation."
          : executed > 0
            ? `Executed safe automation for ${executed} item${executed === 1 ? "" : "s"}.`
            : "No safe automations were executed.",
        results,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Bulk safe automation failed.",
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
