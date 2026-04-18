import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function PATCH(
  request: Request,
  context: {
    params: Promise<{
      importId: string;
    }>;
  }
) {
  try {
    const { importId } = await context.params;

    const { data: importRow, error: importFetchError } = await supabaseAdmin
      .from("imports")
      .select("*")
      .eq("id", importId)
      .single();

    if (importFetchError || !importRow) {
      return NextResponse.json(
        { error: importFetchError?.message || "Import not found" },
        { status: 404 }
      );
    }

    if (importRow.billing_period_id) {
      const { error: unlinkBillingError } = await supabaseAdmin
        .from("billing_period_imports")
        .delete()
        .eq("billing_period_id", importRow.billing_period_id);

      if (unlinkBillingError) {
        return NextResponse.json(
          { error: unlinkBillingError.message },
          { status: 500 }
        );
      }
    }

    const { error: updateImportError } = await supabaseAdmin
      .from("imports")
      .update({ billing_period_id: null })
      .eq("id", importId);

    if (updateImportError) {
      return NextResponse.json(
        { error: updateImportError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Import unlinked from billing month.",
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to unlink import" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  context: {
    params: Promise<{
      importId: string;
    }>;
  }
) {
  try {
    const { importId } = await context.params;

    const { data: importRow, error: importFetchError } = await supabaseAdmin
      .from("imports")
      .select("*")
      .eq("id", importId)
      .single();

    if (importFetchError || !importRow) {
      return NextResponse.json(
        { error: importFetchError?.message || "Import not found" },
        { status: 404 }
      );
    }

    if (importRow.billing_period_id) {
      await supabaseAdmin
        .from("billing_period_imports")
        .delete()
        .eq("billing_period_id", importRow.billing_period_id);
    }

    await supabaseAdmin
      .from("provider_item_totals")
      .delete()
      .eq("import_id", importId);

    await supabaseAdmin
      .from("provider_monthly_summaries")
      .delete()
      .eq("import_id", importId);

    await supabaseAdmin
      .from("import_rows_normalized")
      .delete()
      .eq("import_id", importId);

    await supabaseAdmin
      .from("import_rows_raw")
      .delete()
      .eq("import_id", importId);

    const { error: deleteImportError } = await supabaseAdmin
      .from("imports")
      .delete()
      .eq("id", importId);

    if (deleteImportError) {
      return NextResponse.json(
        { error: deleteImportError.message },
        { status: 500 }
      );
    }

    if (importRow.storage_path) {
      await supabaseAdmin.storage.from("imports").remove([importRow.storage_path]);
    }

    return NextResponse.json({
      success: true,
      message: "Import deleted successfully.",
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to delete import" },
      { status: 500 }
    );
  }
}