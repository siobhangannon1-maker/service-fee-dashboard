import assert from "node:assert/strict"
import { test } from "node:test"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import ts from "typescript"
import { toDraftListItem, type DraftListItem } from "./draft-contract"
import { typistCardPresentation } from "./typist-card-presentation"
import { startActiveWorkflowPolling } from "./active-workflow-poll"
import { shouldAppearInApproved, type ResolvedWorkflow } from "./resolved-workflow"

const source = readFileSync("app/(protected)/report-writing/typist/TypistPage.tsx", "utf8")
function handler(name: string) {
  const start = source.indexOf(`  async function ${name}(`)
  const end = source.indexOf("\n  async function ", start + 1)
  return source.slice(start, end)
}
const projection = (status: ResolvedWorkflow["status"]): ResolvedWorkflow => ({
  status, message: status === "needs_attention" ? "Synthetic genuine workflow warning" : null,
  lookupUnavailable: false, lastProgressAt: null, praktikaRecovery: false, medirefRecovery: false,
  branches: { praktika: "completed", icon: "skipped", periodontal: "skipped",
    mediref: status === "completed" ? "completed" : "unknown" },
})
const settle = () => new Promise(resolve => setImmediate(resolve))

for (const learningStatus of ["pending", "processing"]) {
  test(`fast approval releases loading while learning is ${learningStatus}; authoritative UI reconciles independently`, async t => {
    t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 0 })
    let releaseList!: () => void
    const listGate = new Promise<void>(resolve => { releaseList = resolve })
    let listStarted!: () => void
    const refreshing = new Promise<void>(resolve => { listStarted = resolve })
    const saved = { id: "synthetic-draft", provider_id: "provider", status: "approved",
      patient_name: "Synthetic fixture", report_type: "consultation_report",
      edited_text: "Synthetic final", ai_generated_text: "Synthetic original",
      workflow_status: "not_started", workflow_resolved: projection("not_started") }
    let authoritative = toDraftListItem({ ...saved, workflow_status: "completed",
      updated_at: "revision", workflow_resolved: projection("needs_attention") }, true)
    let rows: DraftListItem[] = []
    let selected: Record<string, unknown> = { ...saved, status: "draft" }
    let listCalls = 0
    const queueState = { status: learningStatus }
    const box: Record<string, unknown> = {
      loading: false, selectedDraft: selected, selectedProviderId: "provider",
      generatedAiLetterText: "Synthetic original", getLetterTextForSave: () => "Synthetic final",
      referrerName: "", referrerAddress: "", patientName: "Synthetic fixture", patientDob: null,
      reportType: "consultation_report", clinicalNotes: "", typistQueries: "",
      queueSelectionTokenRef: { current: 1 }, providerDataRequestRef: { current: 1 },
      draftListMountedRef: { current: true }, draftListRequestSequenceRef: { current: 0 },
      isCurrentProviderDataRequest: () => true, lastAutosavedTextRef: { current: "" }, Date,
      setLoading: (value: boolean) => { box.loading = value },
      setSelectedDraft: (value: Record<string, unknown> | ((current: Record<string, unknown>) => Record<string, unknown>)) => {
        selected = typeof value === "function" ? value(selected) : value
        box.selectedDraft = selected
      },
      mergeDraftWorkflow: (current: Record<string, unknown>, item: DraftListItem) => ({ ...current, ...item }),
      setDrafts: (value: DraftListItem[]) => { rows = value },
      setDraftListError: (error: unknown) => assert.equal(error, null),
      setSaveStatus() {}, setLastSavedAt() {}, alert() {},
      fetch: async (url: string) => {
        if (url === "/api/report-writing/update-draft") return Response.json({
          success: true, draft: saved, learningQueued: true, learning: { analysisStatus: queueState.status },
        })
        assert.ok(url.startsWith("/api/report-writing/get-drafts?"))
        listCalls++
        if (listCalls === 1) { listStarted(); await listGate }
        return Response.json({ success: true, drafts: [authoritative] })
      },
    }
    const code = ts.transpileModule(handler("loadDrafts") + handler("updateExistingDraft") +
      "\n({ approve: updateExistingDraft, refresh: loadDrafts })", {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText
    const api = runInNewContext(code, box) as {
      approve: (status: string) => Promise<void>
      refresh: (provider: string, token?: number, options?: { quiet?: boolean; signal?: AbortSignal }) => Promise<void>
    }
    const approval = api.approve("approved")
    await refreshing
    assert.equal(box.loading, false)
    assert.equal(selected.status, "approved")
    assert.equal(queueState.status, learningStatus)
    releaseList(); await approval
    assert.equal((selected.workflow_resolved as ResolvedWorkflow).status, "needs_attention")
    assert.equal(typistCardPresentation(rows[0]).label, "Needs attention")
    assert.equal(shouldAppearInApproved(rows[0]), true)

    const stop = startActiveWorkflowPolling({ drafts: rows, getDrafts: () => rows,
      providerId: "provider", fetch: async () => assert.fail("Resolved reconciliation needs no marker call"),
      refresh: signal => api.refresh("provider", 1, { quiet: true, signal }),
    })
    t.after(stop)
    authoritative = toDraftListItem({ ...saved, status: "uploaded_to_praktika", workflow_status: "completed",
      updated_at: "revision", workflow_resolved: projection("completed") }, true)
    for (let i = 0; i < 3; i++) { t.mock.timers.tick(5000); await settle() }
    assert.equal(rows[0].workflow_resolved?.status, "completed")
    assert.equal(shouldAppearInApproved(rows[0]), false)
    assert.equal((selected.workflow_resolved as ResolvedWorkflow).status, "completed")
    assert.equal(queueState.status, learningStatus)
    const count = listCalls
    t.mock.timers.tick(60000); await settle()
    assert.equal(listCalls, count)
  })
}
