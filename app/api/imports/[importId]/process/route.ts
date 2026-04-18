import { NextResponse } from "next/server";
import { processImport } from "@/lib/imports/processImport";

export async function POST(
  request: Request,
  context: {
    params: Promise<{
      importId: string;
    }>;
  }
) {
  try {
    const { importId } = await context.params;

    const result = await processImport(importId);

    return NextResponse.json({
      success: true,
      result,
      message: `Import processed successfully. ${result.providerSummaryCount} provider summaries created. ${result.providerItemTotalCount} item totals created. 949 total: $${result.total949.toFixed(
        2
      )}.`,
    });
  } catch (error: any) {
    console.error("Import processing API error:", error);

    return NextResponse.json(
      { error: error?.message || "Import processing failed" },
      { status: 500 }
    );
  }
}