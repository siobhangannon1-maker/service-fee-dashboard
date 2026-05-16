"use client"

import { useRef, useState } from "react"

type ReportTypeOption = {
  value: string
  label: string
}

type SmartDictateResult = {
  patientFirstName: string
  patientLastName: string
  patientDob: string
  reportType: string
  clinicalNotes: string
  report: string
  dictatedText: string
}

type Props = {
  providerId: string
  reportTypes: ReportTypeOption[]
  selectedReportType: string
  onReportTypeChange: (value: string) => void
  onResult: (result: SmartDictateResult) => void
}

export default function SmartDictateBox({
  providerId,
  reportTypes,
  selectedReportType,
  onReportTypeChange,
  onResult,
}: Props) {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const [recording, setRecording] = useState(false)
  const [paused, setPaused] = useState(false)
  const [working, setWorking] = useState(false)
  const [manualText, setManualText] = useState("")

  async function transcribeAudio(blob: Blob) {
    const formData = new FormData()
    formData.append("file", blob, "smart-dictate.webm")

    const response = await fetch("/api/report-writing/transcribe-audio", {
      method: "POST",
      body: formData,
    })

    const data = await response.json()

    if (!data.success) {
      throw new Error(data.error || "Failed to transcribe audio.")
    }

    return data.text || data.transcript || ""
  }

  async function runSmartDictate(dictatedText: string) {
    if (!dictatedText.trim()) {
      alert("No dictation text found.")
      return
    }

    setWorking(true)

    try {
      const response = await fetch("/api/report-writing/smart-dictate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          providerId,
          dictatedText,
          reportType: selectedReportType,
        }),
      })

      const data = await response.json()

      if (!data.success) {
        alert(data.error || "Smart Dictate failed.")
        return
      }

      onResult(data)
    } finally {
      setWorking(false)
    }
  }

  async function startRecording() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })

    chunksRef.current = []

    const recorder = new MediaRecorder(stream)
    mediaRecorderRef.current = recorder

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data)
      }
    }

    recorder.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop())

      const blob = new Blob(chunksRef.current, {
        type: "audio/webm",
      })

      try {
        setWorking(true)
        const text = await transcribeAudio(blob)
        setManualText(text)
        await runSmartDictate(text)
      } catch (error) {
        alert(
          error instanceof Error
            ? error.message
            : "Failed to process dictation."
        )
      } finally {
        setWorking(false)
        setRecording(false)
        setPaused(false)
      }
    }

    recorder.start()
    setRecording(true)
    setPaused(false)
  }

  function pauseRecording() {
    const recorder = mediaRecorderRef.current

    if (recorder && recorder.state === "recording") {
      recorder.pause()
      setPaused(true)
    }
  }

  function resumeRecording() {
    const recorder = mediaRecorderRef.current

    if (recorder && recorder.state === "paused") {
      recorder.resume()
      setPaused(false)
    }
  }

  function stopRecording() {
    const recorder = mediaRecorderRef.current

    if (recorder && recorder.state !== "inactive") {
      recorder.stop()
    }
  }

  return (
    <div className="space-y-4 rounded-2xl border border-purple-200 bg-purple-50 p-5">
      <div>
        <h2 className="text-xl font-bold text-purple-950">Smart Dictate</h2>
        <p className="mt-1 text-sm text-purple-900">
          Select the report type, then dictate one natural instruction. The
          letter will use this provider&apos;s rules, templates, terminology and
          previous edit-learning.
        </p>
      </div>

      <label className="block">
        <div className="mb-2 text-sm font-semibold text-purple-950">
          Report type to generate
        </div>

        <select
          className="w-full rounded-xl border border-purple-200 bg-white p-3"
          value={selectedReportType}
          onChange={(e) => onReportTypeChange(e.target.value)}
        >
          {reportTypes.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-wrap gap-3">
        {!recording ? (
          <button
            type="button"
            onClick={startRecording}
            disabled={working}
            className="rounded-xl bg-purple-700 px-5 py-3 font-semibold text-white disabled:opacity-50"
          >
            Start Smart Dictate
          </button>
        ) : (
          <>
            {!paused ? (
              <button
                type="button"
                onClick={pauseRecording}
                className="rounded-xl bg-amber-500 px-5 py-3 font-semibold text-white"
              >
                Pause
              </button>
            ) : (
              <button
                type="button"
                onClick={resumeRecording}
                className="rounded-xl bg-green-600 px-5 py-3 font-semibold text-white"
              >
                Resume
              </button>
            )}

            <button
              type="button"
              onClick={stopRecording}
              className="rounded-xl bg-red-600 px-5 py-3 font-semibold text-white"
            >
              Stop and Generate
            </button>
          </>
        )}
      </div>

      <textarea
        className="h-32 w-full rounded-xl border border-purple-200 bg-white p-3"
        placeholder="Optional: type or edit Smart Dictate text here instead of recording."
        value={manualText}
        onChange={(e) => setManualText(e.target.value)}
      />

      <button
        type="button"
        onClick={() => runSmartDictate(manualText)}
        disabled={working || !manualText.trim()}
        className="rounded-xl bg-slate-950 px-5 py-3 font-semibold text-white disabled:opacity-50"
      >
        {working ? "Generating..." : "Generate From Typed Smart Dictate"}
      </button>
    </div>
  )
}