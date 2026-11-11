import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export class BillingRolloutError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export async function beginBillingExport(periodId: string): Promise<string> {
  const result = await supabaseAdmin.rpc("begin_billing_export", { p_period: periodId });
  if (result.error || typeof result.data !== "string") {
    if (result.error?.code === "P0002" && result.error.message?.includes("July 2026 exports are held"))
      throw new BillingRolloutError(409, "July 2026 exports are held pending reconciliation of INV-0507 and INV-0505. Do not create replacement invoices.");
    throw new BillingRolloutError(503, "Billing exports are paused or maintenance controls are unavailable. No export was started.");
  }
  return result.data;
}
export async function finishBillingExport(requestId: string) {
  const result = await supabaseAdmin.rpc("finish_billing_export", { p_request: requestId });
  if (result.error) throw new Error("Export completion could not be recorded; maintenance drain requires administrator review.");
}
