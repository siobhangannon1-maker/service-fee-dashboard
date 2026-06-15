import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { spawn } from 'node:child_process'

type WorkerType = 'praktika' | 'mediref'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const workerType = (process.env.WORKER_TYPE || 'praktika') as WorkerType
const workerId = process.env.WORKER_ID || `${workerType}-worker-1`

if (!supabaseUrl) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL')
if (!serviceRoleKey) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY')

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
})

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const runningPraktikaSessions = new Set<string>()

function nowIso() {
  return new Date().toISOString()
}

function log(message: string) {
  console.log(`[${new Date().toISOString()}] [${workerId}] ${message}`)
}

async function upsertWorker(status: string) {
  log(`Upserting worker as ${status}`)

  const { error } = await supabase.from('automation_workers').upsert({
    id: workerId,
    name: workerType === 'praktika' ? 'Praktika Worker' : 'MediRef Worker',
    type: workerType,
    status,
    last_heartbeat_at: nowIso(),
    updated_at: nowIso(),
  })

  if (error) throw error
}

async function heartbeat(status = 'online') {
  const { error } = await supabase
    .from('automation_workers')
    .update({
      status,
      last_heartbeat_at: nowIso(),
      updated_at: nowIso(),
    })
    .eq('id', workerId)

  if (error) {
    console.error(`[${workerId}] Heartbeat error:`, error.message)
  }
}

async function logError(message: string, stack?: string, metadata: Record<string, unknown> = {}) {
  console.error(`[${workerId}] ERROR: ${message}`)

  await supabase.from('automation_errors').insert({
    worker_id: workerId,
    message,
    stack,
    metadata,
  })

  await supabase
    .from('automation_workers')
    .update({
      status: 'error',
      last_error_at: nowIso(),
      last_error_message: message,
      updated_at: nowIso(),
    })
    .eq('id', workerId)
}

async function getWorker() {
  const { data, error } = await supabase
    .from('automation_workers')
    .select('*')
    .eq('id', workerId)
    .single()

  if (error) throw error
  return data
}

