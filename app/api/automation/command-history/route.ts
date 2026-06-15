import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/server/supabaseAdmin'

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('automation_commands')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ commands: data })
}