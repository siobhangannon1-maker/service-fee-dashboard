import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }

    const { data: importRow, error: fetchError } = await supabaseAdmin
      .from("afterpay_imports")
      .select("id, storage_path, imported_entry_id")
      .eq("id", id)
      .single();

    if (fetchError || !importRow) {
      return NextResponse.json(
        { error: fetchError?.message || "Import not found" },
        { status: 404 }
      );
    }

    if (importRow.imported_entry_id) {
      const { error: deleteEntryError } = await supabaseAdmin
        .from("billing_detail_entries")
        .delete()
        .eq("id", importRow.imported_entry_id);

      if (deleteEntryError) {
        return NextResponse.json(
          { error: deleteEntryError.message },
          { status: 500 }
        );
      }
    }

    if (importRow.storage_path) {
      const { error: storageError } = await supabaseAdmin.storage
        .from("afterpay-imports")
        .remove([importRow.storage_path]);

      if (storageError) {
        return NextResponse.json(
          { error: storageError.message },
          { status: 500 }
        );
      }
    }

    const { error: deleteImportError } = await supabaseAdmin
      .from("afterpay_imports")
      .delete()
      .eq("id", id);

    if (deleteImportError) {
      return NextResponse.json(
        { error: deleteImportError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to delete import" },
      { status: 500 }
    );
  }
}