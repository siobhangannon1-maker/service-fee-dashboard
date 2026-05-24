import { NextResponse } from "next/server";
import { generatePeriodontalChartPdf } from "@/lib/praktika/periodontal-chart";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const patientId = body.patientId;
    const appointmentDate = body.appointmentDate || null;
    const patientName = body.patientName || null;
    const providerName = body.providerName || null;

    if (!patientId) {
      return NextResponse.json(
        { success: false, error: "Missing patientId." },
        { status: 400 }
      );
    }

    const result = await generatePeriodontalChartPdf({
      patientId,
      appointmentDate,
      patientName,
      providerName,
    });

    if (!result) {
      return NextResponse.json(
        {
          success: false,
          error:
            "No periodontal chart found for this patient/date. Check that a perio exam exists on the appointment date.",
        },
        { status: 404 }
      );
    }

    return new NextResponse(new Uint8Array(result.buffer), {
      headers: {
        "Content-Type": result.contentType,
        "Content-Disposition": `attachment; filename="${result.fileName}"`,
        "X-Perio-Exam-Id": String(result.examId),
        "X-Perio-Exam-Date": result.examDate,
      },
    });
  } catch (error) {
    console.error("Generate periodontal chart failed:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate periodontal chart.",
      },
      { status: 500 }
    );
  }
}