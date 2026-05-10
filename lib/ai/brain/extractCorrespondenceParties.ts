import { supabaseAdmin } from "@/lib/supabase/admin";

type ExtractCorrespondencePartiesParams = {
  inboxItemId: string;
};

function clean(value: string | null | undefined) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function titleCaseName(value: string | null | undefined) {
  const cleaned = clean(value)
    .replace(/^dr\s+/i, "Dr ")
    .replace(/[,.;:]+$/g, "")
    .trim();

  if (!cleaned) return null;

  if (/^dr\s+/i.test(cleaned)) {
    const withoutDr = cleaned.replace(/^dr\s+/i, "");

    return `Dr ${withoutDr
      .split(/\s+/)
      .map((part) =>
        part.length <= 2
          ? part.toUpperCase()
          : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase(),
      )
      .join(" ")}`;
  }

  return cleaned
    .split(/\s+/)
    .map((part) =>
      part.length <= 2
        ? part.toUpperCase()
        : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase(),
    )
    .join(" ");
}

function getEmailBodyOnly(item: any) {
  return clean(item?.email_body || "");
}

function getAttachmentText(item: any) {
  return clean(item?.extracted_text || "");
}

function getCombinedText(item: any) {
  return clean(
    [
      item?.email_subject || item?.subject || "",
      item?.email_body || "",
      item?.extracted_text || "",
      item?.raw_text || "",
      item?.body || "",
    ]
      .filter(Boolean)
      .join("\n\n"),
  );
}

function stripQuotedReplyAndAttachments(emailBody: string) {
  const text = clean(emailBody);

  const cutMarkers = [
    "\n---",
    "\nFrom:",
    "\nSent:",
    "\nOn ",
    "\n> ",
    "\n________________________________",
  ];

  let result = text;

  for (const marker of cutMarkers) {
    const index = result.indexOf(marker);

    if (index > 0) {
      result = result.slice(0, index).trim();
    }
  }

  return result;
}

function containsOrganisationSignal(value: string | null | undefined) {
  const lower = clean(value).toLowerCase();

  if (!lower) return false;

  const organisationSignals = [
    " dental",
    " dentist",
    " orthodont",
    " perio",
    " periodont",
    " prosthodont",
    " surgery",
    " specialist",
    " specialists",
    " clinic",
    " practice",
    " centre",
    " center",
    " family",
    " health",
    " medical",
    " hospital",
    " oral",
    " maxillofacial",
    " referrals",
    " referral",
    " admin",
    " accounts",
    " team",
    " pty",
    " ltd",
    " focus dental",
    " focus perio",
    " email",
    " phone",
    " fax",
    " www",
    ".com",
    ".com.au",
  ];

  return organisationSignals.some((signal) => lower.includes(signal.trim()));
}

function looksLikeHumanName(value: string | null | undefined) {
  const cleaned = clean(value);

  if (!cleaned) return false;
  if (cleaned.length > 60) return false;
  if (/@/.test(cleaned)) return false;
  if (/\d/.test(cleaned)) return false;
  if (containsOrganisationSignal(cleaned)) return false;

  const parts = cleaned.split(/\s+/).filter(Boolean);

  if (parts.length === 0 || parts.length > 4) return false;

  const forbiddenSingleNames = [
    "admin",
    "reception",
    "referrals",
    "team",
    "clinic",
    "practice",
    "dental",
    "specialists",
    "support",
    "info",
    "hello",
    "accounts",
    "family",
  ];

  if (
    parts.length === 1 &&
    forbiddenSingleNames.includes(parts[0].toLowerCase())
  ) {
    return false;
  }

  return /^[a-zA-Z][a-zA-Z .'-]{1,60}$/.test(cleaned);
}

/*
  This is the key fix for:
  "Kind regards, Elina Reception for Dr Peter Russell ..."
  It extracts "Elina" before generic role/organisation words.
*/
function extractPersonBeforeRole(value: string | null | undefined) {
  const raw = clean(value);

  if (!raw) return null;

  const roleSplit = raw
    .split(
      /\b(?:reception|receptionist|admin|administrator|practice manager|treatment coordinator|coordinator|front desk|for dr|for doctor|on behalf of|from)\b/i,
    )[0]
    .trim();

  if (looksLikeHumanName(roleSplit)) {
    return titleCaseName(roleSplit);
  }

  const firstTwoWords = raw.split(/\s+/).slice(0, 2).join(" ");

  if (looksLikeHumanName(firstTwoWords)) {
    return titleCaseName(firstTwoWords);
  }

  const firstWord = raw.split(/\s+/)[0];

  if (looksLikeHumanName(firstWord)) {
    return titleCaseName(firstWord);
  }

  return null;
}

function extractLikelyOrganisationName(value: string | null | undefined) {
  const text = clean(value);

  if (!text) return null;

  const organisationMatch = text.match(
    /\b([A-Z][A-Za-z'&.-]+(?:\s+[A-Z]?[A-Za-z'&.-]+){0,5}\s+(?:Dental|Dentist|Specialists|Specialist|Clinic|Practice|Centre|Center|Health|Surgery|Orthodontics|Periodontics|Prosthodontics|Family Dental))\b/i,
  );

  if (organisationMatch?.[1]) {
    return titleCaseName(organisationMatch[1]);
  }

  return null;
}

