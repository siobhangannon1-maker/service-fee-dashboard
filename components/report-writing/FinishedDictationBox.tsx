"use client"

import { useEffect, useRef, useState } from "react"

type FinishedDictationBoxProps = {
  onFinished: (text: string) => void
  disabled?: boolean
}

export default function FinishedDictationBox({
  onFinished,
  disabled,
}: FinishedDictationBoxProps) {
  const recognitionRef = useRef<any>(null)
  const transcriptRef = useRef("")

  const [listening, setListening] = useState(false)
  const [supported, setSupported] = useState(true)

  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition

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

        if (event.results[i].isFinal) {
          transcriptRef.current += transcript + " "
        }
      }
    }

    recognition.onerror = (event: any) => {
      console.error("Speech recognition error:", event)
      setListening(false)
    }

    recognition.onend = () => {
      setListening(false)

      const finalText = transcriptRef.current.trim()

      if (finalText) {
        onFinished(finalText)
      }
    }

    recognitionRef.current = recognition
  }, [onFinished])

  function startDictation() {
    if (!recognitionRef.current || disabled) return

    transcriptRef.current = ""

    try {
      recognitionRef.current.start()
      setListening(true)
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
      <button
        type="button"
        disabled={disabled}
        onClick={listening ? stopDictation : startDictation}
        className={[
          "rounded-xl px-5 py-3 font-semibold text-white disabled:opacity-50",
          listening ? "bg-red-600" : "bg-green-600",
        ].join(" ")}
      >
        {listening ? "Stop Dictation" : "Start Dictation"}
      </button>

      <p className="mt-3 text-sm text-slate-500">
        {listening
          ? "Listening. Text will appear after dictation is stopped."
          : "Dictated letter text will appear only after dictation finishes."}
      </p>
    </div>
  )
}