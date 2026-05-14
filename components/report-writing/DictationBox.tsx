"use client"

import { useEffect, useRef, useState } from "react"

type DictationBoxProps = {
  value: string
  onChange: (value: string) => void
}

export default function DictationBox({ value, onChange }: DictationBoxProps) {
  const recognitionRef = useRef<any>(null)
  const latestValueRef = useRef(value)

  const [listening, setListening] = useState(false)
  const [supported, setSupported] = useState(true)
  const [interimText, setInterimText] = useState("")

  useEffect(() => {
    latestValueRef.current = value
  }, [value])

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
      let finalText = ""
      let interim = ""

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript

        if (event.results[i].isFinal) {
          finalText += transcript + " "
        } else {
          interim += transcript
        }
      }

      if (finalText.trim()) {
        const current = latestValueRef.current.trim()
        const next = current
          ? `${current} ${finalText.trim()}`
          : finalText.trim()

        onChange(next)
        latestValueRef.current = next
      }

      setInterimText(interim)
    }

    recognition.onerror = (event: any) => {
      console.error("Speech recognition error:", event)
      setListening(false)
    }

    recognition.onend = () => {
      setListening(false)
      setInterimText("")
    }

    recognitionRef.current = recognition
  }, [onChange])

  function startDictation() {
    if (!recognitionRef.current) return

    try {
      recognitionRef.current.start()
      setListening(true)
    } catch {
      // Prevents crash if already started
    }
  }

  function stopDictation() {
    if (!recognitionRef.current) return

    recognitionRef.current.stop()
    setListening(false)
    setInterimText("")
  }

  function clearNotes() {
    const confirmed = confirm("Clear the clinical notes text?")

    if (!confirmed) return

    onChange("")
    latestValueRef.current = ""
    setInterimText("")
  }

  if (!supported) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Voice dictation is not supported in this browser. Try Google Chrome.
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={listening ? stopDictation : startDictation}
          className={[
            "rounded-xl px-5 py-3 font-semibold text-white",
            listening ? "bg-red-600" : "bg-green-600",
          ].join(" ")}
        >
          {listening ? "Stop Dictation" : "Start Dictation"}
        </button>

        <button
          type="button"
          onClick={clearNotes}
          className="rounded-xl border border-slate-300 px-5 py-3 font-semibold text-slate-700 hover:bg-slate-50"
        >
          Clear Notes
        </button>

        <div className="text-sm text-slate-500">
          {listening
            ? "Listening... dictated text will be added to clinical notes."
            : "Dictation will append into the clinical notes box below."}
        </div>
      </div>

      {interimText ? (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
          {interimText}
        </div>
      ) : null}
    </div>
  )
}