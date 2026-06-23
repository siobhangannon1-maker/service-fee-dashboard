import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function POST(req: Request) {
  try {
    const { imageId } = await req.json();

    if (!imageId) {
      return NextResponse.json(
        { success: false, error: "Missing imageId." },
        { status: 400 },
      );
    }

    const { data: image, error: findError } = await supabase
      .from("report_draft_images")
      .select("id, storage_path")
      .eq("id", imageId)
      .single();

    if (findError || !image) {
      return NextResponse.json(
        { success: false, error: "Image not found." },
        { status: 404 },
      );
    }

    if (image.storage_path) {
      const { error: storageError } = await supabase.storage
        .from("report-assets")
        .remove([image.storage_path]);

      if (storageError) {
        return NextResponse.json(
          { success: false, error: storageError.message },
          { status: 500 },
        );
      }
    }

    const { error: deleteError } = await supabase
      .from("report_draft_images")
      .delete()
      .eq("id", imageId);

    if (deleteError) {
      return NextResponse.json(
        { success: false, error: deleteError.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to delete image.",
      },
      { status: 500 },
    );
  }
}