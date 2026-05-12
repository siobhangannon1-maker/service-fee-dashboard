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

export type OutlookArchivedMessageResult = {
  id: string;
  subject?: string | null;
  webLink?: string | null;
  conversationId?: string | null;
  parentFolderId?: string | null;
};

export type OutlookInboxMessage = {
  id: string;
  subject?: string | null;
  bodyPreview?: string | null;
  receivedDateTime?: string | null;
  conversationId?: string | null;
  webLink?: string | null;
  from?: {
    emailAddress?: {
      name?: string | null;
      address?: string | null;
    };
  } | null;
  body?: {
    contentType?: string | null;
    content?: string | null;
  } | null;
  hasAttachments?: boolean | null;
};

export type OutlookAttachment = {
  id: string;
  name?: string | null;
  contentType?: string | null;
  size?: number | null;
  isInline?: boolean | null;
  contentBytes?: string | null;
  "@odata.type"?: string;
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
        "Failed to get Microsoft Graph token",
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

  let json: any = null;

  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(
        `Microsoft Graph returned non-JSON response: ${response.status} ${text.slice(
          0,
          300,
        )}`,
      );
    }
  }

  if (!response.ok) {
    throw new Error(
      json?.error?.message ||
        json?.error_description ||
        `Microsoft Graph request failed: ${response.status}`,
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
    },
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
      sourceMessageId,
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
    },
  );

  return {
    id: draft.id,
    subject: draft.subject,
    webLink: draft.webLink,
    conversationId: draft.conversationId,
  };
}

export async function sendOutlookDraft({
  mailbox = outlookSharedMailbox,
  draftMessageId,
}: {
  mailbox?: string;
  draftMessageId: string;
}): Promise<{ ok: true; draftMessageId: string }> {
  await graphFetch(
    `/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(
      draftMessageId,
    )}/send`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );

  return {
    ok: true,
    draftMessageId,
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

  const path =
    `/users/${encodedMailbox}/mailFolders/SentItems/messages` +
    `?$top=25` +
    `&$select=id,subject,webLink,conversationId,sentDateTime` +
    `&$orderby=sentDateTime desc`;

  const result = await graphFetch(path, { method: "GET" });
  const messages = result?.value || [];

  const match = messages.find(
    (message: any) => message.conversationId === conversationId,
  );

  if (!match) return null;

  return {
    id: match.id,
    subject: match.subject,
    webLink: match.webLink,
    conversationId: match.conversationId,
    sentDateTime: match.sentDateTime,
  };
}

export async function listRecentInboxMessages({
  mailbox = outlookSharedMailbox,
  limit = 10,
}: {
  mailbox?: string;
  limit?: number;
}): Promise<OutlookInboxMessage[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 25);
  const encodedMailbox = encodeURIComponent(mailbox);

  const path =
    `/users/${encodedMailbox}/mailFolders/Inbox/messages` +
    `?$top=${safeLimit}` +
    `&$select=id,subject,bodyPreview,receivedDateTime,conversationId,webLink,from,body,hasAttachments` +
    `&$orderby=receivedDateTime desc`;

  const result = await graphFetch(path, { method: "GET" });

  return result?.value || [];
}

export async function listMessageAttachments({
  mailbox = outlookSharedMailbox,
  messageId,
}: {
  mailbox?: string;
  messageId: string;
}): Promise<OutlookAttachment[]> {
  const encodedMailbox = encodeURIComponent(mailbox);
  const encodedMessageId = encodeURIComponent(messageId);

  const result = await graphFetch(
    `/users/${encodedMailbox}/messages/${encodedMessageId}/attachments?$top=20`,
    { method: "GET" },
  );

  return result?.value || [];
}

export async function getMessageAttachment({
  mailbox = outlookSharedMailbox,
  messageId,
  attachmentId,
}: {
  mailbox?: string;
  messageId: string;
  attachmentId: string;
}): Promise<OutlookAttachment> {
  const encodedMailbox = encodeURIComponent(mailbox);
  const encodedMessageId = encodeURIComponent(messageId);
  const encodedAttachmentId = encodeURIComponent(attachmentId);

  return graphFetch(
    `/users/${encodedMailbox}/messages/${encodedMessageId}/attachments/${encodedAttachmentId}`,
    { method: "GET" },
  );
}

export async function archiveOutlookMessage({
  mailbox = outlookSharedMailbox,
  messageId,
}: {
  mailbox?: string;
  messageId: string;
}): Promise<OutlookArchivedMessageResult> {
  const encodedMailbox = encodeURIComponent(mailbox);
  const encodedMessageId = encodeURIComponent(messageId);

  const movedMessage = await graphFetch(
    `/users/${encodedMailbox}/messages/${encodedMessageId}/move`,
    {
      method: "POST",
      body: JSON.stringify({
        destinationId: "archive",
      }),
    },
  );

  return {
    id: movedMessage.id,
    subject: movedMessage.subject,
    webLink: movedMessage.webLink,
    conversationId: movedMessage.conversationId,
    parentFolderId: movedMessage.parentFolderId,
  };
}
