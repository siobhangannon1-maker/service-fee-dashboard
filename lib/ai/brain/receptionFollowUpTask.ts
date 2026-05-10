import { supabaseAdmin } from "@/lib/supabase/admin";

type ReceptionTaskKind = "radiology" | "pathology" | "referral";

type TrelloCardResult = {
  id: string;
  url: string;
  shortUrl?: string;
};

function getTrelloCredentials() {
  const key =
    process.env.TRELLO_API_KEY ||
    process.env.TRELLO_KEY ||
    process.env.NEXT_PUBLIC_TRELLO_API_KEY;

  const token =
    process.env.TRELLO_API_TOKEN ||
    process.env.TRELLO_TOKEN ||
    process.env.NEXT_PUBLIC_TRELLO_TOKEN;

  if (!key || !token) {
    throw new Error("Missing Trello API key/token.");
  }

  return { key, token };
}

function getReceptionListId(kind: ReceptionTaskKind) {
  if (kind === "radiology") {
    return process.env.RECEPTION_TRELLO_RADIOLOGY_LIST_ID || "";
  }

  if (kind === "pathology") {
    return process.env.RECEPTION_TRELLO_PATHOLOGY_LIST_ID || "";
  }

  if (kind === "referral") {
    return process.env.RECEPTION_TRELLO_REFERRAL_LIST_ID || "";
  }

  return "";
}

function getTextBlob(item: any) {
  return [
    item.workflow_kind,
    item.operational_workflow_kind,
    item.workflow_classification,
    item.classification,
    item.email_subject,
    item.subject,
    item.summary,
    item.suggested_action,
    item.workflow_classification_reason,
    item.extracted_text,
    item.raw_text,
    item.email_body,
    item.body,
  ]
    .filter(Boolean)
    .join("\n\n")
    .toLowerCase();
}

function detectReceptionTaskKind(item: any): ReceptionTaskKind | null {
  const text = getTextBlob(item);

  if (
    text.includes("radiology") ||
    text.includes("xray") ||
    text.includes("x-ray") ||
    text.includes("cbct") ||
    text.includes("opg") ||
    text.includes("scan")
  ) {
    return "radiology";
  }

  if (
    text.includes("pathology") ||
    text.includes("histopathology") ||
    text.includes("biopsy") ||
    text.includes("specimen")
  ) {
    return "pathology";
  }

  if (
    text.includes("referral") ||
    text.includes("referred") ||
    text.includes("please see") ||
    text.includes("specialist referral")
  ) {
    return "referral";
  }

  return null;
}

