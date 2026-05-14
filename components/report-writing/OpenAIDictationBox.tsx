"use client"

import { useRef, useState } from "react"

type OpenAIDictationBoxProps = {
  disabled?: boolean
  onFinished: (text: string) => void
}

export default function OpenAIDictationBox({
  disabled,
  onFinished,
}: OpenAIDictationBoxProps) {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const [recording, setRecording] = useState(false)
  const [paused, setPaused] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [message, setMessage] = useState("")

  async function startRecording() {
    if (disabled) return

    setMessage("")
    chunksRef.current = []

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
    })

    streamRef.current = stream

    const recorder = new MediaRecorder(stream, {
      mimeType: "audio/webm",
    })

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data)
      }
    }

    recorder.onstop = async () => {
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null

      const audioBlob = new Blob(chunksRef.current, {
        type: "audio/webm",
      })

      await transcribeAudio(audioBlob)
    }

    mediaRecorderRef.current = recorder
    recorder.start()

    setRecording(true)
    setPaused(false)
    setMessage("Recording...")
  }

  function pauseRecording() {
    if (!mediaRecorderRef.current) return

    if (mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.pause()
      setPaused(true)
      setMessage("Paused. Click Resume to continue.")
    }
  }

  function resumeRecording() {
    if (!mediaRecorderRef.current) return

    if (mediaRecorderRef.current.state === "paused") {
      mediaRecorderRef.current.resume()
      setPaused(false)
      setMessage("Recording...")
    }
  }

  function stopRecording() {
    if (!mediaRecorderRef.current) return

    mediaRecorderRef.current.stop()
    setRecording(false)
    setPaused(false)
    setProcessing(true)
    setMessage("Transcribing...")
  }

async function transcribeAudio(audioBlob: Blob) {
  try {
    if (audioBlob.size === 0) {
      alert("No audio was recorded. Please try again.")
      return
    }

    const formData = new FormData()
    formData.append("audio", audioBlob, "dictation.webm")

    const response = await fetch("/api/report-writing/transcribe", {
      method: "POST",
      body: formData,
    })

    const responseText = await response.text()

    let data: any = {}

    try {
      data = JSON.parse(responseText)
    } catch {
      console.error("Non-JSON transcription response:", responseText)
      alert(
        `Transcription failed with non-JSON response. Status: ${response.status}`
      )
      return
    }

    if (!response.ok || !data.success) {
      console.error("Transcription API error:", data)
      alert(
        data.error ||
          `Failed to transcribe. Status: ${response.status}`
      )
      return
    }

    onFinished(data.text)
    setMessage("Transcription complete.")
  } catch (error) {
    console.error("Dictation upload/transcription error:", error)
    alert("Error transcribing audio. Check the browser console and terminal.")
  } finally {
    setProcessing(false)
  }
}

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-3">
        {!recording ? (
          <button
            type="button"
            disabled={disabled || processing}
            onClick={startRecording}
            className="rounded-xl bg-green-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
          >
            {processing ? "Transcribing..." : "Start Dictation"}
          </button>
        ) : null}

        {recording && !paused ? (
          <button
            type="button"
            onClick={pauseRecording}
            className="rounded-xl bg-amber-500 px-5 py-3 font-semibold text-white"
          >
            Pause
          </button>
        ) : null}

        {recording && paused ? (
          <button
            type="button"
            onClick={resumeRecording}
            className="rounded-xl bg-green-600 px-5 py-3 font-semibold text-white"
          >
            Resume
          </button>
        ) : null}

        {recording ? (
          <button
            type="button"
            onClick={stopRecording}
            className="rounded-xl bg-red-600 px-5 py-3 font-semibold text-white"
          >
            Finish Dictation
          </button>
        ) : null}

        <div className="text-sm text-slate-500">
          {disabled
            ? "Enter patient first and last name before dictating."
            : "Text appears only after you finish dictation."}
        </div>
      </div>

      {message ? (
        <div className="mt-3 text-sm text-slate-500">{message}</div>
      ) : null}
    </div>
  )
}