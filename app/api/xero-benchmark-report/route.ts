import { NextResponse } from "next/server";
import generateExpenseBenchmarkReport from "@/lib/generate-expense-benchmark-report";
import { supabaseAdmin } from "@/lib/supabase/admin";

type XeroUploadRequestBody = {
  year?: number | string;
  month?: number | string;
  rows?: unknown[];
  importId?: string;
};

export async function POST(request: Request) {
  let importId: string | null = null;

  try {
    const body = (await request.json()) as XeroUploadRequestBody;

    const year = Number(body.year);
    const month = Number(body.month);
    const rows = Array.isArray(body.rows) ? body.rows : [];
    importId = typeof body.importId === "string" ? body.importId : null;

    if (!Number.isInteger(year) || year <= 0) {
      return NextResponse.json(
        { error: "A valid year is required." },
        { status: 400 }
      );
    }

    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return NextResponse.json(
        { error: "A valid month is required." },
        { status: 400 }
      );
    }

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "No Xero rows were provided." },
        { status: 400 }
      );
    }

    console.log("xero-benchmark-report POST received", {
      year,
      month,
      rowCount: rows.length,
      importId,
    });

    const report = await generateExpenseBenchmarkReport(year, month, rows);

    if (importId) {
      const { error: updateError } = await supabaseAdmin
        .from("xero_imports")
        .update({
          status: "processed",
          processed_at: new Date().toISOString(),
        })
        .eq("id", importId);

      if (updateError) {
        console.error("Failed to update xero_imports after processing", {
          importId,
          message: updateError.message,
        });

        return NextResponse.json(
          {
            error: `Report generated, but failed to update xero_imports: ${updateError.message}`,
          },
          { status: 500 }
        );
      }
    }

    return NextResponse.json(report);
  } catch (error) {
    console.error("xero-benchmark-report POST failed", {
      importId,
      error,
    });

    if (importId) {
      await supabaseAdmin
        .from("xero_imports")
        .update({
          status: "failed",
        })
        .eq("id", importId);
    }

    const message =
      error instanceof Error ? error.message : "Unknown server error";

    return NextResponse.json(
      {
        error: message,
      },
      { status: 500 }
    );
  }
}