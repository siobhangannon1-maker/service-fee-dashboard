import { NextResponse } from "next/server";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(request: Request) {
  try {
    // 🔍 DEBUG — this will print in your terminal
    console.log("RESEND_API_KEY:", process.env.RESEND_API_KEY ? "FOUND" : "MISSING");
    console.log("RESEND_FROM_EMAIL:", process.env.RESEND_FROM_EMAIL);

    const body = await request.json();

    const to = String(body.to || "").trim();
    const subject = String(body.subject || "").trim();
    const intro = String(body.intro || "").trim();
    const checklistItems = Array.isArray(body.checklistItems)
      ? body.checklistItems
    .map((item: unknown) => String(item).trim())
    .filter(Boolean)
      : [];

    if (!to || !isValidEmail(to)) {
      return NextResponse.json(
        { error: "Please enter a valid email address." },
        { status: 400 }
      );
    }

    if (!subject) {
      return NextResponse.json(
        { error: "Please enter an email subject." },
        { status: 400 }
      );
    }

    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json(
        { error: "Missing RESEND_API_KEY environment variable." },
        { status: 500 }
      );
    }

    if (!process.env.RESEND_FROM_EMAIL) {
      return NextResponse.json(
        { error: "Missing RESEND_FROM_EMAIL environment variable." },
        { status: 500 }
      );
    }

   const checklistHtml = checklistItems
  .map(
    (item: string) => `
      <li style="margin-bottom: 10px;">
        <span style="font-size: 18px;">☐</span>
        <span>${item}</span>
      </li>
    `
  )
  .join("");

    const checklistText = checklistItems
  .map((item: string) => `☐ ${item}`)
  .join("\n");

    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #0f172a;">
        <h2>${subject}</h2>
        ${intro ? `<p>${intro.replace(/\n/g, "<br />")}</p>` : ""}
        ${
          checklistItems.length
            ? `<ul style="padding-left: 0; list-style: none;">${checklistHtml}</ul>`
            : ""
        }
      </div>
    `;

    const text = `${subject}

${intro}

${checklistText}`;

    const result = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL,
      to,
      subject,
      html,
      text,

      // optional reply-to (you can add later)
      // reply_to: "admin@focusdentalspecialists.com.au",
    });

    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error("Send completion email error:", error);

    return NextResponse.json(
      { error: "Email failed to send." },
      { status: 500 }
    );
  }
}