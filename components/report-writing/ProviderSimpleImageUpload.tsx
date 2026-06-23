"use client";

import { useState } from "react";

type Props = {
  reportDraftId?: string | null;
  onCreateDraft?: () => Promise<any>;
};

export default function ProviderSimpleImageUpload({
  reportDraftId,
  onCreateDraft,
}: Props) {
  const [activeDraftId, setActiveDraftId] = useState(reportDraftId || "");
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");

  async function getDraftId() {
    if (activeDraftId) return activeDraftId;
    if (reportDraftId) {
      setActiveDraftId(reportDraftId);
      return reportDraftId;
    }

    if (!onCreateDraft) {
      throw new Error("Please create or open a draft before uploading images.");
    }

    setMessage("Creating draft...");
    const result = await onCreateDraft();

    const draftId =
  result?.id ||
  result?.draft?.id ||
  result?.data?.draft?.id ||
  result?.data?.id ||
  "";

    if (!draftId) {
      throw new Error("Draft was created, but no draft ID was returned.");
    }

    setActiveDraftId(draftId);
    return draftId;
  }

  async function uploadFile(file: File) {
    setUploading(true);
    setMessage("");

    try {
      const draftId = await getDraftId();

      const formData = new FormData();
      formData.append("file", file);
      formData.append("reportDraftId", draftId);

      const response = await fetch("/api/report-writing/upload-draft-image", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Image upload failed.");
      }

      setMessage("Image uploaded.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Image upload failed."
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Add Image</h3>
          <p className="mt-1 text-xs text-slate-500">
            Optional: upload clinical photos or x-rays.
          </p>
        </div>

        <label
          className={[
            "cursor-pointer rounded-xl px-4 py-2 text-sm font-semibold text-white",
            uploading ? "bg-slate-400" : "bg-slate-950 hover:bg-slate-800",
          ].join(" ")}
        >
          {uploading ? "Uploading..." : "Upload images"}

          <input
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            disabled={uploading}
            onChange={async (event) => {
              const files = Array.from(event.target.files || []);

              for (const file of files) {
                await uploadFile(file);
              }

              event.target.value = "";
            }}
          />
        </label>
      </div>

      {message ? (
        <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
          {message}
        </div>
      ) : null}
    </section>
  );
}