import { createClient } from "@/lib/supabase/client";

type AuditLogParams = {
  action: string;
  entityType: string;
  entityId?: string | null;
  billingPeriodId?: string | null;
  providerId?: string | null;
  metadata?: Record<string, any>;
};

export async function writeAuditLog(params: AuditLogParams) {
  try {
    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { error } = await supabase.from("audit_log").insert({
      action: params.action,
      entity_type: params.entityType,
      entity_id: params.entityId || null,
      billing_period_id: params.billingPeriodId || null,
      provider_id: params.providerId || null,
      metadata: params.metadata || {},
      actor_user_id: user?.id || null,
    });

    if (error) {
      console.error("Audit log insert failed:", error.message);
    }
  } catch (error) {
    console.error("Audit log failed:", error);
  }
}

type StatementHistoryParams = {
  action: "emailed" | "exported";
  billingPeriodId: string;
  providerId: string;
  recipientEmail?: string;
  metadata?: Record<string, any>;
};

export async function writeStatementHistory(
  params: StatementHistoryParams
) {
  try {
    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { error } = await supabase.from("statement_history").insert({
      action: params.action,
      billing_period_id: params.billingPeriodId,
      provider_id: params.providerId,
      recipient_email: params.recipientEmail || null,
      metadata: params.metadata || {},
      user_id: user?.id || null,
    });

    if (error) {
      console.error("Statement history insert failed:", error.message);
    }
  } catch (error) {
    console.error("Statement history failed:", error);
  }
}