function extractSignoffCandidate(emailBody: string) {
  const body = stripQuotedReplyAndAttachments(emailBody);

  if (!body) {
    return {
      rawCandidate: null,
      personName: null,
      organisationName: null,
      source: "not_found",
    };
  }

  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const signoffWords = [
    "thanks",
    "thank you",
    "kind regards",
    "regards",
    "best wishes",
    "best",
    "cheers",
    "many thanks",
    "warm regards",
  ];

  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index].replace(/[,.!]+$/g, "").trim();
    const lower = line.toLowerCase();

    const matchedSignoff = signoffWords.some(
      (word) => lower === word || lower.startsWith(`${word} `),
    );

    if (!matchedSignoff) continue;

    for (const word of signoffWords) {
      const pattern = new RegExp(`^${word}[,\\s-]+(.+)$`, "i");
      const match = line.match(pattern);

      if (match?.[1]) {
        const rawCandidate = clean(match[1]);
        const personBeforeRole = extractPersonBeforeRole(rawCandidate);

        if (personBeforeRole) {
          return {
            rawCandidate,
            personName: personBeforeRole,
            organisationName: extractLikelyOrganisationName(rawCandidate),
            source: "same_line_signoff_person_before_role",
          };
        }

        if (looksLikeHumanName(rawCandidate)) {
          return {
            rawCandidate,
            personName: titleCaseName(rawCandidate),
            organisationName: null,
            source: "same_line_signoff_person",
          };
        }

        const organisationName = extractLikelyOrganisationName(rawCandidate);

        if (organisationName || containsOrganisationSignal(rawCandidate)) {
          return {
            rawCandidate,
            personName: null,
            organisationName: organisationName || titleCaseName(rawCandidate),
            source: "same_line_signoff_organisation",
          };
        }
      }
    }

    const nextLine = lines[index + 1]?.replace(/[,.!]+$/g, "").trim();

    if (nextLine) {
      const personBeforeRole = extractPersonBeforeRole(nextLine);

      if (personBeforeRole) {
        return {
          rawCandidate: nextLine,
          personName: personBeforeRole,
          organisationName: extractLikelyOrganisationName(nextLine),
          source: "next_line_signoff_person_before_role",
        };
      }

      if (looksLikeHumanName(nextLine)) {
        return {
          rawCandidate: nextLine,
          personName: titleCaseName(nextLine),
          organisationName: null,
          source: "next_line_signoff_person",
        };
      }

      const organisationName = extractLikelyOrganisationName(nextLine);

      if (organisationName || containsOrganisationSignal(nextLine)) {
        return {
          rawCandidate: nextLine,
          personName: null,
          organisationName: organisationName || titleCaseName(nextLine),
          source: "next_line_signoff_organisation",
        };
      }
    }
  }

  /*
    Handles one-line email:
    Good morning, ... Kind regards, Elina Reception for Dr Peter Russell...
  */
  const inlineMatch = body.match(
    /\b(?:thanks|thank you|kind regards|regards|cheers|many thanks)[,\s-]+(.{2,180})/i,
  );

  if (inlineMatch?.[1]) {
    const rawCandidate = clean(inlineMatch[1]);

    const trimmedBeforeContact = rawCandidate
      .split(/\b(?:1\s*st|level|suite|unit|phone|ph:|fax|email|www|http|p\s*[:\d]|f\s*[:\d]|e\s*:|w\s*:)/i)[0]
      .trim();

    const personBeforeRole = extractPersonBeforeRole(trimmedBeforeContact);

    if (personBeforeRole) {
      return {
        rawCandidate: trimmedBeforeContact,
        personName: personBeforeRole,
        organisationName: extractLikelyOrganisationName(rawCandidate),
        source: "inline_signoff_person_before_role",
      };
    }

    if (looksLikeHumanName(trimmedBeforeContact)) {
      return {
        rawCandidate: trimmedBeforeContact,
        personName: titleCaseName(trimmedBeforeContact),
        organisationName: null,
        source: "inline_signoff_person",
      };
    }

    const organisationName =
      extractLikelyOrganisationName(rawCandidate) ||
      extractLikelyOrganisationName(trimmedBeforeContact);

    if (
      organisationName ||
      containsOrganisationSignal(rawCandidate) ||
      containsOrganisationSignal(trimmedBeforeContact)
    ) {
      return {
        rawCandidate: trimmedBeforeContact || rawCandidate,
        personName: null,
        organisationName:
          organisationName ||
          titleCaseName(trimmedBeforeContact || rawCandidate),
        source: "inline_signoff_organisation",
      };
    }
  }

  return {
    rawCandidate: null,
    personName: null,
    organisationName: extractLikelyOrganisationName(body),
    source: "organisation_detected_without_person",
  };
}

