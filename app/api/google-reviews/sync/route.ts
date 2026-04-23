import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

type GoogleReview = {
  reviewId?: string
  starRating?: string
  createTime?: string
}

type GoogleReviewsResponse = {
  reviews?: GoogleReview[]
  nextPageToken?: string
  averageRating?: number
  totalReviewCount?: number
}

type MonthlyBucket = {
  year: number
  month: number
  month_key: string
  review_count: number
  average_rating: number
}

function getMonthKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, '0')}`
}

function parseStarRating(value?: string) {
  if (!value) return 0

  const map: Record<string, number> = {
    ONE: 1,
    TWO: 2,
    THREE: 3,
    FOUR: 4,
    FIVE: 5,
  }

  return map[value] ?? Number(value) ?? 0
}

async function fetchAllReviews() {
  const accountId = process.env.GOOGLE_BUSINESS_ACCOUNT_ID
  const locationId = process.env.GOOGLE_BUSINESS_LOCATION_ID
  const accessToken = process.env.GOOGLE_BUSINESS_ACCESS_TOKEN

  if (!accountId) {
    throw new Error('Missing GOOGLE_BUSINESS_ACCOUNT_ID')
  }

  if (!locationId) {
    throw new Error('Missing GOOGLE_BUSINESS_LOCATION_ID')
  }

  if (!accessToken) {
    throw new Error('Missing GOOGLE_BUSINESS_ACCESS_TOKEN')
  }

  const allReviews: GoogleReview[] = []
  let nextPageToken: string | undefined

  do {
    const url = new URL(
      `https://mybusiness.googleapis.com/v4/accounts/${accountId}/locations/${locationId}/reviews`
    )

    url.searchParams.set('pageSize', '50')

    if (nextPageToken) {
      url.searchParams.set('pageToken', nextPageToken)
    }

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Google reviews fetch failed: ${response.status} ${text}`)
    }

    const json = (await response.json()) as GoogleReviewsResponse
    allReviews.push(...(json.reviews || []))
    nextPageToken = json.nextPageToken
  } while (nextPageToken)

  return allReviews
}

function buildMonthlyBuckets(reviews: GoogleReview[]): MonthlyBucket[] {
  const map = new Map<
    string,
    {
      year: number
      month: number
      review_count: number
      rating_sum: number
    }
  >()

  for (const review of reviews) {
    if (!review.createTime) continue

    const created = new Date(review.createTime)

    if (Number.isNaN(created.getTime())) continue

    const year = created.getUTCFullYear()
    const month = created.getUTCMonth() + 1
    const month_key = getMonthKey(year, month)
    const rating = parseStarRating(review.starRating)

    const existing = map.get(month_key) || {
      year,
      month,
      review_count: 0,
      rating_sum: 0,
    }

    existing.review_count += 1
    existing.rating_sum += rating

    map.set(month_key, existing)
  }

  return Array.from(map.entries())
    .map(([month_key, value]) => ({
      year: value.year,
      month: value.month,
      month_key,
      review_count: value.review_count,
      average_rating:
        value.review_count > 0
          ? Number((value.rating_sum / value.review_count).toFixed(2))
          : 0,
    }))
    .sort((a, b) => a.month_key.localeCompare(b.month_key))
}

export async function POST() {
  try {
    const supabase = createAdminClient()

    const reviews = await fetchAllReviews()
    const monthlyBuckets = buildMonthlyBuckets(reviews)

    const { data: benchmarks, error: benchmarkError } = await supabase
      .from('google_review_benchmarks')
      .select('id, year, month, month_key, review_target')

    if (benchmarkError) {
      throw benchmarkError
    }

    const benchmarkMap = new Map(
      (benchmarks || []).map((row) => [
        row.month_key,
        {
          id: row.id,
          review_target: Number(row.review_target || 0),
        },
      ])
    )

    const rowsToUpsert = monthlyBuckets.map((row) => {
      const benchmark = benchmarkMap.get(row.month_key)

      const reviewTarget = benchmark?.review_target ?? 0
      const varianceReviews = row.review_count - reviewTarget

      return {
        year: row.year,
        month: row.month,
        month_key: row.month_key,
        review_count: row.review_count,
        average_rating: row.average_rating,
        benchmark_id: benchmark?.id ?? null,
        review_target: reviewTarget,
        variance_reviews: varianceReviews,
        location_name: process.env.GOOGLE_BUSINESS_LOCATION_NAME || null,
        last_synced_at: new Date().toISOString(),
      }
    })

    if (rowsToUpsert.length > 0) {
      const { error: upsertError } = await supabase
        .from('google_review_monthly_metrics')
        .upsert(rowsToUpsert, { onConflict: 'month_key' })

      if (upsertError) {
        throw upsertError
      }
    }

    return NextResponse.json({
      success: true,
      months_synced: rowsToUpsert.length,
      reviews_processed: reviews.length,
    })
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error?.message || 'Unknown error',
      },
      { status: 500 }
    )
  }
}