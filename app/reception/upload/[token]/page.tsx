"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function PatientUploadPage({
  params,
}: {
  params: { token: string };
}) {
  const [uploading, setUploading] = useState(false);
  const [done, setDone] = useState(false);
  const [message, setMessage] = useState("");

  async function uploadFile(file: File) {
    setUploading(true);
    setMessage("");

    try {
      const supabase = createClient();

      const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
      const storagePath = `patient-upload/${params.token}/${Date.now()}-${safeName}`;

      const { error: uploadError } = await supabase.storage
        .from("reception-message-attachments")
        .upload(storagePath, file, {
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) {
        setMessage(uploadError.message);
        setUploading(false);
        return;
      }

      const { data } = supabase.storage
        .from("reception-message-attachments")
        .getPublicUrl(storagePath);

      const response = await fetch("/api/reception/patient-upload", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token: params.token,
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size,
          storagePath,
          publicUrl: data.publicUrl,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setMessage(result.error || "Could not save upload.");
        setUploading(false);
        return;
      }

      setDone(true);
      setMessage("Thank you. Your file has been uploaded.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload failed.");
    }

    setUploading(false);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-slate-900">
            Upload a file
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Focus Dental Specialists
          </p>
        </div>

        {done ? (
          <div className="rounded-2xl bg-emerald-50 p-5 text-center text-sm text-emerald-700">
            {message}
          </div>
        ) : (
          <>
            <label className="block cursor-pointer rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-8 text-center hover:bg-slate-100">
              <div className="text-4xl">📎</div>
              <div className="mt-3 text-sm font-semibold text-slate-800">
                Tap to choose a photo, PDF, or document
              </div>
              <div className="mt-1 text-xs text-slate-500">
                Please upload files smaller than 10MB.
              </div>

              <input
                type="file"
                className="hidden"
                accept="image/*,.pdf,.doc,.docx"
                disabled={uploading}
                onChange={(event) => {
                  const file = event.target.files?.[0];

                  if (!file) return;

                  if (file.size > 10 * 1024 * 1024) {
                    setMessage("Please choose a file smaller than 10MB.");
                    return;
                  }

                  uploadFile(file);
                }}
              />
            </label>

            {uploading && (
              <div className="mt-4 text-center text-sm text-slate-500">
                Uploading...
              </div>
            )}

            {message && (
              <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">
                {message}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}