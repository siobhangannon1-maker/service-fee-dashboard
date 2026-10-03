import { createOrReinforceBehaviour } from "./behaviour-reinforcement"
import OpenAI from "openai"
import { createClient } from "@supabase/supabase-js"
import type { AuditActor } from "@/lib/report-writing/audit"
import { prepareApprovedEdit } from "./approved-edit-input"
import { clean, makeFingerprint, analyseApprovedEdit, type EditLearningResult } from "./edit-learning-analysis"
export type { EditLearningResult } from "./edit-learning-analysis"

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)


export async function processApprovedEdit(params: {
  providerId: string
  draftId: string
  reportType: string
  originalText: string
  finalText: string
  source: string
  actor: AuditActor
  approvedByProvider?: boolean
}): Promise<EditLearningResult> {
  const prepared = prepareApprovedEdit(params)
  const originalText = clean(params.originalText)
  const finalText = clean(params.finalText)

  const baseResult: EditLearningResult = {
    requested: true,
    exampleSaved: false,
    exampleId: null,
    duplicate: false,
    analysisStatus: "failed",
    behavioursCreated: 0,
    behavioursReinforced: 0,
    error: null,
  }

  if (!prepared) {
    return {
      ...baseResult,
      analysisStatus: "ignored",
      error: "Original and final text were missing or unchanged.",
    }
  }

  const fingerprint = makeFingerprint({
    draftId: params.draftId,
    originalText,
    finalText,
    source: params.source,
  })

  try {
    const { data: existingExample, error: existingExampleError } = await supabase
      .from("provider_report_edit_examples")
      .select("id, analysis_status")
      .eq("edit_fingerprint", fingerprint)
      .maybeSingle()

    if (existingExampleError) throw new Error(existingExampleError.message)

    if (existingExample) {
      return {
        ...baseResult,
        exampleSaved: true,
        exampleId: existingExample.id,
        duplicate: true,
        analysisStatus:
          existingExample.analysis_status === "processed"
            ? "processed"
            : existingExample.analysis_status === "ignored"
              ? "ignored"
              : "failed",
        error: null,
      }
    }

    const { data: example, error: insertError } = await supabase
      .from("provider_report_edit_examples")
      .insert({
        ...prepared,
        analysis_status: "processing",
        analysis_attempts: 1,
        analysis_error: null,
        analysis_json: {},
        updated_at: new Date().toISOString(),
      })
      .select("id")
      .single()

    if (insertError || !example) {
      throw new Error(insertError?.message || "Could not save learning example.")
    }

    baseResult.exampleSaved = true
    baseResult.exampleId = example.id

    if (!process.env.OPENAI_API_KEY) {
      throw new Error("Missing OPENAI_API_KEY.")
    }

    const analysis = await analyseApprovedEdit(openai, {
      reportType: params.reportType,
      originalText,
      finalText,
      actorRole: params.actor.actorRole,
      source: params.source,
    })

    if (!analysis.reusable || analysis.behaviours.length === 0) {
      await supabase
        .from("provider_report_edit_examples")
        .update({
          analysis_status: "ignored",
          analysed_at: new Date().toISOString(),
          analysis_error: analysis.ignore_reason,
          analysis_json: analysis,
          updated_at: new Date().toISOString(),
        })
        .eq("id", example.id)

      return {
        ...baseResult,
        exampleSaved: true,
        exampleId: example.id,
        analysisStatus: "ignored",
        error: analysis.ignore_reason,
      }
    }

    let created = 0
    let reinforced = 0

    for (const behaviour of analysis.behaviours) {
      const outcome = await createOrReinforceBehaviour({
        providerId: params.providerId,
        reportType: params.reportType,
        behaviour,
        source: params.source,
        actor: params.actor,
      }, supabase)

      if (outcome === "created") created += 1
      if (outcome === "reinforced") reinforced += 1
    }

    await supabase
      .from("provider_report_edit_examples")
      .update({
        analysis_status: "processed",
        analysed_at: new Date().toISOString(),
        analysis_error: null,
        analysis_json: analysis,
        updated_at: new Date().toISOString(),
      })
      .eq("id", example.id)

    return {
      ...baseResult,
      exampleSaved: true,
      exampleId: example.id,
      analysisStatus: "processed",
      behavioursCreated: created,
      behavioursReinforced: reinforced,
      error: null,
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Edit learning analysis failed."

    console.error("Approved edit learning failed:", error)

    if (baseResult.exampleId) {
      await supabase
        .from("provider_report_edit_examples")
        .update({
          analysis_status: "failed",
          analysis_error: message,
          updated_at: new Date().toISOString(),
        })
        .eq("id", baseResult.exampleId)
    }

    return {
      ...baseResult,
      analysisStatus: "failed",
      error: message,
    }
  }
}

export function noLearningRequested(): EditLearningResult {
  return {
    requested: false,
    exampleSaved: false,
    exampleId: null,
    duplicate: false,
    analysisStatus: "not_requested",
    behavioursCreated: 0,
    behavioursReinforced: 0,
    error: null,
  }
}
