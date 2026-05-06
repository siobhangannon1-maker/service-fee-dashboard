import "server-only";

const tenantId = process.env.MICROSOFT_TENANT_ID;
const clientId = process.env.MICROSOFT_CLIENT_ID;
const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;

export const outlookSharedMailbox =
  process.env.OUTLOOK_SHARED_MAILBOX ||
  "ai-receptionist@focusdentalspecialists.com.au";

const outlookSignatureHtml =
  process.env.OUTLOOK_EMAIL_SIGNATURE_HTML ||
  `<br><br><div><strong>Focus Dental Specialists</strong><br>Email: ${outlookSharedMailbox}</div>`;

if (!tenantId) throw new Error("Missing MICROSOFT_TENANT_ID");
if (!clientId) throw new Error("Missing MICROSOFT_CLIENT_ID");
if (!clientSecret) throw new Error("Missing MICROSOFT_CLIENT_SECRET");

export type OutlookDraftResult = {
  id: string;
  subject?: string | null;
  webLink?: string | null;
  conversationId?: string | null;
};

export type OutlookSentMessageResult = {
  id: string;
  subject?: string | null;
  webLink?: string | null;
  conversationId?: string | null;
  sentDateTime?: string | null;
};

async function getGraphAccessToken() {
  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

  const body = new URLSearchParams({
    client_id: clientId!,
    client_secret: clientSecret!,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });

  const json = await response.json();

  if (!response.ok) {
    throw new Error(
      json.error_description ||
        json.error ||
        "Failed to get Microsoft Graph token"
    );
  }

  return json.access_token as string;
}

async function graphFetch(path: string, init: RequestInit = {}) {
  const token = await getGraphAccessToken();

  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    cache: "no-store",
  });

  const text = await response.text();
  const json = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(
      json?.error?.message ||
        json?.error_description ||
        `Microsoft Graph request failed: ${response.status}`
    );
  }

  return json;
}

function htmlEscape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function plainTextToHtml(value: string) {
  return htmlEscape(value).replace(/\n/g, "<br />");
}

function addSignature(body: string) {
  const bodyHtml = plainTextToHtml(body).trim();

  if (!outlookSignatureHtml.trim()) {
    return bodyHtml;
  }

  return `${bodyHtml}${outlookSignatureHtml}`;
}

export async function createOutlookDraftMessage({
  mailbox = outlookSharedMailbox,
  to,
  subject,
  body,
}: {
  mailbox?: string;
  to: string;
  subject: string;
  body: string;
}): Promise<OutlookDraftResult> {
  const draft = await graphFetch(
    `/users/${encodeURIComponent(mailbox)}/messages`,
    {
      method: "POST",
      body: JSON.stringify({
        subject,
        body: {
          contentType: "HTML",
          content: addSignature(body),
        },
        toRecipients: [
          {
            emailAddress: {
              address: to,
            },
          },
        ],
      }),
    }
  );

  return {
    id: draft.id,
    subject: draft.subject,
    webLink: draft.webLink,
    conversationId: draft.conversationId,
  };
}

export async function createOutlookReplyDraft({
  mailbox = outlookSharedMailbox,
  sourceMessageId,
  body,
}: {
  mailbox?: string;
  sourceMessageId: string;
  body: string;
}): Promise<OutlookDraftResult> {
  const draft = await graphFetch(
    `/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(
      sourceMessageId
    )}/createReply`,
    {
      method: "POST",
      body: JSON.stringify({
        message: {
          body: {
            contentType: "HTML",
            content: addSignature(body),
          },
        },
      }),
    }
  );

  return {
    id: draft.id,
    subject: draft.subject,
    webLink: draft.webLink,
    conversationId: draft.conversationId,
  };
}

export async function findSentMessageByConversationId({
  mailbox = outlookSharedMailbox,
  conversationId,
}: {
  mailbox?: string;
  conversationId: string;
}): Promise<OutlookSentMessageResult | null> {
  const encodedMailbox = encodeURIComponent(mailbox);
  const escapedConversationId = conversationId.replaceAll("'", "''");

  const path =
    `/users/${encodedMailbox}/mailFolders/SentItems/messages` +
    `?$top=10` +
    `&$select=id,subject,webLink,conversationId,sentDateTime` +
    `&$orderby=sentDateTime desc` +
    `&$filter=conversationId eq '${encodeURIComponent(escapedConversationId)}'`;

  try {
    const result = await graphFetch(path, {
      method: "GET",
    });

    const messages = result?.value || [];

    if (!messages.length) {
      return null;
    }

    const message = messages[0];

    return {
      id: message.id,
      subject: message.subject,
      webLink: message.webLink,
      conversationId: message.conversationId,
      sentDateTime: message.sentDateTime,
    };
  } catch {
    const fallbackPath =
      `/users/${encodedMailbox}/mailFolders/SentItems/messages` +
      `?$top=25` +
      `&$select=id,subject,webLink,conversationId,sentDateTime` +
      `&$orderby=sentDateTime desc`;

    const result = await graphFetch(fallbackPath, {
      method: "GET",
    });

    const messages = result?.value || [];

    const match = messages.find(
      (message: any) => message.conversationId === conversationId
    );

    if (!match) {
      return null;
    }

    return {
      id: match.id,
      subject: match.subject,
      webLink: match.webLink,
      conversationId: match.conversationId,
      sentDateTime: match.sentDateTime,
    };
  }
}