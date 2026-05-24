import { generatePeriodontalChartPdf } from "@/lib/praktika/periodontal-chart"

export const runtime = "nodejs"

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)

    const patientId = searchParams.get("patientId")
    const appointmentDate = searchParams.get("appointmentDate")
    const patientName = searchParams.get("patientName")
    const providerName = searchParams.get("providerName")

    if (!patientId) {
      return new Response("Missing patientId", {
        status: 400,
      })
    }

    const result = await generatePeriodontalChartPdf({
      patientId,
      appointmentDate,
      patientName,
      providerName,
    })

    if (!result) {
      return new Response(
        "No periodontal chart found for this patient/date.",
        {
          status: 404,
        }
      )
    }

    return new Response(new Uint8Array(result.buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${result.fileName}"`,
      },
    })
  } catch (error) {
    console.error("Perio chart browser test failed:", error)

    return new Response(
      error instanceof Error
        ? error.message
        : "Failed to generate periodontal chart.",
      {
        status: 500,
      }
    )
  }
}