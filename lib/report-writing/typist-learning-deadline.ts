import OpenAI from "openai"
import { analyseApprovedEdit } from "./edit-learning-analysis"
import type { LearningAnalysisInput } from "./typist-learning-worker"

export const TYPIST_ANALYSIS_BUDGET_MS = 20 * 60 * 1000

export class LearningAnalysisDeadlineError extends Error {
  constructor() { super("learning_analysis_deadline_exceeded") }
}

function retryable(error: unknown) {
  if (error instanceof OpenAI.APIUserAbortError) return false
  if (error instanceof OpenAI.APIConnectionError) return true
  if (!(error instanceof OpenAI.APIError)) return false
  const override = error.headers?.get("x-should-retry")
  if (override === "true") return true
  if (override === "false") return false
  return error.status === 408 || error.status === 409 || error.status === 429 ||
    (error.status !== undefined && error.status >= 500)
}

function retryDelay(error: unknown, retry: number) {
  const headers = error instanceof OpenAI.APIError ? error.headers : undefined
  const milliseconds = headers?.get("retry-after-ms")
  let delay = milliseconds ? parseFloat(milliseconds) : NaN
  const seconds = headers?.get("retry-after")
  if (seconds && (!delay || Number.isNaN(delay))) {
    const numeric = parseFloat(seconds)
    delay = Number.isNaN(numeric) ? Date.parse(seconds) - Date.now() : numeric * 1000
  }
  return Number.isNaN(delay)
    ? Math.min(500 * 2 ** retry, 8000) * (1 - Math.random() * 0.25)
    : Math.max(0, delay)
}

function waitForRetry(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return }
    const abort = () => {
      clearTimeout(timer)
      signal.removeEventListener("abort", abort)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort)
      resolve()
    }, ms)
    signal.addEventListener("abort", abort, { once: true })
  })
}

// SDK 6.36 retry sleeps ignore AbortSignal. Disable those sleeps only for this
// worker and preserve its two retries using a wait that actually cancels.
// Await the underlying operation's cancellation; never abandon it via a race.
export async function analyseTypistEditWithDeadline(
  client: Pick<OpenAI, "chat">, input: LearningAnalysisInput,
) {
  const controller = new AbortController()
  const deadline = Date.now() + TYPIST_ANALYSIS_BUDGET_MS
  const expire = () => controller.abort(new LearningAnalysisDeadlineError())
  const timer = setTimeout(expire, TYPIST_ANALYSIS_BUDGET_MS)
  const checkDeadline = () => {
    // Also fence an overdue response if the event loop delayed the timer.
    if (Date.now() >= deadline && !controller.signal.aborted) expire()
    controller.signal.throwIfAborted()
  }
  try {
    for (let retry = 0; ; retry++) {
      checkDeadline()
      try {
        const analysis = await analyseApprovedEdit(client, input, {
          signal: controller.signal, maxRetries: 0,
        })
        checkDeadline()
        return analysis
      } catch (error) {
        checkDeadline()
        if (retry >= 2 || !retryable(error)) throw error
        await waitForRetry(Math.min(retryDelay(error, retry), deadline - Date.now()), controller.signal)
      }
    }
  } finally {
    clearTimeout(timer)
    controller.abort()
  }
}
