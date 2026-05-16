import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { Resend } from "resend"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { execFile } from "child_process"
import { promisify } from "util"
import { formatDobPassword } from "@/lib/report-writing/pdf-password"
import { createReportAuditEvent, getAuditActor } from "@/lib/report-writing/audit"

export const runtime = "nodejs"

const execFileAsync = promisify(execFile)
const resend = new Resend(process.env.RESEND_API_KEY)

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function safeFileName(name: string | null | undefined) {
  return String(name || "Patient")
    .trim()
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
}

async function encryptPdf(inputBuffer: Buffer, password: string) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "secure-report-"))
  const inputPath = path.join(tempDir, "input.pdf")
  const outputPath = path.join(tempDir, "output.pdf")

  await fs.writeFile(inputPath, inputBuffer)

  await execFileAsync("qpdf", [
    "--encrypt",
    password,
    password,
    "256",
    "--",
    inputPath,
    outputPath,
  ])

  const encryptedBuffer = await fs.readFile(outputPath)
  await fs.rm(tempDir, { recursive: true, force: true })

  return encryptedBuffer
}

function buildProfessionalSignatureHtml() {
  const logoUrl = process.env.EMAIL_SIGNATURE_LOGO_URL || ""
  const afterpayUrl = process.env.EMAIL_SIGNATURE_AFTERPAY_URL || ""
  const zipUrl = process.env.EMAIL_SIGNATURE_ZIP_URL || ""
  const hummUrl = process.env.EMAIL_SIGNATURE_HUMM_URL || ""

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:28px;font-family:Arial,sans-serif;">
      <tr>
        <td style="width:220px;padding-right:26px;vertical-align:top;text-align:center;border-right:3px solid #f37770;">
          ${
            logoUrl
              ? `<img src="${logoUrl}" width="150" alt="Focus Dental Specialists" style="display:block;margin:0 auto 18px auto;border:0;outline:none;text-decoration:none;" />`
              : `<div style="font-size:24px;font-weight:700;color:#f37770;line-height:1.1;margin-bottom:18px;">Focus<br/>Dental<br/>Specialists</div>`
          }

          <div style="white-space:nowrap;">
            ${
              afterpayUrl
                ? `<img src="${afterpayUrl}" width="74" alt="Afterpay" style="display:inline-block;margin-right:8px;border:0;vertical-align:middle;" />`
                : ""
            }
            ${
              zipUrl
                ? `<img src="${zipUrl}" width="45" alt="Zip" style="display:inline-block;margin-right:8px;border:0;vertical-align:middle;" />`
                : ""
            }
            ${
              hummUrl
                ? `<img src="${hummUrl}" width="45" alt="Humm" style="display:inline-block;border:0;vertical-align:middle;" />`
                : ""
            }
          </div>
        </td>

        <td style="padding-left:26px;vertical-align:top;color:#34465c;font-size:15px;line-height:1.45;">
          <table role="presentation" cellpadding="0" cellspacing="0" style="font-family:Arial,sans-serif;color:#34465c;font-size:15px;">
            <tr>
              <td style="padding:0 12px 13px 0;vertical-align:middle;">
                <span style="display:inline-block;width:34px;height:34px;border-radius:50%;background:#f37770;color:white;text-align:center;line-height:34px;font-weight:bold;font-size:17px;">☎</span>
              </td>
              <td style="padding-bottom:13px;font-weight:700;">07 3077 9620</td>
            </tr>

            <tr>
              <td style="padding:0 12px 13px 0;vertical-align:middle;">
                <span style="display:inline-block;width:34px;height:34px;border-radius:50%;background:#f37770;color:white;text-align:center;line-height:34px;font-weight:bold;font-size:17px;">✉</span>
              </td>
              <td style="padding-bottom:13px;">
                <a href="mailto:hello@focusds.com.au" style="color:#34465c;text-decoration:none;">hello@focusds.com.au</a>
              </td>
            </tr>

            <tr>
              <td style="padding:0 12px 13px 0;vertical-align:top;">
                <span style="display:inline-block;width:34px;height:34px;border-radius:50%;background:#f37770;color:white;text-align:center;line-height:34px;font-weight:bold;font-size:17px;">●</span>
              </td>
              <td style="padding-bottom:13px;">Coorparoo | Paddington | Chermside |<br/>Capalaba</td>
            </tr>

            <tr>
              <td style="padding:0 12px 0 0;vertical-align:middle;">
                <span style="display:inline-block;width:34px;height:34px;border-radius:50%;background:#f37770;color:white;text-align:center;line-height:34px;font-weight:bold;font-size:17px;">◎</span>
              </td>
              <td>
                <a href="https://www.focusds.com.au" style="color:#34465c;text-decoration:none;">www.focusds.com.au</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `
}

function buildDisclaimerHtml() {
  return `
    <div style="margin-top:28px;padding-top:18px;border-top:1px solid #d9d9d9;font-family:Arial,sans-serif;font-size:11px;line-height:1.5;color:#777;">
      <strong>Confidentiality Notice</strong><br><br>
      This email and any attachments are confidential and intended only for the named recipient(s).
      They may contain sensitive health information protected under applicable privacy legislation,
      including the Australian Privacy Act 1988 (Cth). If you are not the intended recipient, you
      must not use, disclose, copy, distribute, print, or rely on this communication. If you have
      received this email in error, please notify Focus Dental Specialists immediately by reply email
      and permanently delete this email and any attachments from your system.
      <br><br>
      Any views expressed in this email are those of the author unless otherwise stated.
    </div>
  `
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const actor = await getAuditActor()

    const draftId = body.draftId
    const manualEmail =
      body.toEmail ||
      body.email ||
      body.overrideEmail ||
      body.recipientEmail ||
      body.referrerEmail ||
      ""

    const subject = body.subject
    const message = body.message

    if (!draftId) {
      return NextResponse.json(
        { success: false, error: "Missing draftId." },
        { status: 400 }
      )
    }

    const { data: draft, error: draftError } = await supabase
      .from("report_drafts")
      .select("*")
      .eq("id", draftId)
      .single()

    if (draftError || !draft) {
      return NextResponse.json(
        { success: false, error: "Draft not found." },
        { status: 404 }
      )
    }

    if (!draft.patient_dob) {
      return NextResponse.json(
        {
          success: false,
          error: "Patient DOB is required to password-protect the PDF.",
        },
        { status: 400 }
      )
    }

    let finalToEmail = String(manualEmail || "").trim()

    if (!finalToEmail && draft.referrer_name) {
      const { data: referrer } = await supabase
        .from("report_referrers")
        .select("email")
        .eq("name", draft.referrer_name)
        .maybeSingle()

      finalToEmail = String(referrer?.email || "").trim()
    }

    if (!finalToEmail) {
      return NextResponse.json(
        { success: false, error: "No referrer email address found." },
        { status: 400 }
      )
    }

    const password = formatDobPassword(draft.patient_dob)

    if (!password) {
      return NextResponse.json(
        { success: false, error: "Could not create password from patient DOB." },
        { status: 400 }
      )
    }

    const origin = new URL(req.url).origin

    const pdfResponse = await fetch(`${origin}/api/report-writing/generate-pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftId }),
    })

    if (!pdfResponse.ok) {
      return NextResponse.json(
        { success: false, error: "Failed to generate PDF before email." },
        { status: 500 }
      )
    }

    const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer())
    const encryptedPdf = await encryptPdf(pdfBuffer, password)

    const patientName = draft.patient_name || "Patient"

    const fileName = `${new Date().toISOString().slice(0, 10)} ${safeFileName(
      patientName
    )} Letter.pdf`

    const baseSubject =
      String(subject || "").trim() ||
      "Secure correspondence from Focus Dental Specialists"

    const finalSubject = baseSubject.includes(patientName)
      ? baseSubject
      : `${baseSubject} - ${patientName}`

    const finalMessage =
      String(message || "").trim() ||
      `You have received secure correspondence from Focus Dental Specialists regarding ${patientName}. The attached PDF is password encrypted with the patient DOB (DDMMYYYY).`

    const emailHtml = `
      <div style="font-family:Arial,sans-serif;font-size:15px;color:#222;line-height:1.6;">
        ${escapeHtml(finalMessage).replace(/\n/g, "<br>")}
        ${buildProfessionalSignatureHtml()}
        ${buildDisclaimerHtml()}
      </div>
    `

    const resendResponse = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL!,
      to: finalToEmail,
      subject: finalSubject,
      html: emailHtml,
      attachments: [
        {
          filename: fileName,
          content: encryptedPdf.toString("base64"),
        },
      ],
    })

    if (resendResponse.error) {
      return NextResponse.json(
        { success: false, error: resendResponse.error.message },
        { status: 500 }
      )
    }

    await supabase
      .from("report_drafts")
      .update({
        emailed_to_referrer_at: new Date().toISOString(),
        emailed_to_referrer_email: finalToEmail,
        emailed_to_referrer_resend_id:
          typeof resendResponse.data?.id === "string"
            ? resendResponse.data.id
            : null,
        emailed_by_initials: actor.actorInitials,
        emailed_by_name: actor.actorFullName,
        updated_at: new Date().toISOString(),
      })
      .eq("id", draftId)

    await createReportAuditEvent({
      reportDraftId: draft.id,
      providerId: draft.provider_id,
      patientName: draft.patient_name,
      action: "Secure PDF emailed to referrer",
      details: {
        email: finalToEmail,
        resendId: resendResponse.data?.id || null,
        subject: finalSubject,
        actorInitials: actor.actorInitials,
        actorFullName: actor.actorFullName,
      },
    })

    return NextResponse.json({
      success: true,
      email: finalToEmail,
      resendId: resendResponse.data?.id || null,
      subject: finalSubject,
    })
  } catch (error) {
    console.error("Secure email failed:", error)

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to email secure PDF.",
      },
      { status: 500 }
    )
  }
}
