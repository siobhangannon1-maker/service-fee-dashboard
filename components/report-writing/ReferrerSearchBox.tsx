"use client"

import { useEffect, useState } from "react"

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
}

export default function ReferrerSearchBox({
  onSelect,
}: ReferrerSearchBoxProps) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<ReferrerSearchResult[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (query.trim().length < 2) {
        setResults([])
        return
      }

      setLoading(true)

      try {
        const response = await fetch(
          `/api/report-writing/referrers/search?q=${encodeURIComponent(query)}`
        )

        const data = await response.json()

        if (data.success) {
          setResults(data.referrers)
        }
      } catch (error) {
        console.error(error)
      } finally {
        setLoading(false)
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [query])

  return (
    <div className="relative md:col-span-2">
      <input
        className="w-full rounded-xl border border-slate-300 p-3"
        placeholder="Search referrer by name, practice, or address..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {loading ? (
        <div className="mt-2 text-sm text-slate-500">
          Searching...
        </div>
      ) : null}

      {results.length > 0 ? (
        <div className="absolute z-20 mt-2 max-h-80 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
          {results.map((referrer) => (
            <button
              key={referrer.id}
              type="button"
              onClick={() => {
                onSelect(referrer)
                setQuery(referrer.name)
                setResults([])
              }}
              className="w-full border-b border-slate-100 p-3 text-left hover:bg-slate-50"
            >
              <div className="font-semibold text-slate-950">
                {referrer.name}
              </div>

              {referrer.practice_name ? (
                <div className="text-sm text-slate-600">
                  {referrer.practice_name}
                </div>
              ) : null}

              {referrer.address ? (
                <div className="whitespace-pre-wrap text-xs text-slate-500">
                  {referrer.address}
                </div>
              ) : null}

              {referrer.email || referrer.phone ? (
                <div className="mt-1 text-xs text-slate-400">
                  {[referrer.email, referrer.phone]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}