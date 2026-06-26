import { supabaseAdmin } from "@/lib/supabase/admin";

type ReminderResult = {
  providerId: string;
  providerName: string;
  approvalCount: number;
  draftCount: number;
  count: number;
  sent: boolean;
  phone?: string | null;
  error?: string;
  twilioSid?: string;
  twilioStatus?: string;
};

function getFirstName(value: string | null | undefined) {
  return String(value || "Doctor")
    .replace(/^dr\.?\s+/i, "")
    .trim()
    .split(/\s+/)[0];
}

function pluralise(count: number, singular: string, plural: string) {
  return count === 1 ? singular : plural;
}

function buildSmsBody(params: {
  firstName: string;
  approvalCount: number;
  draftCount: number;
}) {
  const { firstName, approvalCount, draftCount } = params;

  const approvalText = `${approvalCount} ${pluralise(
    approvalCount,
    "letter",
    "letters",
  )} requiring approval`;

  const draftText = `${draftCount} ${pluralise(
    draftCount,
    "draft letter",
    "draft letters",
  )}`;

  let inboxText = "";

  if (approvalCount > 0 && draftCount > 0) {
    inboxText = `${approvalText} and ${draftText}`;
  } else if (approvalCount > 0) {
    inboxText = approvalText;
  } else {
    inboxText = draftText;
  }

  return `Hi ${firstName}, this is an automated reminder that you currently have ${inboxText} in your report writing inbox.

app.focusdentalspecialists.com.au/report-writing/provider`;
}

async function sendTwilioSms({ to, body }: { to: string; body: string }) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;

  if (!accountSid || !authToken || !messagingServiceSid) {
    throw new Error("Twilio environment variables are missing.");
  }

  const params = new URLSearchParams();
  params.append("To", to);
  params.append("MessagingServiceSid", messagingServiceSid);
  params.append("Body", body);

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    },
  );

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.message || "Twilio send failed.");
  }

  return result;
}

export async function sendWeeklyProviderApprovalReminders() {
  const { data: drafts, error: draftsError } = await supabaseAdmin
    .from("report_drafts")
    .select("provider_id, status")
    .in("status", ["draft", "awaiting_provider_approval"]);

  if (draftsError) throw new Error(draftsError.message);

  const approvalCounts = new Map<string, number>();
  const draftCounts = new Map<string, number>();

  for (const draft of drafts || []) {
    if (!draft.provider_id) continue;

    if (draft.status === "awaiting_provider_approval") {
      approvalCounts.set(
        draft.provider_id,
        (approvalCounts.get(draft.provider_id) || 0) + 1,
      );
    }

    if (draft.status === "draft") {
      draftCounts.set(
        draft.provider_id,
        (draftCounts.get(draft.provider_id) || 0) + 1,
      );
    }
  }

  const providerIds = Array.from(
    new Set([...approvalCounts.keys(), ...draftCounts.keys()]),
  );

  if (providerIds.length === 0) {
    return {
      success: true,
      sent: 0,
      results: [],
      message: "No providers have letters requiring attention.",
    };
  }

  const { data: providers, error: providersError } = await supabaseAdmin
    .from("providers")
    .select("id, name, user_id")
    .in("id", providerIds)
    .eq("is_active", true);

  if (providersError) throw new Error(providersError.message);

  const userIds = (providers || [])
    .map((provider) => provider.user_id)
    .filter(Boolean);

  const { data: profiles, error: profilesError } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name, phone")
    .in("id", userIds);

  if (profilesError) throw new Error(profilesError.message);

  const profilesById = new Map(
    (profiles || []).map((profile) => [profile.id, profile]),
  );

  const results: ReminderResult[] = [];

  for (const provider of providers || []) {
    const approvalCount = approvalCounts.get(provider.id) || 0;
    const draftCount = draftCounts.get(provider.id) || 0;
    const totalCount = approvalCount + draftCount;

    if (totalCount === 0) continue;

    const profile = provider.user_id
      ? profilesById.get(provider.user_id)
      : null;

    const phone = profile?.phone || null;

    if (!phone) {
      results.push({
        providerId: provider.id,
        providerName: provider.name,
        approvalCount,
        draftCount,
        count: totalCount,
        sent: false,
        phone,
        error: "Missing provider mobile number.",
      });
      continue;
    }

    const firstName = getFirstName(profile?.full_name || provider.name);

    const smsBody = buildSmsBody({
      firstName,
      approvalCount,
      draftCount,
    });

    try {
      const twilio = await sendTwilioSms({
        to: phone,
        body: smsBody,
      });

      results.push({
        providerId: provider.id,
        providerName: provider.name,
        approvalCount,
        draftCount,
        count: totalCount,
        sent: true,
        phone,
        twilioSid: twilio.sid,
        twilioStatus: twilio.status,
      });

      await supabaseAdmin.from("audit_log").insert({
        provider_id: provider.id,
        action: "weekly_provider_approval_sms_sent",
        metadata: {
          providerName: provider.name,
          phone,
          approvalCount,
          draftCount,
          totalCount,
          twilioSid: twilio.sid,
          twilioStatus: twilio.status,
          smsBody,
        },
      });
    } catch (error) {
      results.push({
        providerId: provider.id,
        providerName: provider.name,
        approvalCount,
        draftCount,
        count: totalCount,
        sent: false,
        phone,
        error:
          error instanceof Error ? error.message : "Failed to send SMS.",
      });
    }
  }

  return {
    success: true,
    sent: results.filter((item) => item.sent).length,
    results,
  };
}