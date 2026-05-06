// app/api/ai-reception/get-file-url/route.ts

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

const BUCKET_NAME = "ai-reception";

function cleanFilePath(filePath: string) {
  let cleaned = filePath.trim();

  if (cleaned.startsWith(`${BUCKET_NAME}/`)) {
    cleaned = cleaned.slice(BUCKET_NAME.length + 1);
  }

  return cleaned.replace(/^\/+/, "");
}

export async function POST(req: Request) {
  try {
    await requireRole(["super_admin", "admin", "practice_manager"]);

    const { filePath } = await req.json();

    if (!filePath || typeof filePath !== "string") {
      return NextResponse.json(
        { error: "Missing filePath" },
        { status: 400 }
      );
    }

    const cleanedPath = cleanFilePath(filePath);

    const { data, error } = await supabaseAdmin.storage
      .from(BUCKET_NAME)
      .createSignedUrl(cleanedPath, 60 * 5);

    if (error || !data?.signedUrl) {
      console.error("Failed to create signed file URL", {
        originalPath: filePath,
        cleanedPath,
        error,
      });

      return NextResponse.json(
        { error: error?.message || "Failed to create signed URL" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      url: data.signedUrl,
      path: cleanedPath,
    });
  } catch (err) {
    console.error("get-file-url error", err);

    return NextResponse.json(
      { error: "Failed to get file URL" },
      { status: 500 }
    );
  }
}