function extractAddresseeFromAttachment(text: string) {
  const cleaned = clean(text);

  const dearMatch = cleaned.match(
    /\bDear\s+(Dr\s+[A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+)?)/,
  );

  if (dearMatch?.[1]) {
    return titleCaseName(dearMatch[1]);
  }

  const firstLines = cleaned.split(/\r?\n/).slice(0, 14).join("\n");

  const lineMatch = firstLines.match(
    /\b(Dr\s+[A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+)?)/,
  );

  if (lineMatch?.[1]) {
    return titleCaseName(lineMatch[1]);
  }

  return null;
}

function extractAuthorFromAttachment(text: string) {
  const cleaned = clean(text);

  const regardsIndex = cleaned.search(
    /\b(?:kindest regards|kind regards|regards|yours sincerely|sincerely)\b/i,
  );

  if (regardsIndex >= 0) {
    const after = cleaned.slice(regardsIndex, regardsIndex + 700);
    const drMatch = after.match(
      /\b(Dr\s+[A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+)?)/,
    );

    if (drMatch?.[1]) {
      return titleCaseName(drMatch[1]);
    }
  }

  const allDoctors = Array.from(
    cleaned.matchAll(
      /\b(Dr\s+[A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+)?)/g,
    ),
  ).map((match) => match[1]);

  if (allDoctors.length > 0) {
    return titleCaseName(allDoctors[allDoctors.length - 1]);
  }

  return null;
}

function splitTitleAndName(value: string | null) {
  if (!value) {
    return {
      title: null,
      name: null,
    };
  }

  const cleaned = clean(value);

  if (/^Dr\s+/i.test(cleaned)) {
    return {
      title: "Dr",
      name: cleaned.replace(/^Dr\s+/i, "").trim(),
    };
  }

  return {
    title: null,
    name: cleaned,
  };
}

function getSenderDecision({
  signoffCandidate,
  mailboxName,
}: {
  signoffCandidate: {
    rawCandidate: string | null;
    personName: string | null;
    organisationName: string | null;
    source: string;
  };
  mailboxName: string | null;
}) {
  if (signoffCandidate.personName) {
    const signoffFirst = signoffCandidate.personName
      .split(/\s+/)[0]
      ?.toLowerCase();
    const mailboxFirst = mailboxName?.split(/\s+/)[0]?.toLowerCase();

    return {
      senderName: signoffCandidate.personName,
      organisationName: signoffCandidate.organisationName,
      confidence:
        mailboxFirst && signoffFirst && mailboxFirst !== signoffFirst
          ? 0.95
          : 0.9,
      source:
        mailboxFirst && signoffFirst && mailboxFirst !== signoffFirst
          ? "email_body_signoff_over_mailbox_display_name"
          : "email_body_signoff",
      note:
        mailboxFirst && signoffFirst && mailboxFirst !== signoffFirst
          ? "Email sign-off differed from mailbox display name. The sign-off person was used because it better reflects who wrote the message."
          : "Email sign-off person was used as correspondence sender.",
    };
  }

  if (signoffCandidate.organisationName) {
    return {
      senderName: null,
      organisationName: signoffCandidate.organisationName,
      confidence: 0.75,
      source: "generic_organisation_signature",
      note:
        "The signature appears to be a clinic/practice/organisation rather than an individual. A team greeting should be used.",
    };
  }

  if (mailboxName && looksLikeHumanName(mailboxName)) {
    return {
      senderName: mailboxName,
      organisationName: null,
      confidence: 0.65,
      source: "mailbox_display_name_fallback",
      note:
        "No reliable sign-off person was detected. Mailbox display name was used as fallback.",
    };
  }

  return {
    senderName: null,
    organisationName: signoffCandidate.organisationName || null,
    confidence: 0,
    source: "unknown",
    note: "No reliable individual sender name detected.",
  };
}

