import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

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

async function upsertWorker(status: string) {
  const { error } = await supabase.from('automation_workers').upsert({
    id: workerId,
    name: workerType === 'praktika' ? 'Praktika Worker' : 'MediRef Worker',
    type: workerType,
    status,
    last_heartbeat_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })

  if (error) throw error
}

async function heartbeat(status = 'online') {
  const { error } = await supabase
    .from('automation_workers')
    .update({
      status,
      last_heartbeat_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', workerId)

  if (error) console.error('Heartbeat error:', error.message)
}

async function logError(message: string, stack?: string, metadata: Record<string, unknown> = {}) {
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
      last_error_at: new Date().toISOString(),
      last_error_message: message,
      updated_at: new Date().toISOString(),
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
    updated_at: new Date().toISOString(),
  }

  if (status === 'running') update.started_at = new Date().toISOString()
  if (status === 'done' || status === 'failed') update.finished_at = new Date().toISOString()

  const { error } = await supabase
    .from('automation_commands')
    .update(update)
    .eq('id', id)

  if (error) throw error
}

async function runPraktikaSyncOnce() {
  console.log('TODO: run Praktika sync once')

  /*
    Later, move your existing Praktika watcher logic here.

    Example:

    await processPraktikaHelperJobs({
      storageStatePath: process.env.PLAYWRIGHT_STORAGE_DIR + '/praktika.json'
    })
  */

  await sleep(2000)

  await supabase
    .from('automation_workers')
    .update({
      last_success_at: new Date().toISOString(),
      last_error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', workerId)
}

async function runMediRefSyncOnce() {
  console.log('TODO: run MediRef sync once')

  /*
    Later, move your existing MediRef watcher logic here.

    Example:

    await processMediRefHelperJobs({
      storageStatePath: process.env.PLAYWRIGHT_STORAGE_DIR + '/mediref.json'
    })
  */

  await sleep(2000)

  await supabase
    .from('automation_workers')
    .update({
      last_success_at: new Date().toISOString(),
      last_error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', workerId)
}

async function processCommand(command: any) {
  await markCommand(command.id, 'running')

  try {
    if (command.command === 'pause_worker') {
      await supabase
        .from('automation_workers')
        .update({ is_paused: true, status: 'paused', updated_at: new Date().toISOString() })
        .eq('id', workerId)

      await markCommand(command.id, 'done', { message: 'Worker paused' })
      return
    }

    if (command.command === 'resume_worker') {
      await supabase
        .from('automation_workers')
        .update({ is_paused: false, status: 'online', updated_at: new Date().toISOString() })
        .eq('id', workerId)

      await markCommand(command.id, 'done', { message: 'Worker resumed' })
      return
    }

    if (command.command === 'soft_restart') {
      await markCommand(command.id, 'done', { message: 'Worker exiting for restart' })
      console.log('Soft restart requested')
      process.exit(0)
    }

    if (command.command === 'run_praktika_sync') {
      await runPraktikaSyncOnce()
      await markCommand(command.id, 'done', { message: 'Praktika sync completed' })
      return
    }

    if (command.command === 'run_mediref_sync') {
      await runMediRefSyncOnce()
      await markCommand(command.id, 'done', { message: 'MediRef sync completed' })
      return
    }

    if (command.command === 'force_login') {
      await markCommand(command.id, 'done', { message: 'Force login placeholder completed' })
      return
    }

    throw new Error(`Unknown command: ${command.command}`)
  } catch (error: any) {
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
  console.log(`Starting ${workerId}`)

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