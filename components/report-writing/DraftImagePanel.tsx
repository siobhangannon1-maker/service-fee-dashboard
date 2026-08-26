"use client"

import { useCallback, useEffect, useState } from "react"
import Cropper from "react-easy-crop"

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
  crop_area_x: number | null
  crop_area_y: number | null
  crop_area_width: number | null
  crop_area_height: number | null
  display_width_percent: number | null
  display_alignment: string | null
  display_page_break_before: boolean | null
}

type Props = {
  reportDraftId: string
}

type CropAreaPixels = {
  x: number
  y: number
  width: number
  height: number
}

const IMAGE_SIZE_PRESETS = [
  {
    label: "Small",
    value: 35,
    description: "about 56 mm wide",
    helper: "Good for small intraoral photos.",
  },
  {
    label: "Medium",
    value: 55,
    description: "about 88 mm wide",
    helper: "Best default size for most clinical photos.",
  },
  {
    label: "Large",
    value: 75,
    description: "about 119 mm wide",
    helper: "Good when the image needs more detail.",
  },
  {
    label: "Full width",
    value: 100,
    description: "about 159 mm wide",
    helper: "Best for OPGs, CBCT screenshots, charts, or wide images.",
  },
]

function getApproxWidthMm(percent: number) {
  return Math.round(159.2 * (percent / 100))
}

function getPresetLabel(percent: number) {
  const preset = IMAGE_SIZE_PRESETS.find((item) => item.value === percent)

  if (preset) {
    return `${preset.label} — ${preset.description}`
  }

  return `Custom — about ${getApproxWidthMm(percent)} mm wide`
}

async function normaliseImageFile(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file)

  const maxDimension = 1800
  const scale = Math.min(
    1,
    maxDimension / Math.max(bitmap.width, bitmap.height)
  )

  const canvas = document.createElement("canvas")
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)

  const ctx = canvas.getContext("2d")
  if (!ctx) return file

  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", 0.82)
  })

  if (!blob) return file

  const safeName = file.name.replace(/\.[^/.]+$/, "")

  return new File([blob], `${safeName}.jpg`, {
    type: "image/jpeg",
  })
}

