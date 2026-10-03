import { randomUUID } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { EditAnalysis } from "./edit-learning-analysis"

export type SavedLearningExample = {
  id: string
  provider_id: string | null
  report_type: string | null
  original_text: string | null
  final_text: string | null
  editor_role: string | null
  source: string
  claim_token: string
  analysis_attempts: number
}

export type LearningAnalysisInput = {
  reportType: string; originalText: string; finalText: string
  actorRole: string; source: string
}
type WorkerEvent = {
  status: string; exampleId?: string; attempt?: number
  category?: string; durationMs?: number
}

export class LearningConfigurationError extends Error {
  constructor() { super("worker_configuration_missing") }
}

function failureCategory(error: unknown) {
  if (error instanceof LearningConfigurationError) {
    return { category: "worker_configuration_missing", retryable: false }
  }
  const status = error && typeof error === "object" && "status" in error
    ? Number(error.status) : null
  if (status && [400, 401, 403, 404, 422].includes(status)) {
    return { category: "analysis_rejected", retryable: false }
  }
  return { category: "learning_execution_failed", retryable: true }
}

export async function processSavedLearningExample(options: {
  db: Pick<SupabaseClient, "rpc">
  example: SavedLearningExample
  analyse: (input: LearningAnalysisInput) => Promise<EditAnalysis>
  log: (event: WorkerEvent) => void
}) {
  const { db, example, analyse, log } = options
  const started = Date.now()
  const finish = async (analysis: EditAnalysis | null, category: string | null, retryable: boolean) => {
    const result = await db.rpc("finish_typist_edit_learning", {
      p_id: example.id, p_token: example.claim_token, p_analysis: analysis,
      p_failure_code: category, p_retryable: retryable,
    })
    if (result.error) throw new Error("completion_failed")
    return result.data === true
  }
  const context = { exampleId: example.id, attempt: example.analysis_attempts }
  try {
    if (!example.provider_id || !example.report_type?.trim() ||
        !example.original_text?.trim() || !example.final_text?.trim() ||
        example.original_text.trim() === example.final_text.trim() ||
        !["provider", "typist", "admin", "staff", "unknown"].includes(example.editor_role || "")) {
      const accepted = await finish(null, "invalid_saved_input", false)
      log({ ...context, status: accepted ? "failed" : "claim_lost", category: "invalid_saved_input" })
      return
    }
    // No draft lookup: the example is the entire learning input.
    const analysis = await analyse({
      reportType: example.report_type,
      originalText: example.original_text,
      finalText: example.final_text,
      actorRole: example.editor_role!,
      source: example.source,
    })
    const accepted = await finish(analysis, null, false)
    log({ ...context, status: accepted ? (analysis.reusable ? "processed" : "ignored") : "claim_lost",
      durationMs: Date.now() - started })
  } catch (error) {
    const { category, retryable } = failureCategory(error)
    try {
      const accepted = await finish(null, category, retryable)
      log({ ...context, status: accepted ? "failed" : "claim_lost", category,
        durationMs: Date.now() - started })
    } catch {
      // Leave the claim for lease recovery. Never log the exception or input.
      log({ ...context, status: "lease_recovery_required", category: "failure_record_unavailable" })
    }
  }
}

export async function runTypistLearningWorker(options: {
  db: Pick<SupabaseClient, "rpc">
  analyse: (input: LearningAnalysisInput) => Promise<EditAnalysis>
  stopping: () => boolean
  log: (event: WorkerEvent) => void
  sleep?: (ms: number) => Promise<void>
}) {
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  while (!options.stopping()) {
    try {
      const result = await options.db.rpc("claim_typist_edit_learning", { p_token: randomUUID() })
      if (result.error) throw new Error("claim_unavailable")
      const example = (result.data as SavedLearningExample[] | null)?.[0]
      if (example) {
        await processSavedLearningExample({ ...options, example })
        continue
      }
    } catch {
      options.log({ status: "poll_failed", category: "claim_unavailable" })
    }
    if (!options.stopping()) await sleep(5000)
  }
}
