import { NextResponse } from "next/server";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { to, subject, html } = body;

    if (!to || !subject || !html) {
      return NextResponse.json(
        { error: "Missing required fields: to, subject, html" },
        { status: 400 }
      );
    }

    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json(
        { error: "Missing RESEND_API_KEY in environment variables" },
        { status: 500 }
      );
    }

    const response = await resend.emails.send({
      from: process.env.EMAIL_FROM || "onboarding@resend.dev",
      to,
      subject,
      html,
    });

    if ((response as any)?.error) {
      console.error("Resend API error:", (response as any).error);
      return NextResponse.json(
        { error: (response as any).error },
        { status: 500 }
      );
    }

    console.log("Resend email response:", response);

    return NextResponse.json({ success: true, response });
  } catch (error: any) {
    console.error("Email send error:", error);

    return NextResponse.json(
      { error: error?.message || "Failed to send email" },
      { status: 500 }
    );
  }
}