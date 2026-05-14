"use client"

import { useEffect, useState } from "react"

type DraftImage = {
  id: string
  publicUrl: string
  caption: string | null
  original_filename: string | null
  crop_x: number | null
  crop_y: number | null
  crop_zoom: number | null
  crop_rotation: number | null
  crop_aspect: string | null
  display_width_percent: number | null
  display_alignment: string | null
  display_page_break_before: boolean | null
}

type DraftImagePanelProps = {
  reportDraftId: string
}

async function normaliseImageFile(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file)

  const canvas = document.createElement("canvas")
  canvas.width = bitmap.width
  canvas.height = bitmap.height

  const ctx = canvas.getContext("2d")

  if (!ctx) {
    return file
  }

  ctx.drawImage(bitmap, 0, 0)

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/png", 0.95)
  })

  if (!blob) {
    return file
  }

  const safeName = file.name.replace(/\.[^/.]+$/, "")

  return new File([blob], `${safeName}.png`, {
    type: "image/png",
  })
}

export default function DraftImagePanel({
  reportDraftId,
}: DraftImagePanelProps) {
  const [images, setImages] = useState<DraftImage[]>([])
  const [uploading, setUploading] = useState(false)
  const [selectedImage, setSelectedImage] = useState<DraftImage | null>(null)

  const [captionText, setCaptionText] = useState("")
  const [cropX, setCropX] = useState(0)
  const [cropY, setCropY] = useState(0)
  const [cropZoom, setCropZoom] = useState(1)
  const [cropRotation, setCropRotation] = useState(0)
  const [cropAspect, setCropAspect] = useState("original")
  const [displayWidthPercent, setDisplayWidthPercent] = useState(60)
  const [displayAlignment, setDisplayAlignment] = useState("center")
  const [displayPageBreakBefore, setDisplayPageBreakBefore] = useState(false)

  async function loadImages() {
    const response = await fetch(
      `/api/report-writing/get-draft-images?reportDraftId=${reportDraftId}`
    )

    const data = await response.json()

    if (data.success) {
      setImages(data.images)
    }
  }

  useEffect(() => {
    loadImages()
  }, [reportDraftId])

  function openPreview(image: DraftImage) {
    setSelectedImage(image)
    setCaptionText(image.caption || "")
    setCropX(Number(image.crop_x ?? 0))
    setCropY(Number(image.crop_y ?? 0))
    setCropZoom(Number(image.crop_zoom ?? 1))
    setCropRotation(Number(image.crop_rotation ?? 0))
    setCropAspect(image.crop_aspect || "original")
    setDisplayWidthPercent(Number(image.display_width_percent ?? 60))
    setDisplayAlignment(image.display_alignment || "center")
    setDisplayPageBreakBefore(Boolean(image.display_page_break_before))
  }

  async function saveImageSettings() {
    if (!selectedImage) return

    const response = await fetch("/api/report-writing/update-draft-image", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        imageId: selectedImage.id,
        caption: captionText,
        cropX,
        cropY,
        cropZoom,
        cropRotation,
        cropAspect,
        displayWidthPercent,
        displayAlignment,
        displayPageBreakBefore,
      }),
    })

    const data = await response.json()

    if (!data.success) {
      alert(data.error || "Failed to save image settings.")
      return
    }

   await loadImages()
