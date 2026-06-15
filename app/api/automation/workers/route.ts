import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/server/supabaseAdmin'

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('automation_workers')
    .select('*')
    .order('name', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ workers: data })
}