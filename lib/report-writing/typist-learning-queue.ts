import type { SupabaseClient } from "@supabase/supabase-js"
import { prepareApprovedEdit, type ApprovedEditInput } from "./approved-edit-input"
import type { EditLearningResult } from "./edit-learning-analysis"

export const TYPIST_LEARNING_SOURCES = [
  "typist_direct_approval",
  "typist_image_workspace_final_save",
  "typist_existing_draft_approval",
] as const

export type ApprovalLearningResult = Omit<EditLearningResult, "analysisStatus"> & {
  analysisStatus: EditLearningResult["analysisStatus"] | "pending" | "processing"
}

export function isTypistLearningApproval(status: unknown, enabled: unknown, source: string) {
  return status === "approved" && Boolean(enabled) &&
    TYPIST_LEARNING_SOURCES.some(value => value === source)
}

function requestedLearning(): ApprovalLearningResult {
  return {
    requested: true, exampleSaved: false, exampleId: null, duplicate: false,
    analysisStatus: "pending", behavioursCreated: 0, behavioursReinforced: 0,
    error: null,
  }
}

export async function enqueueTypistLearning(db: SupabaseClient, input: ApprovedEditInput) {
  const prepared = prepareApprovedEdit(input)
  if (!prepared) return {
    learningQueued: false,
    learning: { ...requestedLearning(), analysisStatus: "ignored" as const,
      error: "Original and final text were missing or unchanged." },
  }

  const fields = "id,analysis_status,next_attempt_at"
  const now = new Date().toISOString()
  const inserted = await db.from("provider_report_edit_examples").insert({
    ...prepared, analysis_status: "pending", analysis_attempts: 0,
    analysis_error: null, analysis_json: {}, updated_at: now, next_attempt_at: now,
  }).select(fields).single()

  let example = inserted.data
  const duplicate = inserted.error?.code === "23505"
  if (duplicate) {
    // A conflict never overwrites the snapshot or resets processing/retry state.
    const existing = await db.from("provider_report_edit_examples")
      .select(fields).eq("edit_fingerprint", prepared.edit_fingerprint).single()
    if (existing.error) throw new Error("learning_enqueue_failed")
    example = existing.data
  } else if (inserted.error) throw new Error("learning_enqueue_failed")
  if (!example) throw new Error("learning_enqueue_failed")

  const status = String(example.analysis_status)
  const learningQueued = Boolean(example.next_attempt_at) ||
    status === "processed" || status === "ignored" ||
    (duplicate && status === "failed")
  return {
    learningQueued,
    learning: { ...requestedLearning(), exampleSaved: true,
      exampleId: String(example.id), duplicate,
      analysisStatus: status as ApprovalLearningResult["analysisStatus"],
      error: learningQueued ? null : "existing_learning_not_enrolled" },
  }
}

// Called only after successful draft persistence and existing queue handling.
// Keep the legacy learning-before-audit order for every other approval flow.
export async function finishApprovalLearning(options: {
  typist: boolean
  synchronous: () => Promise<EditLearningResult>
  audit: (learning: ApprovalLearningResult) => Promise<void>
  enqueue: () => Promise<{ learningQueued: boolean; learning: ApprovalLearningResult }>
}) {
  if (!options.typist) {
    const learning = await options.synchronous()
    await options.audit(learning)
    return { learning }
  }
  await options.audit(requestedLearning())
  try {
    return await options.enqueue()
  } catch {
    // The draft is already approved. Never turn enqueue failure into save failure.
    console.error("Typist learning enqueue failed: learning_enqueue_failed")
    return {
      learningQueued: false,
      learning: { ...requestedLearning(), analysisStatus: "failed" as const,
        error: "learning_enqueue_failed" },
    }
  }
}
