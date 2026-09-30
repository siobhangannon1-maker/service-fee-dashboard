import { trainingAccess, trainingItemAccess } from "@/lib/report-writing/training-authorization";
import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error("Missing Supabase environment variables.")
  }

  return createClient(url, key)
}

export async function POST(req: Request) {
  const access = await trainingAccess();
  if (access.denied) return access.denied;

  try {
    const supabase = getSupabase()
    const body = await req.json()

    if (!body.id) {
      return NextResponse.json(
        { success: false, error: "Missing training case id." },
        { status: 400 }
      )
    }

    const itemAccess = await trainingItemAccess(access.value, "provider_training_cases", body.id);
    if (itemAccess.denied) return itemAccess.denied;

    const { error } = await supabase
      .from("provider_training_cases")
      .delete()
      .eq("id", body.id)
      .eq("provider_id", itemAccess.value)

    if (error) {
      return NextResponse.json(
        { success: false, error: "Training request could not be completed." },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Failed to delete training case.",
      },
      { status: 500 }
    )
  }
}