function formatFileSize(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function DraftImagePanel({ reportDraftId }: Props) {
  const [images, setImages] = useState<DraftImage[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadMessage, setUploadMessage] = useState("")
  const [uploadError, setUploadError] = useState("")
  const [selectedImage, setSelectedImage] = useState<DraftImage | null>(null)

  const [captionText, setCaptionText] = useState("")
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [cropZoom, setCropZoom] = useState(1)
  const [cropRotation, setCropRotation] = useState(0)
  const [cropAspect, setCropAspect] = useState("landscape")
  const [cropAreaPixels, setCropAreaPixels] =
    useState<CropAreaPixels | null>(null)

  const [displayWidthPercent, setDisplayWidthPercent] = useState(55)
  const [displayAlignment, setDisplayAlignment] = useState("center")
  const [displayPageBreakBefore, setDisplayPageBreakBefore] = useState(false)

  async function loadImages() {
    if (!reportDraftId) return

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

  function getAspectNumber() {
    if (cropAspect === "square") return 1
    if (cropAspect === "portrait") return 3 / 4
    return 16 / 9
  }

  function openPreview(image: DraftImage) {
    setSelectedImage(image)
    setCaptionText(image.caption || "")

    setCrop({ x: Number(image.crop_x ?? 0), y: Number(image.crop_y ?? 0) })
    setCropZoom(Number(image.crop_zoom ?? 1))
    setCropRotation(Number(image.crop_rotation ?? 0))
    setCropAspect(image.crop_aspect || "landscape")

    if (
      image.crop_area_x !== null &&
      image.crop_area_y !== null &&
      image.crop_area_width !== null &&
      image.crop_area_height !== null
    ) {
      setCropAreaPixels({
        x: Number(image.crop_area_x),
        y: Number(image.crop_area_y),
        width: Number(image.crop_area_width),
        height: Number(image.crop_area_height),
      })
    } else {
      setCropAreaPixels(null)
    }

    setDisplayWidthPercent(Number(image.display_width_percent ?? 60))
    setDisplayAlignment(image.display_alignment || "center")
    setDisplayPageBreakBefore(Boolean(image.display_page_break_before))
  }

  const onCropComplete = useCallback(
    (_croppedArea: unknown, croppedAreaPixels: CropAreaPixels) => {
      setCropAreaPixels(croppedAreaPixels)
    },
    []
  )

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
        cropX: crop.x,
        cropY: crop.y,
        cropZoom,
        cropRotation,
        cropAspect,
        cropAreaX: cropAreaPixels?.x ?? null,
        cropAreaY: cropAreaPixels?.y ?? null,
        cropAreaWidth: cropAreaPixels?.width ?? null,
        cropAreaHeight: cropAreaPixels?.height ?? null,
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

  async function deleteSelectedImage() {
    if (!selectedImage) return

    const confirmed = confirm("Delete this image from the report?")
    if (!confirmed) return

    const response = await fetch("/api/report-writing/delete-draft-image", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        imageId: selectedImage.id,
      }),
    })

    const data = await response.json()

    if (!data.success) {
      alert(data.error || "Failed to delete image.")
      return
    }

    setSelectedImage(null)
    await loadImages()
  }

  async function uploadImage(file: File) {
    setUploading(true)
    setUploadError("")
    setUploadMessage(`Preparing ${file.name}...`)

    try {
      const normalisedFile = await normaliseImageFile(file)

      const maxUploadSize = 4 * 1024 * 1024

      if (normalisedFile.size > maxUploadSize) {
        const message = `${file.name} is still too large after compression (${formatFileSize(
          normalisedFile.size
        )}). Please use a smaller image or screenshot.`
        setUploadError(message)
        alert(message)
        return
      }

      setUploadMessage(
        `Uploading ${normalisedFile.name} (${formatFileSize(
          normalisedFile.size
        )})...`
      )

      const formData = new FormData()
      formData.append("file", normalisedFile)
      formData.append("reportDraftId", reportDraftId)

      const response = await fetch("/api/report-writing/upload-draft-image", {
        method: "POST",
        body: formData,
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok || !data.success) {
        const message =
          data.error ||
          data.message ||
          `Upload failed. Server returned ${response.status}.`

        setUploadError(message)
        alert(message)
        return
      }

      setUploadMessage("Image uploaded successfully.")
      await loadImages()
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Image upload failed."

      console.error("Image upload failed:", error)
      setUploadError(message)
      alert(message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold">Clinical Images / X-rays</h3>
          <p className="mt-1 text-xs text-slate-500">
            Upload images, then click each image to crop, caption, and choose its final PDF size.
          </p>
        </div>

        <label
          className={[
            "cursor-pointer rounded-xl px-4 py-2 text-sm font-semibold text-white",
            uploading ? "bg-slate-500" : "bg-slate-950",
          ].join(" ")}
        >
          {uploading ? "Uploading..." : "Upload Images"}

          <input
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            disabled={uploading}
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

      {uploadMessage ? (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
          {uploadMessage}
        </div>
      ) : null}

      {uploadError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {uploadError}
        </div>
      ) : null}

      {images.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-500">
          No images uploaded yet.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {images.map((image, index) => {
            const imageNumber = index + 1
            const savedWidth = Number(image.display_width_percent ?? 60)

            return (
              <button
                key={image.id}
                type="button"
                onClick={() => openPreview(image)}
                className="overflow-hidden rounded-2xl border border-slate-200 bg-white text-left hover:border-blue-400"
              >
                <div className="relative">
                  <img
                    src={image.publicUrl}
                    alt={image.original_filename || "Clinical image"}
                    className="h-64 w-full bg-black object-contain"
                  />

                  <div className="absolute left-3 top-3 rounded-full bg-white/95 px-3 py-1 text-xs font-bold text-slate-900 shadow">
                    Image {imageNumber}
                  </div>
                </div>

                <div className="space-y-1 border-t border-slate-100 p-3">
                  <div className="text-sm font-medium text-slate-700">
                    {image.original_filename}
                  </div>

                  <div className="text-xs text-slate-500">
                    {image.caption || "No caption yet"}
                  </div>

                  <div className="mt-2 rounded-lg bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-800">
                    PDF size: {getPresetLabel(savedWidth)}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {selectedImage ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="max-h-[95vh] w-full max-w-6xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold">
                  Image Crop & Formatting
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Drag the crop box corners/edges to control exactly what appears
                  in the PDF.
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
                <div className="mb-3 rounded-2xl border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900">
                  <div className="font-bold">Approximate final PDF size</div>
                  <div className="mt-1">
                    {displayWidthPercent}% width ≈{" "}
                    <span className="font-bold">
                      {getApproxWidthMm(displayWidthPercent)} mm wide
                    </span>
                    . Height depends on the crop shape and image proportions.
                  </div>
                </div>

                <div className="relative h-[520px] overflow-hidden rounded-2xl bg-black">
                  <Cropper
                    image={selectedImage.publicUrl}
                    crop={crop}
                    zoom={cropZoom}
                    rotation={cropRotation}
                    aspect={getAspectNumber()}
                    onCropChange={setCrop}
                    onCropComplete={onCropComplete}
                    onZoomChange={setCropZoom}
                    onRotationChange={setCropRotation}
                    cropShape="rect"
                    showGrid
                    objectFit="contain"
                  />
                </div>

                <p className="mt-3 text-center text-xs text-slate-500">
                  Drag the image to position it inside the fixed crop frame. Rotate
                  and zoom affect the image only; the saved frame keeps the selected shape.
                </p>
              </div>

              <div className="space-y-4">
                <label className="block">
                  <div className="mb-2 text-sm font-semibold text-slate-700">
                    Caption
                  </div>

                  <textarea
                    className="h-24 w-full rounded-xl border border-slate-300 p-3"
                    placeholder="Example: Pre operative image"
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
                    min="0.25"
                    max="5"
                    step="0.1"
                    value={cropZoom}
                    onChange={(e) => setCropZoom(Number(e.target.value))}
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
                    step="1"
                    value={cropRotation}
                    onChange={(e) => setCropRotation(Number(e.target.value))}
                    className="w-full"
                  />

                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setCropRotation((current) =>
                          Math.max(-180, Math.min(180, current - 90))
                        )
                      }
                      className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Rotate left 90°
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        setCropRotation((current) =>
                          Math.max(-180, Math.min(180, current + 90))
                        )
                      }
                      className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Rotate right 90°
                    </button>

                    <button
                      type="button"
                      onClick={() => setCropRotation(0)}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Straighten
                    </button>
                  </div>

                  <p className="mt-2 text-xs text-slate-500">
                    Use the slider for small head-tilt corrections. The crop frame
                    remains landscape, portrait, or square while the image rotates
                    underneath it.
                  </p>
                </label>

                <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
                  <div className="text-sm font-bold text-blue-950">
                    Final PDF image size
                  </div>
                  <div className="mt-1 text-xs text-blue-800">
                    Choose a simple size. Medium is usually best for letters.
                  </div>

                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {IMAGE_SIZE_PRESETS.map((preset) => {
                      const selected = displayWidthPercent === preset.value

                      return (
                        <button
                          key={preset.value}
                          type="button"
                          onClick={() => setDisplayWidthPercent(preset.value)}
                          className={[
                            "rounded-xl border p-3 text-left text-sm transition",
                            selected
                              ? "border-blue-600 bg-white text-blue-950 ring-2 ring-blue-100"
                              : "border-blue-100 bg-white/70 text-slate-700 hover:bg-white",
                          ].join(" ")}
                        >
                          <div className="font-bold">{preset.label}</div>
                          <div className="mt-1 text-xs">
                            {preset.description}
                          </div>
                          <div className="mt-1 text-[11px] text-slate-500">
                            {preset.helper}
                          </div>
                        </button>
                      )
                    })}
                  </div>

                  <label className="mt-4 block">
                    <div className="mb-2 text-xs font-semibold text-blue-900">
                      Custom size: {displayWidthPercent}% ≈{" "}
                      {getApproxWidthMm(displayWidthPercent)} mm wide
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
                </div>

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
                      setCrop({ x: 0, y: 0 })
                      setCropZoom(1)
                      setCropRotation(0)
                      setCropAspect("landscape")
                      setCropAreaPixels(null)
                      setDisplayWidthPercent(55)
                      setDisplayAlignment("center")
                      setDisplayPageBreakBefore(false)
                    }}
                    className="rounded-xl border px-5 py-3 font-semibold text-slate-700"
                  >
                    Reset
                  </button>

                  <button
                    type="button"
                    onClick={deleteSelectedImage}
                    className="rounded-xl bg-red-600 px-5 py-3 font-semibold text-white"
                  >
                    Delete Image
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