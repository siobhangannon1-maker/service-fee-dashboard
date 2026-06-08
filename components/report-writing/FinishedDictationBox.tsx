"use client"

import { useEffect, useRef, useState } from "react"

type FinishedDictationBoxProps = {
  onStarted?: () => void
  onFinished: (text: string) => void
  disabled?: boolean
}

function formatDuration(seconds: number) {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
}

export default function FinishedDictationBox({
  onStarted,
  onFinished,
  disabled,
}: FinishedDictationBoxProps) {
  const recognitionRef = useRef<any>(null)
  const transcriptRef = useRef("")

  const [listening, setListening] = useState(false)
  const [supported, setSupported] = useState(true)
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition

    if (!SpeechRecognition) {
      setSupported(false)
      return
    }

    const recognition = new SpeechRecognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = "en-AU"

    recognition.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript
        if (event.results[i].isFinal) transcriptRef.current += transcript + " "
      }
    }

    recognition.onerror = (event: any) => {
      console.error("Speech recognition error:", event)
      setListening(false)
    }

    recognition.onend = () => {
      setListening(false)
      const finalText = transcriptRef.current.trim()
      if (finalText) onFinished(finalText)
    }

    recognitionRef.current = recognition
  }, [onFinished])

  useEffect(() => {
    if (!listening) return

    const interval = window.setInterval(() => {
      setSeconds((current) => current + 1)
    }, 1000)

    return () => window.clearInterval(interval)
  }, [listening])

  function startDictation() {
    if (!recognitionRef.current || disabled) return

    transcriptRef.current = ""
    setSeconds(0)

    try {
      recognitionRef.current.start()
      setListening(true)
      onStarted?.()
    } catch {
      // prevents double-start crash
    }
  }

  function stopDictation() {
    if (!recognitionRef.current) return
    recognitionRef.current.stop()
  }

  if (!supported) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Voice dictation is not supported in this browser. Try Google Chrome.
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={disabled}
          onClick={listening ? stopDictation : startDictation}
          className={[
            "rounded-xl px-5 py-3 font-semibold text-white disabled:opacity-50",
            listening ? "bg-red-600" : "bg-green-600",
          ].join(" ")}
        >
          {listening ? "Stop and Save Draft" : "Start Dictation"}
        </button>

        <div
          className={[
            "flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold",
            listening ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-600",
          ].join(" ")}
        >
          <span className={["h-3 w-3 rounded-full", listening ? "animate-pulse bg-red-600" : "bg-slate-400"].join(" ")} />
          <span>{listening ? "Recording" : "Ready"}</span>
          <span className="font-mono">{formatDuration(seconds)}</span>
        </div>
      </div>

      <p className="mt-3 text-sm text-slate-500">
        {listening
          ? "Recording. Text will appear and save as a draft after dictation is stopped."
          : "Dictated letter text will appear only after dictation finishes."}
      </p>
    </div>
  )
}