setSelectedImage(null)
  }

  async function uploadImage(file: File) {
    setUploading(true)

    try {
      const normalisedFile = await normaliseImageFile(file)

      const formData = new FormData()
      formData.append("file", normalisedFile)
      formData.append("reportDraftId", reportDraftId)

      const response = await fetch("/api/report-writing/upload-draft-image", {
        method: "POST",
        body: formData,
      })

      const data = await response.json()

      if (!data.success) {
        alert(data.error || "Upload failed.")
        return
      }

      await loadImages()
    } finally {
      setUploading(false)
    }
  }

  function getPreviewAspectClass() {
    if (cropAspect === "square") return "aspect-square"
    if (cropAspect === "landscape") return "aspect-[4/3]"
    if (cropAspect === "portrait") return "aspect-[3/4]"
    return "aspect-[4/3]"
  }

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Clinical Images / X-rays</h3>

        <label className="cursor-pointer rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white">
          {uploading ? "Uploading..." : "Upload Images"}

          <input
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={async (e) => {
              const files = Array.from(e.target.files || [])

              for (const file of files) {
                await uploadImage(file)
              }

              e.target.value = ""
            }}
          />
        </label>
      </div>

      {images.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-500">
          No images uploaded yet.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {images.map((image) => (
            <button
              key={image.id}
              type="button"
              onClick={() => openPreview(image)}
              className="overflow-hidden rounded-2xl border border-slate-200 bg-white text-left hover:border-blue-400"
            >
              <img
                src={image.publicUrl}
                alt={image.original_filename || "Clinical image"}
                className="h-64 w-full bg-black object-contain"
              />

              <div className="space-y-1 border-t border-slate-100 p-3">
                <div className="text-sm font-medium text-slate-700">
                  {image.original_filename}
                </div>

                <div className="text-xs text-slate-500">
                  {image.caption || "No caption yet"}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {selectedImage ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="max-h-[95vh] w-full max-w-6xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold">
                  Image Preview & Formatting
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Adjust how this image will appear in the final report PDF.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setSelectedImage(null)}
                className="rounded-xl border px-4 py-2 text-sm font-semibold text-slate-700"
              >
                Close
              </button>
            </div>

            <div className="mt-5 grid gap-6 lg:grid-cols-[1.4fr_0.9fr]">
              <div>
                <div
                  className={[
                    "relative mx-auto overflow-hidden rounded-2xl border bg-black",
                    getPreviewAspectClass(),
                  ].join(" ")}
                  style={{
                    width: `${displayWidthPercent}%`,
                  }}
                >
                  <img
                    src={selectedImage.publicUrl}
                    alt={selectedImage.original_filename || "Clinical image"}
                    className="absolute left-1/2 top-1/2 max-h-none max-w-none"
                    style={{
                      transform: `translate(-50%, -50%) translate(${cropX}px, ${cropY}px) scale(${cropZoom}) rotate(${cropRotation}deg)`,
                      width: "100%",
                      height: "100%",
                      objectFit: "contain",
                    }}
                  />
                </div>

                <p className="mt-3 text-center text-xs text-slate-500">
                  Preview only. The PDF generator will use these saved settings.
                </p>
              </div>

              <div className="space-y-4">
                <label className="block">
                  <div className="mb-2 text-sm font-semibold text-slate-700">
                    Caption
                  </div>

                  <textarea
                    className="h-24 w-full rounded-xl border border-slate-300 p-3"
                    placeholder="Example: OPG showing advanced periodontal bone loss around tooth 16."
                    value={captionText}
                    onChange={(e) => setCaptionText(e.target.value)}
                  />
                </label>

                <label className="block">
                  <div className="mb-2 text-sm font-semibold text-slate-700">
                    Crop shape
                  </div>

                  <select
                    className="w-full rounded-xl border border-slate-300 p-3"
                    value={cropAspect}
                    onChange={(e) => setCropAspect(e.target.value)}
                  >
                    <option value="original">Standard</option>
                    <option value="landscape">Landscape</option>
                    <option value="portrait">Portrait</option>
                    <option value="square">Square</option>
                  </select>
                </label>

                <label className="block">
                  <div className="mb-2 text-sm font-semibold text-slate-700">
                    Zoom: {cropZoom.toFixed(1)}x
                  </div>

                  <input
                    type="range"
                    min="0.5"
                    max="3"
                    step="0.1"
                    value={cropZoom}
                    onChange={(e) => setCropZoom(Number(e.target.value))}
                    className="w-full"
                  />
                </label>

                <label className="block">
                  <div className="mb-2 text-sm font-semibold text-slate-700">
                    Move left/right: {cropX}px
                  </div>

                  <input
                    type="range"
                    min="-250"
                    max="250"
                    step="5"
                    value={cropX}
                    onChange={(e) => setCropX(Number(e.target.value))}
                    className="w-full"
                  />
                </label>

                <label className="block">
                  <div className="mb-2 text-sm font-semibold text-slate-700">
                    Move up/down: {cropY}px
                  </div>

                  <input
                    type="range"
                    min="-250"
                    max="250"
                    step="5"
                    value={cropY}
                    onChange={(e) => setCropY(Number(e.target.value))}
                    className="w-full"
                  />
                </label>

                <label className="block">
                  <div className="mb-2 text-sm font-semibold text-slate-700">
                    Rotate: {cropRotation}°
                  </div>

                  <input
                    type="range"
                    min="-180"
                    max="180"
                    step="5"
                    value={cropRotation}
                    onChange={(e) => setCropRotation(Number(e.target.value))}
                    className="w-full"
                  />
                </label>

                <label className="block">
                  <div className="mb-2 text-sm font-semibold text-slate-700">
                    Report image width: {displayWidthPercent}%
                  </div>

                  <input
                    type="range"
                    min="30"
                    max="100"
                    step="5"
                    value={displayWidthPercent}
                    onChange={(e) =>
                      setDisplayWidthPercent(Number(e.target.value))
                    }
                    className="w-full"
                  />
                </label>

                <label className="block">
                  <div className="mb-2 text-sm font-semibold text-slate-700">
                    Alignment
                  </div>

                  <select
                    className="w-full rounded-xl border border-slate-300 p-3"
                    value={displayAlignment}
                    onChange={(e) => setDisplayAlignment(e.target.value)}
                  >
                    <option value="left">Left</option>
                    <option value="center">Centre</option>
                    <option value="right">Right</option>
                  </select>
                </label>

                <label className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={displayPageBreakBefore}
                    onChange={(e) =>
                      setDisplayPageBreakBefore(e.target.checked)
                    }
                  />

                  Start this image on a new PDF page
                </label>

                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={saveImageSettings}
                    className="rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white"
                  >
                    Save Image Settings
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setCropX(0)
                      setCropY(0)
                      setCropZoom(1)
                      setCropRotation(0)
                      setCropAspect("original")
                      setDisplayWidthPercent(60)
                      setDisplayAlignment("center")
                      setDisplayPageBreakBefore(false)
                    }}
                    className="rounded-xl border px-5 py-3 font-semibold text-slate-700"
                  >
                    Reset
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedImage(null)}
                    className="rounded-xl border px-5 py-3 font-semibold text-slate-700"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}