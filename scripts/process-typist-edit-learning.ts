import "dotenv/config"
import OpenAI from "openai"
import { createClient } from "@supabase/supabase-js"
import { analyseTypistEditWithDeadline } from "../lib/report-writing/typist-learning-deadline"
import { LearningConfigurationError, runTypistLearningWorker } from "../lib/report-writing/typist-learning-worker"

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const openaiKey = process.env.OPENAI_API_KEY
  if (!url || !key) throw new Error("worker_configuration_missing")
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  // Keep the request timeout; worker retries use cancellable waits under one deadline.
  // Do not allow inherited SDK debug logging to print prompts or responses.
  const openai = openaiKey ? new OpenAI({ apiKey: openaiKey, logLevel: "off" }) : null
  let stopping = false
  const stop = () => { stopping = true }
  process.once("SIGTERM", stop)
  process.once("SIGINT", stop)
  try {
    await runTypistLearningWorker({
      db, stopping: () => stopping,
      analyse: input => {
        if (!openai) throw new LearningConfigurationError()
        return analyseTypistEditWithDeadline(openai, input)
      },
      log: event => console.log(JSON.stringify(event)),
    })
  } finally {
    process.removeListener("SIGTERM", stop)
    process.removeListener("SIGINT", stop)
  }
}

main().catch(() => {
  console.error("Typist learning worker stopped: worker_configuration_or_runtime_failure")
  process.exitCode = 1
})
