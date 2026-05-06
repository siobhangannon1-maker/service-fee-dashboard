import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function AIBrainPage() {
  const { data: cases, error } = await supabaseAdmin
    .from("ai_cases")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold">AI Brain</h1>
        <p className="text-red-600">{error.message}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">AI Brain</h1>
        <p className="text-sm text-muted-foreground">
          Case-level AI decisions, risks, confidence and recommended next steps.
        </p>
      </div>

      <div className="grid gap-4">
        {cases?.map((item) => (
          <div
            key={item.id}
            className="rounded-lg border bg-white p-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-medium">{item.title || "Untitled case"}</h2>
                <p className="text-sm text-muted-foreground">
                  {item.patient_name || "No patient name"}{" "}
                  {item.patient_dob ? `• DOB: ${item.patient_dob}` : ""}
                </p>
              </div>

              <div className="text-right text-sm">
                <p>Category: {item.category || "unknown"}</p>
                <p>Confidence: {item.confidence ?? "—"}</p>
                <p>Risk: {item.risk_level}</p>
              </div>
            </div>

            <div className="mt-4 rounded-md bg-gray-50 p-3 text-sm">
              <p className="font-medium">Recommended next step</p>
              <p>{item.recommended_next_step || "No recommendation"}</p>
            </div>
          </div>
        ))}

        {!cases?.length && (
          <p className="text-sm text-muted-foreground">
            No AI Brain cases yet.
          </p>
        )}
      </div>
    </div>
  );
}