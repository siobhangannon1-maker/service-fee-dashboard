import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { createServerClient } from "@supabase/ssr"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET() {
  const cookieStore = await cookies()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll() {
          // no-op for this read-only route
        },
      },
    }
  )

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return NextResponse.json(
      { success: false, error: "Not logged in." },
      { status: 401 }
    )
  }

  const { data: provider, error: providerError } = await serviceSupabase
    .from("providers")
    .select("id, name, email, user_id")
    .or(`user_id.eq.${user.id},email.eq.${user.email}`)
    .eq("is_active", true)
    .single()

  if (providerError || !provider) {
    return NextResponse.json(
      {
        success: false,
        error: "No active provider profile is linked to this login.",
      },
      { status: 404 }
    )
  }

  return NextResponse.json({
    success: true,
    provider,
  })
}