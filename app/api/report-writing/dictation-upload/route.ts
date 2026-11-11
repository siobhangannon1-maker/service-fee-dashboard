import { NextResponse } from "next/server";
import { ApiAuthorizationError } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { DictationUploadError } from "@/lib/report-writing/dictation-upload-contract";
import {
  createAudioReference,
  signAudioReference,
  verifyAudioReference,
} from "@/lib/report-writing/dictation-upload-token";
import {
  authorisedDictationContext,
  boundedJson,
  DICTATION_BUCKET,
  sameOrigin,
} from "@/lib/report-writing/dictation-upload-server";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const input = await boundedJson(req),
      actor = await authorisedDictationContext(input.context),
      secret = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    const reference = input.reference
      ? verifyAudioReference(
          input.reference,
          actor.ownerId,
          actor.context,
          secret,
        )
      : createAudioReference(
          actor.ownerId,
          actor.context,
          Number(input.size),
          String(input.mime || ""),
          String(input.sha256 || ""),
        );
    const result = await supabaseAdmin.storage
      .from(DICTATION_BUCKET)
      .createSignedUploadUrl(reference.path, { upsert: false });
    if (result.error)
      throw new DictationUploadError(
        "UPLOAD_UNAVAILABLE",
        "Could not prepare the audio upload. Keep this page open and retry, or download the recording.",
        503,
      );
    return NextResponse.json(
      {
        success: true,
        reference: signAudioReference(reference, secret),
        signedUrl: result.data.signedUrl,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const known =
      error instanceof DictationUploadError ||
      error instanceof ApiAuthorizationError;
    return NextResponse.json(
      {
        success: false,
        code:
          error instanceof DictationUploadError
            ? error.code
            : "UPLOAD_UNAVAILABLE",
        error: known
          ? error.message
          : "Could not prepare the audio upload. Your local recording has been kept.",
      },
      {
        status: known ? error.status : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
