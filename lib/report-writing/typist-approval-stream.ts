import { toDraftDetail, draftListColumns, type DraftDetail } from "./draft-contract"
import type { EditLearningResult } from "./edit-learning-analysis"

type ApprovalAuditLearning = Omit<EditLearningResult, "analysisStatus"> & {
  analysisStatus: EditLearningResult["analysisStatus"] | "pending"
}

const sources = new Set(["typist_direct_approval", "typist_image_workspace_final_save", "typist_existing_draft_approval"])
export function isTypistApproval(status: unknown, source: string) {
  return status === "approved" && sources.has(source)
}

// Called after draft persistence and linked queue handling. Audit keeps its existing
// best-effort boundary. No learning work is detached from this response stream.
export async function approvalResponse(options: {
  typist: boolean
  draft: unknown
  synchronous: () => Promise<EditLearningResult>
  audit: (learning: ApprovalAuditLearning) => Promise<void>
  initialLearning: ApprovalAuditLearning
}): Promise<Response> {
  if (!options.typist) {
    const learning = await options.synchronous()
    await options.audit(learning)
    return Response.json({ success: true, draft: options.draft, learning })
  }
  await options.audit(options.initialLearning)
  const encoder = new TextEncoder()
  let cancelled = false
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: unknown) => {
        if (!cancelled) controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"))
      }
      emit({ type: "approval_complete", success: true, draft: options.draft })
      try {
        const learning = await options.synchronous()
        emit({ type: learning.analysisStatus === "failed" ? "learning_failed" : "learning_complete" })
      } catch {
        emit({ type: "learning_failed" })
      } finally {
        if (!cancelled) controller.close()
      }
    },
    cancel() { cancelled = true },
  })
  return new Response(stream, { headers: {
    "Content-Type": "application/x-ndjson", "Cache-Control": "no-store, no-transform",
    "X-Accel-Buffering": "no",
  } })
}

export type ApprovalExpectation = { providerId: string; draftId?: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

// Validate the persisted row before normalising the existing detail contract.
// Optional workflow fields are retained, never used as acknowledgement evidence.
function approvedDraft(value: unknown, expected?: ApprovalExpectation): DraftDetail {
  if (!isRecord(value) || value.status !== "approved" ||
      !["id", "provider_id", "report_type", "source_type", "edited_text"].every(
        key => typeof value[key] === "string" && String(value[key]).trim().length > 0
      ) ||
      !["created_at", "updated_at", "provider_approved_at"].every(
        key => typeof value[key] === "string" && Number.isFinite(Date.parse(String(value[key])))
      ) ||
      !["patient_name", "patient_dob", "referrer_name", "referrer_address", "source_text", "ai_generated_text"].every(
        key => value[key] === null || typeof value[key] === "string"
      ) ||
      draftListColumns.some(key => key in value && value[key] !== null &&
        (key === "uploaded_to_praktika" ? typeof value[key] !== "boolean" : typeof value[key] !== "string")) ||
      ["typist_instructions", "typist_queries", "clinical_notes", "source_clinical_notes"].some(
        key => key in value && value[key] !== null && typeof value[key] !== "string"
      ) ||
      (expected && (value.provider_id !== expected.providerId ||
        (expected.draftId !== undefined && value.id !== expected.draftId)))) {
    throw new Error("Invalid approval acknowledgement. Reload the letter to confirm its saved status.")
  }
  return toDraftDetail(value)
}

// Resolve only at a validated acknowledgement while draining the original request.
// The tail has no mutable draft payload and never writes React state.
export async function readApprovalResponse(response: Response, expected?: ApprovalExpectation): Promise<{
  success?: boolean; draft?: DraftDetail; error?: string; draftId?: string; id?: string
}> {
  if (!response.headers.get("content-type")?.includes("application/x-ndjson")) {
    const result = await response.json()
    // Preserve the routes' ordinary JSON errors and non-approval saves. An
    // approval operation must not silently fall back to a successful JSON body.
    if (expected && (!isRecord(result) || result.success !== false)) {
      throw new Error("Approval was not acknowledged. Reload the letter to confirm its saved status.")
    }
    return result
  }
  if (!response.ok) throw new Error("Approval was not acknowledged")
  if (!response.body) throw new Error("Missing approval response")
  const reader = response.body.getReader()
  return new Promise((resolve, reject) => {
    void (async () => {
      let acknowledged = false
      let buffer = ""
      const decoder = new TextDecoder()
      try {
        for (;;) {
          const { value, done } = await reader.read()
          buffer += decoder.decode(value, { stream: !done })
          const lines = buffer.split("\n")
          buffer = lines.pop() || ""
          for (const line of lines) {
            if (!line.trim() || acknowledged) continue
            const event: unknown = JSON.parse(line)
            if (isRecord(event) && event.type === "approval_complete") {
              if (event.success !== true) {
                throw new Error("Invalid approval acknowledgement. Reload the letter to confirm its saved status.")
              }
              const draft = approvedDraft(event.draft, expected)
              acknowledged = true
              resolve({ success: true, draft })
            }
          }
          if (done) break
        }
        if (!acknowledged) reject(new Error("Approval was not acknowledged"))
      } catch (error) {
        if (!acknowledged) reject(error)
      } finally { reader.releaseLock() }
    })()
  })
}