export async function extractCorrespondenceParties({
  inboxItemId,
}: ExtractCorrespondencePartiesParams) {
  const { data: item, error } = await supabaseAdmin
    .from("ai_inbox_items")
    .select("*")
    .eq("id", inboxItemId)
    .single();

  if (error || !item) {
    throw new Error(error?.message || "Inbox item not found.");
  }

  const emailBody = getEmailBodyOnly(item);
  const attachmentText = getAttachmentText(item);
  const combinedText = getCombinedText(item);

  const signoffCandidate = extractSignoffCandidate(emailBody);
  const mailboxName = titleCaseName(item.sender_name || null);

  const senderDecision = getSenderDecision({
    signoffCandidate,
    mailboxName,
  });

  const addressee = extractAddresseeFromAttachment(
    attachmentText || combinedText,
  );
  const author = extractAuthorFromAttachment(attachmentText || combinedText);

  const addresseeParts = splitTitleAndName(addressee);
  const authorParts = splitTitleAndName(author);

  const updatePayload = {
    correspondence_sender_name: senderDecision.senderName,
    correspondence_sender_email: item.sender_email || null,
    correspondence_sender_source: senderDecision.source,
    correspondence_sender_confidence: senderDecision.confidence,

    correspondence_addressee_name: addresseeParts.name,
    correspondence_addressee_title: addresseeParts.title,
    correspondence_addressee_source: addressee
      ? "attachment_addressee_or_dear_line"
      : null,
    correspondence_addressee_confidence: addressee ? 0.9 : null,

    correspondence_author_name: authorParts.name,
    correspondence_author_title: authorParts.title,
    correspondence_author_source: author
      ? "attachment_signoff_or_last_doctor_name"
      : null,
    correspondence_author_confidence: author ? 0.85 : null,

    correspondence_party_extraction: {
      signoff_candidate: signoffCandidate.rawCandidate,
      signoff_person_name: signoffCandidate.personName,
      organisation_name: senderDecision.organisationName,
      mailbox_display_name: mailboxName,
      mailbox_email: item.sender_email || null,
      sender_note: senderDecision.note,
      detected_addressee: addressee,
      detected_author: author,
      email_body_used_for_signoff: emailBody,
    },
  };

  const { data: updatedItem, error: updateError } = await supabaseAdmin
    .from("ai_inbox_items")
    .update(updatePayload)
    .eq("id", inboxItemId)
    .select("*")
    .single();

  if (updateError) {
    throw new Error(updateError.message);
  }

  await supabaseAdmin.from("ai_workbench_audit_events").insert({
    inbox_item_id: inboxItemId,
    event_type: "correspondence_parties_extracted",
    event_label: "Correspondence parties extracted",
    details: updatePayload,
  });

  return {
    success: true,
    ...updatePayload,
    item: updatedItem,
  };
}

function displayDoctor(
  title: string | null | undefined,
  name: string | null | undefined,
) {
  const cleanedName = clean(name);
  const cleanedTitle = clean(title);

  if (!cleanedName) return null;

  if (cleanedTitle) return `${cleanedTitle} ${cleanedName}`;

  return cleanedName;
}

export function formatCorrespondencePartiesForPrompt(parties: any) {
  if (!parties) {
    return "No correspondence parties detected.";
  }

  const saved = parties.correspondence_party_extraction || {};

  const senderName =
    parties.correspondence_sender_name ||
    parties.correspondence_sender ||
    null;

  const organisationName =
    saved.organisation_name ||
    saved.detected_organisation ||
    null;

  const senderSource = parties.correspondence_sender_source || "unknown";

  const addressee = displayDoctor(
    parties.correspondence_addressee_title,
    parties.correspondence_addressee_name ||
      parties.correspondence_addressee,
  );

  const author = displayDoctor(
    parties.correspondence_author_title,
    parties.correspondence_author_name || parties.correspondence_author,
  );

  return `
Correspondence parties detected:

Email writer / reply greeting name:
${senderName || "No individual sender detected"}

Sender organisation:
${organisationName || "Unknown"}

Email writer source:
${senderSource}

Attached letter addressee:
${addressee || "Unknown"}

Attached letter author:
${author || "Unknown"}

Drafting instructions:
- If an individual sender name is known, greet that person by first name.
- If no individual sender name is known and the sender appears to be a clinic/practice/team/organisation, use "Dear team,".
- If the email writer source is generic_organisation_signature, do not greet the organisation as a person.
- If the attached letter addressee is known, do not automatically assume they are the Focus clinician.
- Prefer assigned_clinician_name from the Workbench item when saying who the correspondence will be passed on to.
- If assigned_clinician_name is not available and the addressee is not clearly a Focus clinician, say "the relevant clinician" rather than naming the addressee.
- If the attached letter author is known, you may mention "the letter from ${author || "the referring clinician"}" if this is natural and helpful.
- Do not invent sender, author, or addressee names.
- Do not say the addressee has reviewed the correspondence.
- Do not provide clinical advice.
`.trim();
}
