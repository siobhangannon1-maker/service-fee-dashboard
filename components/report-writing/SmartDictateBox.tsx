"use client"

import { useEffect, useRef, useState } from "react"

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
  patientFirstName: string
  patientLastName: string
  patientDob: string
  disabled?: boolean
  reportTypes: ReportTypeOption[]
  selectedReportType: string
  onReportTypeChange: (value: string) => void
  onResult: (result: SmartDictateResult) => void
}

function formatDuration(seconds: number) {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
}

async function readJsonSafely(response: Response, label: string) {
  const text = await response.text()

  if (!text.trim()) return { success: false, error: `${label} returned an empty response.` }

  try {
    return JSON.parse(text)
  } catch {
    console.error(`${label} non-JSON response:`, text.slice(0, 1000))
    return {
      success: false,
      error: `${label} returned a web page instead of JSON. Status: ${response.status}.`,
    }
  }
}

export default function SmartDictateBox({
  providerId,
  patientFirstName,
  patientLastName,
  patientDob,
  disabled = false,
  reportTypes,
  selectedReportType,
  onReportTypeChange,
  onResult,
}: Props) {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)

  const [recording, setRecording] = useState(false)
  const [paused, setPaused] = useState(false)
  const [working, setWorking] = useState(false)
  const [manualText, setManualText] = useState("")
  const [seconds, setSeconds] = useState(0)

  const patientName = `${patientFirstName} ${patientLastName}`.trim()

  useEffect(() => {
    if (!recording || paused) return

    const interval = window.setInterval(() => {
      setSeconds((current) => current + 1)
    }, 1000)

    return () => window.clearInterval(interval)
  }, [recording, paused])

  async function transcribeAudio(blob: Blob) {
    const formData = new FormData()
    formData.append("file", blob, "smart-dictate.webm")

    const response = await fetch("/api/report-writing/transcribe-audio", {
      method: "POST",
      body: formData,
    })

    const data = await readJsonSafely(response, "Transcribe audio API")

    if (!response.ok || !data.success) throw new Error(data.error || "Failed to transcribe audio.")

    return data.text || data.transcript || ""
  }

  async function runSmartDictate(dictatedText: string) {
    if (disabled || !patientFirstName.trim() || !patientLastName.trim()) {
      alert("Enter the patient first name and last name before using Smart Dictate.")
      return
    }

    if (!dictatedText.trim()) {
      alert("No dictation text found.")
      return
    }

    setWorking(true)

    try {
      const response = await fetch("/api/report-writing/smart-dictate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId,
          patientFirstName,
          patientLastName,
          patientName,
          patientDob,
          dictatedText,
          reportType: selectedReportType,
        }),
      })

      const data = await readJsonSafely(response, "Smart Dictate API")

      if (!response.ok || !data.success) {
        alert(data.error || "Smart Dictate failed.")
        return
      }

      onResult(data)
    } catch (error) {
      alert(error instanceof Error ? error.message : "Smart Dictate failed.")
    } finally {
      setWorking(false)
    }
  }

  async function startRecording() {
    if (disabled || !patientFirstName.trim() || !patientLastName.trim()) {
      alert("Enter the patient first name and last name before dictating.")
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      chunksRef.current = []
      setSeconds(0)

      const recorder = new MediaRecorder(stream)
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }

      recorder.onstop = async () => {
        streamRef.current?.getTracks().forEach((track) => track.stop())
        streamRef.current = null

        const blob = new Blob(chunksRef.current, { type: "audio/webm" })

        try {
          setWorking(true)
          const text = await transcribeAudio(blob)
          setManualText(text)
          await runSmartDictate(text)
        } catch (error) {
          alert(error instanceof Error ? error.message : "Failed to process dictation.")
        } finally {
          setWorking(false)
          setRecording(false)
          setPaused(false)
        }
      }

      recorder.start()
      setRecording(true)
      setPaused(false)
    } catch (error) {
      console.error("Could not start Smart Dictate:", error)
      alert("Could not access the microphone. Please check browser permissions.")
    }
  }

  function pauseRecording() {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.pause()
      setPaused(true)
    }
  }

  function resumeRecording() {
    if (mediaRecorderRef.current?.state === "paused") {
      mediaRecorderRef.current.resume()
      setPaused(false)
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop()
      setWorking(true)
    }
  }

  const statusLabel = recording ? (paused ? "Paused" : "Recording") : working ? "Generating" : "Ready"

  return (
    <div className="space-y-4 rounded-2xl border border-purple-200 bg-purple-50 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-purple-950">Smart Dictate</h2>
          <p className="mt-1 text-sm text-purple-900">
            Enter the patient first and last name first, then dictate or type the instruction.
          </p>
        </div>

        <div
          className={[
            "flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold",
            recording && !paused
              ? "bg-red-50 text-red-700"
              : paused
                ? "bg-amber-50 text-amber-700"
                : "bg-white text-slate-600",
          ].join(" ")}
        >
          <span
            className={[
              "h-3 w-3 rounded-full",
              recording && !paused ? "animate-pulse bg-red-600" : paused ? "bg-amber-500" : "bg-slate-400",
            ].join(" ")}
          />
          <span>{statusLabel}</span>
          <span className="font-mono">{formatDuration(seconds)}</span>
        </div>
      </div>

      {disabled ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Patient first name and last name are required before Smart Dictate.
        </div>
      ) : null}

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

      <div className="flex flex-wrap gap-3">
        {!recording ? (
          <button
            type="button"
            onClick={startRecording}
            disabled={working || disabled}
            className="rounded-xl bg-purple-700 px-5 py-3 font-semibold text-white disabled:opacity-50"
          >
            {working ? "Generating..." : "Start Smart Dictate"}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={paused ? resumeRecording : pauseRecording}
              className="rounded-xl bg-amber-500 px-5 py-3 font-semibold text-white"
            >
              {paused ? "Resume" : "Pause"}
            </button>

            <button
              type="button"
              onClick={stopRecording}
              className="rounded-xl bg-red-600 px-5 py-3 font-semibold text-white"
            >
              Stop, Generate and Save Draft
            </button>
          </>
        )}
      </div>

      <textarea
        className="h-32 w-full rounded-xl border border-purple-200 bg-white p-3"
        placeholder="Optional: type Smart Dictate text here instead of recording."
        value={manualText}
        onChange={(e) => setManualText(e.target.value)}
      />

      <button
        type="button"
        onClick={() => runSmartDictate(manualText)}
        disabled={working || disabled || !manualText.trim()}
        className="rounded-xl bg-slate-950 px-5 py-3 font-semibold text-white disabled:opacity-50"
      >
        {working ? "Generating..." : "Generate From Typed Smart Dictate"}
      </button>
    </div>
  )
}