function getPatientLabel(item: any) {
  const extractedName = [
    item.extracted_patient_first_name,
    item.extracted_patient_last_name,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  if (extractedName) return extractedName;

  if (item.patient_name) return item.patient_name;

  return "Patient not confirmed";
}

function buildTaskTitle({
  item,
  kind,
}: {
  item: any;
  kind: ReceptionTaskKind;
}) {
  const patient = getPatientLabel(item);

  if (kind === "radiology") {
    return `Radiology follow-up: download X-ray and upload to patient file — ${patient}`;
  }

  if (kind === "pathology") {
    return `Pathology result: upload to patient file — ${patient}`;
  }

  return `Referral received: file referral and create Praktika referral — ${patient}`;
}

function buildTaskDescription({
  item,
  kind,
}: {
  item: any;
  kind: ReceptionTaskKind;
}) {
  const lines = [
    `AI Reception follow-up task`,
    ``,
    `Task type: ${kind}`,
    `Inbox item ID: ${item.id}`,
    `Patient: ${getPatientLabel(item)}`,
    `Praktika patient ID: ${item.praktika_patient_id || "Not matched"}`,
    `Praktika patient number: ${item.praktika_patient_number || "Not matched"}`,
    `Match status: ${item.praktika_match_status || "Not run"}`,
    `Match confidence: ${
      item.praktika_match_confidence != null
        ? `${Math.round(Number(item.praktika_match_confidence) * 100)}%`
        : "N/A"
    }`,
    ``,
  ];

  if (kind === "radiology") {
    lines.push(
      `Reception action:`,
      `1. Download X-ray/radiology image/report from source portal if required.`,
      `2. Confirm Praktika patient match.`,
      `3. Upload X-ray/report to patient file.`,
      `4. Notify clinician if review is needed.`,
    );
  }

  if (kind === "pathology") {
    lines.push(
      `Reception action:`,
      `1. Confirm Praktika patient match.`,
      `2. Upload pathology result to patient file.`,
      `3. Notify clinician for review.`,
    );
  }

  if (kind === "referral") {
    lines.push(
      `Reception action:`,
      `1. Confirm whether patient exists in Praktika.`,
      `2. If no patient exists, create new patient file after staff review.`,
      `3. Upload referral document to patient file.`,
      `4. Create referral in Praktika after staff review.`,
      `5. Continue booking/intake workflow.`,
    );
  }

  lines.push(
    ``,
    `Subject: ${item.email_subject || item.subject || "No subject"}`,
    `Sender: ${item.sender_email || item.sender_name || "Unknown sender"}`,
  );

  if (item.summary) {
    lines.push(``, `AI summary:`, item.summary);
  }

  return lines.join("\n");
}

async function createTrelloCard({
  listId,
  name,
  desc,
}: {
  listId: string;
  name: string;
  desc: string;
}): Promise<TrelloCardResult> {
  const { key, token } = getTrelloCredentials();

  if (!listId) {
    throw new Error("Missing reception Trello list ID.");
  }

  const body = new URLSearchParams();
  body.set("idList", listId);
  body.set("name", name);
  body.set("desc", desc);
  body.set("pos", "top");

  const response = await fetch(
    `https://api.trello.com/1/cards?key=${encodeURIComponent(
      key,
    )}&token=${encodeURIComponent(token)}`,
    {
      method: "POST",
      body,
    },
  );

  const text = await response.text();

  let json: any = null;

  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  if (!response.ok) {
    throw new Error(
      json?.message ||
        `Trello card creation failed. Status ${response.status}: ${text.slice(
          0,
          300,
        )}`,
    );
  }

  return {
    id: json.id,
    url: json.url || json.shortUrl,
    shortUrl: json.shortUrl,
  };
}

async function loadInboxItem(inboxItemId: string) {
  const { data, error } = await supabaseAdmin
    .from("ai_inbox_items")
    .select("*")
    .eq("id", inboxItemId)
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Inbox item not found.");
  }

  return data;
}

export async function ensureReceptionFollowUpTaskForInboxItem({
  inboxItemId,
  force = false,
}: {
  inboxItemId: string;
  force?: boolean;
}) {
  const item = await loadInboxItem(inboxItemId);

  if (item.reception_trello_card_id && !force) {
    return {
      skipped: true,
      reason: "Reception Trello task already exists.",
      item,
    };
  }

  const kind = detectReceptionTaskKind(item);

  if (!kind) {
    await supabaseAdmin
      .from("ai_inbox_items")
      .update({
        reception_trello_task_status: "not_required",
        reception_trello_task_reason:
          "No radiology/pathology/referral reception follow-up task detected.",
        reception_trello_task_error: null,
      })
      .eq("id", inboxItemId);

    return {
      skipped: true,
      reason: "No reception follow-up task required.",
      item,
    };
  }

  try {
    const listId = getReceptionListId(kind);

    const card = await createTrelloCard({
      listId,
      name: buildTaskTitle({ item, kind }),
      desc: buildTaskDescription({ item, kind }),
    });

    const { data: updatedItem, error } = await supabaseAdmin
      .from("ai_inbox_items")
      .update({
        reception_trello_card_id: card.id,
        reception_trello_card_url: card.url,
        reception_trello_task_status: "created",
        reception_trello_task_reason: `Created ${kind} reception follow-up task.`,
        reception_trello_task_error: null,
        reception_trello_task_created_at: new Date().toISOString(),
      })
      .eq("id", inboxItemId)
      .select("*")
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return {
      skipped: false,
      kind,
      card,
      item: updatedItem,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to create reception Trello task.";

    await supabaseAdmin
      .from("ai_inbox_items")
      .update({
        reception_trello_task_status: "failed",
        reception_trello_task_error: message,
      })
      .eq("id", inboxItemId);

    throw error;
  }
}