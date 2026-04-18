import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }

    const { data: row, error: fetchError } = await supabaseAdmin
      .from("xero_imports")
      .select("id, storage_path")
      .eq("id", id)
      .single();

    if (fetchError || !row) {
      return NextResponse.json(
        { error: fetchError?.message || "Import not found" },
        { status: 404 }
      );
    }

    if (row.storage_path) {
      const { error: storageError } = await supabaseAdmin.storage
        .from("xero-imports")
        .remove([row.storage_path]);

      if (storageError) {
        return NextResponse.json(
          { error: storageError.message },
          { status: 500 }
        );
      }
    }

    const { error: deleteError } = await supabaseAdmin
      .from("xero_imports")
      .delete()
      .eq("id", id);

    if (deleteError) {
      return NextResponse.json(
        { error: deleteError.message },
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