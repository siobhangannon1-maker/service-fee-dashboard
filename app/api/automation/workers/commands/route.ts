import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/server/supabaseAdmin'

const allowedCommands = [
  'pause_worker',
  'resume_worker',
  'soft_restart',
  'run_praktika_sync',
  'run_mediref_sync',
  'force_login',
]

export async function POST(request: Request) {
  const body = await request.json()

  const workerId = body.workerId
  const command = body.command
  const payload = body.payload || {}

  if (!workerId || !command) {
    return NextResponse.json(
      { error: 'Missing workerId or command' },
      { status: 400 }
    )
  }

  if (!allowedCommands.includes(command)) {
    return NextResponse.json(
      { error: `Command not allowed: ${command}` },
      { status: 400 }
    )
  }

  const { data, error } = await supabaseAdmin
    .from('automation_commands')
    .insert({
      worker_id: workerId,
      command,
      payload,
      status: 'pending',
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ command: data })
}