async function getNextCommand() {
  const { data, error } = await supabase
    .from('automation_commands')
    .select('*')
    .eq('worker_id', workerId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data
}

async function markCommand(id: string, status: string, result?: unknown, errorMessage?: string) {
  const update: Record<string, unknown> = {
    status,
    result: result ?? null,
    error_message: errorMessage ?? null,
    updated_at: nowIso(),
  }

  if (status === 'running') update.started_at = nowIso()
  if (status === 'done' || status === 'failed') update.finished_at = nowIso()

  const { error } = await supabase
    .from('automation_commands')
    .update(update)
    .eq('id', id)

  if (error) throw error
}

async function getRefreshRequestedPraktikaSessions() {
  const { data, error } = await supabase
    .from('praktika_sessions')
    .select('id, scope, app_user_id, status, message, refresh_requested_at')
    .eq('status', 'refresh_requested')
    .not('refresh_requested_at', 'is', null)
    .order('refresh_requested_at', { ascending: true })

  if (error) throw new Error(`Could not check Praktika refresh requests: ${error.message}`)

  return data || []
}

async function getPendingPraktikaJobs() {
  const { data, error } = await supabase
    .from('praktika_helper_jobs')
    .select('id, app_user_id, job_type, status, available_at, created_at')
    .eq('status', 'pending')
    .lte('available_at', nowIso())
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(20)

  if (error) throw new Error(`Could not check Praktika helper jobs: ${error.message}`)

  return data || []
}

async function getUserSessionsForPraktikaJobs(appUserIds: string[]) {
  if (appUserIds.length === 0) return []

  const { data, error } = await supabase
    .from('praktika_sessions')
    .select('id, scope, app_user_id, status, message, refresh_requested_at')
    .eq('scope', 'user')
    .in('app_user_id', appUserIds)

  if (error) throw new Error(`Could not load Praktika sessions for jobs: ${error.message}`)

  return data || []
}

async function markPraktikaSessionRefreshing(sessionId: string, reason: string) {
  const { error } = await supabase
    .from('praktika_sessions')
    .update({
      status: 'refreshing',
      message:
        reason === 'pending_job'
          ? 'Cloud Praktika helper is starting to process queued jobs.'
          : 'Cloud Praktika helper is starting.',
      updated_at: nowIso(),
    })
    .eq('id', sessionId)

  if (error) throw new Error(`Could not mark Praktika session refreshing: ${error.message}`)
}

async function startPraktikaHelperForSession(session: any, reason: string) {
  if (runningPraktikaSessions.has(session.id)) {
    log(`Praktika helper already running for session ${session.id}. Reason: ${reason}`)
    return
  }

  runningPraktikaSessions.add(session.id)

  log(`Starting Praktika helper for ${session.scope} session ${session.id}. Reason: ${reason}`)

  await markPraktikaSessionRefreshing(session.id, reason)

  await supabase
    .from('automation_workers')
    .update({
      current_job_type: 'praktika_session_helper',
      current_job_id: session.id,
      updated_at: nowIso(),
    })
    .eq('id', workerId)

  const child = spawn(
    'npm',
    ['run', 'refresh:praktika-session', '--', `--session-id=${session.id}`],
    {
      cwd: process.cwd(),
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: {
        ...process.env,
        PLAYWRIGHT_STORAGE_DIR:
          process.env.PLAYWRIGHT_STORAGE_DIR || '/var/data/playwright-storage',
      },
    },
  )

  child.on('exit', async (code) => {
    runningPraktikaSessions.delete(session.id)

    log(`Praktika helper for session ${session.id} exited with code ${code}`)

    await supabase
      .from('automation_workers')
      .update({
        current_job_type: null,
        current_job_id: null,
        updated_at: nowIso(),
      })
      .eq('id', workerId)

    if (code !== 0) {
      await supabase
        .from('praktika_sessions')
        .update({
          status: 'error',
          message: 'Cloud Praktika helper stopped unexpectedly. Reconnect before syncing again.',
          updated_at: nowIso(),
        })
        .eq('id', session.id)

      await logError(`Praktika helper for session ${session.id} exited with code ${code}`)
    }
  })

  child.on('error', async (error) => {
    runningPraktikaSessions.delete(session.id)

    log(`Praktika helper for session ${session.id} failed to start: ${error.message}`)

    await supabase
      .from('automation_workers')
      .update({
        current_job_type: null,
        current_job_id: null,
        updated_at: nowIso(),
      })
      .eq('id', workerId)

    await supabase
      .from('praktika_sessions')
      .update({
        status: 'error',
        message: `Cloud Praktika helper failed to start: ${error.message}`,
        updated_at: nowIso(),
      })
      .eq('id', session.id)

    await logError(`Praktika helper for session ${session.id} failed to start: ${error.message}`, error.stack)
  })
}

async function runPraktikaSyncOnce() {
  log('Checking Praktika refresh requests and pending helper jobs')

  const refreshSessions = await getRefreshRequestedPraktikaSessions()

  for (const session of refreshSessions) {
    await startPraktikaHelperForSession(session, 'refresh_requested')
  }

  const jobs = await getPendingPraktikaJobs()

  if (jobs.length === 0) {
    log('No pending Praktika helper jobs found')
    return
  }

  const appUserIds = Array.from(
    new Set(
      jobs
        .map((job: any) => job.app_user_id)
        .filter((value: string | null): value is string => Boolean(value)),
    ),
  )

  if (appUserIds.length === 0) {
    log('Pending Praktika helper jobs found, but none have app_user_id')
    return
  }

  const sessions = await getUserSessionsForPraktikaJobs(appUserIds)

  for (const appUserId of appUserIds) {
    const session = sessions.find((item: any) => item.app_user_id === appUserId)

    if (!session) {
      log(`No Praktika user session exists for app user ${appUserId}`)
      continue
    }

    await startPraktikaHelperForSession(session, 'pending_job')
  }

  await supabase
    .from('automation_workers')
    .update({
      last_success_at: nowIso(),
      last_error_message: null,
      updated_at: nowIso(),
    })
    .eq('id', workerId)

  log('Praktika sync check completed')
}

async function runMediRefSyncOnce() {
  log('Running MediRef sync placeholder')

  await sleep(2000)

  await supabase
    .from('automation_workers')
    .update({
      last_success_at: nowIso(),
      last_error_message: null,
      updated_at: nowIso(),
    })
    .eq('id', workerId)

  log('MediRef sync placeholder completed')
}

async function processCommand(command: any) {
  log(`Processing command: ${command.command}`)

  await markCommand(command.id, 'running')

  try {
    if (command.command === 'pause_worker') {
      await supabase
        .from('automation_workers')
        .update({
          is_paused: true,
          status: 'paused',
          updated_at: nowIso(),
        })
        .eq('id', workerId)

      log('Worker paused')
      await markCommand(command.id, 'done', { message: 'Worker paused' })
      return
    }

    if (command.command === 'resume_worker') {
      await supabase
        .from('automation_workers')
        .update({
          is_paused: false,
          status: 'online',
          updated_at: nowIso(),
        })
        .eq('id', workerId)

      log('Worker resumed')
      await markCommand(command.id, 'done', { message: 'Worker resumed' })
      return
    }

    if (command.command === 'soft_restart') {
      log('Soft restart requested')
      await markCommand(command.id, 'done', { message: 'Worker exiting for restart' })
      process.exit(0)
    }

    if (command.command === 'run_praktika_sync') {
      log('Manual Praktika sync requested')
      await runPraktikaSyncOnce()
      await markCommand(command.id, 'done', { message: 'Praktika sync check completed' })
      return
    }

    if (command.command === 'run_mediref_sync') {
      log('Manual MediRef sync requested')
      await runMediRefSyncOnce()
      await markCommand(command.id, 'done', { message: 'MediRef sync completed' })
      return
    }

    if (command.command === 'force_login') {
      log('Force login requested')

      if (workerType === 'praktika') {
        const sessions = await getRefreshRequestedPraktikaSessions()

        if (sessions.length === 0) {
          await markCommand(command.id, 'done', {
            message: 'No Praktika refresh_requested sessions found. Click reconnect/request refresh from the Praktika UI first.',
          })
          return
        }

        for (const session of sessions) {
          await startPraktikaHelperForSession(session, 'refresh_requested')
        }

        await markCommand(command.id, 'done', {
          message: `Started ${sessions.length} Praktika helper session(s).`,
        })
        return
      }

      await markCommand(command.id, 'done', { message: 'Force login placeholder completed' })
      return
    }

    throw new Error(`Unknown command: ${command.command}`)
  } catch (error: any) {
    log(`Command failed: ${command.command}`)
    await markCommand(command.id, 'failed', null, error.message)
    await logError(error.message, error.stack, { command })
  }
}

async function pollHelperJobs() {
  const worker = await getWorker()

  if (worker.is_paused) {
    await heartbeat('paused')
    return
  }

  if (workerType === 'praktika') {
    await runPraktikaSyncOnce()
  }

  if (workerType === 'mediref') {
    await runMediRefSyncOnce()
  }
}

async function main() {
  log(`Starting ${workerType} worker`)
  log(`Poll interval: ${process.env.WORKER_POLL_INTERVAL_MS || 5000}ms`)
  log(`Playwright storage dir: ${process.env.PLAYWRIGHT_STORAGE_DIR || 'not set'}`)

  await upsertWorker('online')

  while (true) {
    try {
      await heartbeat('online')

      const command = await getNextCommand()

      if (command) {
        await processCommand(command)
      } else {
        await pollHelperJobs()
      }
    } catch (error: any) {
      console.error(error)
      await logError(error.message, error.stack)
    }

    await sleep(Number(process.env.WORKER_POLL_INTERVAL_MS || 5000))
  }
}

main()