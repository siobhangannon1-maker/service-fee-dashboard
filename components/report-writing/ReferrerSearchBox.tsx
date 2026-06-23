"use client"

import { useEffect, useMemo, useRef, useState } from "react"

export type ReferrerSearchResult = {
  id: string
  name: string
  practice_name: string | null
  address: string | null
  phone: string | null
  email: string | null
}

type ReferrerSearchBoxProps = {
  onSelect: (referrer: ReferrerSearchResult) => void
  selectedName?: string | null
  selectedAddress?: string | null
  onClear?: () => void
  label?: string
  placeholder?: string
}

function formatSelectedReferrerFromValues(name?: string | null, address?: string | null) {
  const cleanName = String(name || "").trim()
  const cleanAddress = String(address || "").trim()
  const firstAddressLine = cleanAddress.split("\n")[0]?.trim() || ""

  return [cleanName, firstAddressLine].filter(Boolean).join(" — ")
}

function formatSelectedReferrer(referrer: ReferrerSearchResult | null) {
  if (!referrer) return ""

  return [
    referrer.name,
    referrer.practice_name,
    referrer.address?.split("\n")[0],
  ]
    .filter(Boolean)
    .join(" — ")
}

export default function ReferrerSearchBox({
  onSelect,
  selectedName,
  selectedAddress,
  onClear,
  label = "Referrer",
  placeholder = "Search and select referrer...",
}: ReferrerSearchBoxProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  const [query, setQuery] = useState("")
  const [results, setResults] = useState<ReferrerSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedReferrer, setSelectedReferrer] =
    useState<ReferrerSearchResult | null>(null)
  const [isFocused, setIsFocused] = useState(false)

  const externalSelectedText = formatSelectedReferrerFromValues(
    selectedName,
    selectedAddress,
  )

  useEffect(() => {
    if (!selectedName && !selectedAddress) {
      setSelectedReferrer(null)
      setQuery("")
      setResults([])
      return
    }

    if (!selectedReferrer && externalSelectedText) {
      setQuery(externalSelectedText)
    }
  }, [selectedName, selectedAddress, externalSelectedText, selectedReferrer])

  const displayValue = useMemo(() => {
    if (isFocused) return query
    if (selectedReferrer) return formatSelectedReferrer(selectedReferrer)
    return externalSelectedText || query
  }, [isFocused, query, selectedReferrer, externalSelectedText])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setIsFocused(false)
        setResults([])
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      if (query.trim().length < 2 || selectedReferrer) {
        setResults([])
        return
      }

      setLoading(true)

      try {
        const response = await fetch(
          `/api/report-writing/referrers/search?q=${encodeURIComponent(query)}`,
        )

        const data = await response.json()

        if (data.success) {
          setResults(data.referrers || [])
        }
      } catch (error) {
        console.error(error)
      } finally {
        setLoading(false)
      }
    }, 300)

    return () => window.clearTimeout(timer)
  }, [query, selectedReferrer])

  function selectReferrer(referrer: ReferrerSearchResult) {
    setSelectedReferrer(referrer)
    setQuery(formatSelectedReferrer(referrer))
    setResults([])
    setIsFocused(false)
    onSelect(referrer)
  }

  function clearSelection() {
    setSelectedReferrer(null)
    setQuery("")
    setResults([])
    setIsFocused(true)
    onClear?.()
  }

  const hasSelectedReferrer = Boolean(
    selectedReferrer || selectedName || selectedAddress,
  )

  return (
    <div ref={wrapperRef} className="relative md:col-span-2">
      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </label>

      <div className="relative">
        <input
          className={[
            "w-full rounded-xl border bg-white px-4 py-3 pr-24 text-sm shadow-sm outline-none transition",
            hasSelectedReferrer
              ? "border-emerald-300 text-slate-950 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
              : "border-slate-300 text-slate-950 focus:border-blue-500 focus:ring-2 focus:ring-blue-100",
          ].join(" ")}
          placeholder={placeholder}
          value={displayValue}
          onFocus={() => {
            setIsFocused(true)

            if (hasSelectedReferrer) {
              setQuery("")
              setSelectedReferrer(null)
              setResults([])
            }
          }}
          onChange={(event) => {
            setSelectedReferrer(null)
            setQuery(event.target.value)
            setIsFocused(true)
          }}
        />

        {hasSelectedReferrer ? (
          <button
            type="button"
            onClick={clearSelection}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            Change
          </button>
        ) : loading ? (
          <div className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-slate-400">
            Searching...
          </div>
        ) : null}
      </div>

      {hasSelectedReferrer && !isFocused ? (
        <div className="mt-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
          Selected referrer saved to the letter.
        </div>
      ) : null}

      {results.length > 0 ? (
        <div className="absolute z-30 mt-2 max-h-80 w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-xl">
          {results.map((referrer) => (
            <button
              key={referrer.id}
              type="button"
              onClick={() => selectReferrer(referrer)}
              className="block w-full border-b border-slate-100 p-4 text-left last:border-b-0 hover:bg-blue-50"
            >
              <div className="font-semibold text-slate-950">{referrer.name}</div>

              {referrer.practice_name ? (
                <div className="mt-0.5 text-sm text-slate-700">
                  {referrer.practice_name}
                </div>
              ) : null}

              {referrer.address ? (
                <div className="mt-1 whitespace-pre-wrap text-xs text-slate-500">
                  {referrer.address}
                </div>
              ) : null}

              {referrer.email || referrer.phone ? (
                <div className="mt-2 text-xs text-slate-400">
                  {[referrer.email, referrer.phone].filter(Boolean).join(" · ")}
                </div>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}