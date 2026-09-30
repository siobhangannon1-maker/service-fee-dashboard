import { trainingAccess, trainingItemAccess } from "@/lib/report-writing/training-authorization";
import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  const access = await trainingAccess(true);
  if (access.denied) return access.denied;

  const body = await req.json()
  const { exampleId } = body

  if (!exampleId) {
    return NextResponse.json(
      { success: false, error: "Missing exampleId." },
      { status: 400 }
    )
  }

  const itemAccess = await trainingItemAccess(access.value, "provider_report_examples", exampleId);
  if (itemAccess.denied) return itemAccess.denied;

  const { error } = await supabase
    .from("provider_report_examples")
    .delete()
    .eq("id", exampleId)
    .eq("provider_id", itemAccess.value)

  if (error) {
    return NextResponse.json(
      { success: false, error: "Training request could not be completed." },
      { status: 500 }
    )
  }

  return NextResponse.json({ success: true })
}