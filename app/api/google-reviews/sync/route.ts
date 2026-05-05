import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

type GoogleReview = {
  reviewId?: string;
  starRating?: string;
  createTime?: string;
  comment?: string;
  reviewer?: {
    displayName?: string;
  };
};

type GoogleReviewsResponse = {
  reviews?: GoogleReview[];
  nextPageToken?: string;
};

function ratingToNumber(rating?: string) {
  const ratings: Record<string, number> = {
    ONE: 1,
    TWO: 2,
    THREE: 3,
    FOUR: 4,
    FIVE: 5,
  };

  return ratings[rating || ""] || 0;
}

function toDateOnly(value: string) {
  return value.slice(0, 10);
}

function isGoogleReconnectError(message: string) {
  const lower = message.toLowerCase();

  return (
    lower.includes("invalid_grant") ||
    lower.includes("expired") ||
    lower.includes("revoked") ||
    lower.includes("google is not connected") ||
    lower.includes("invalid credentials") ||
    lower.includes("unauthorized")
  );
}

async function getAccessToken() {
  const { data: tokenRow, error } = await supabaseAdmin
    .from("google_business_tokens")
    .select("refresh_token")
    .eq("id", "main")
    .single();

  if (error) throw error;

  if (!tokenRow?.refresh_token) {
    throw new Error("Google is not connected. Please reconnect Google Business.");
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_BUSINESS_CLIENT_ID!,
      client_secret: process.env.GOOGLE_BUSINESS_CLIENT_SECRET!,
      refresh_token: tokenRow.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error_description ||
        data?.error ||
        "Failed to get Google access token"
    );
  }

  const expiresAt = data.expires_in
    ? new Date(Date.now() + data.expires_in * 1000).toISOString()
    : null;

  await supabaseAdmin
    .from("google_business_tokens")
    .update({
      access_token: data.access_token || null,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", "main");

  return data.access_token as string;
}

async function fetchReviewsForLocation(
  accessToken: string,
  accountId: string,
  locationId: string
) {
  const allReviews: GoogleReview[] = [];
  let nextPageToken = "";

  do {
    const url = new URL(
      `https://mybusiness.googleapis.com/v4/accounts/${accountId}/locations/${locationId}/reviews`
    );

    url.searchParams.set("pageSize", "50");

    if (nextPageToken) {
      url.searchParams.set("pageToken", nextPageToken);
    }

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
    });

    const data = (await response.json()) as GoogleReviewsResponse;

    if (!response.ok) {
      throw new Error(
        `Google reviews error for location ${locationId}: ${JSON.stringify(data)}`
      );
    }

    allReviews.push(...(data.reviews || []));
    nextPageToken = data.nextPageToken || "";
  } while (nextPageToken);

  return allReviews;
}

export async function POST() {
  try {
    const accountId = process.env.GOOGLE_BUSINESS_ACCOUNT_ID;
    const locationIds = process.env.GOOGLE_BUSINESS_LOCATION_IDS;

    if (!accountId) throw new Error("Missing GOOGLE_BUSINESS_ACCOUNT_ID");
    if (!locationIds) throw new Error("Missing GOOGLE_BUSINESS_LOCATION_IDS");

    const accessToken = await getAccessToken();

    const locationIdList = locationIds
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

    const allRowsToSave = [];

    for (const locationId of locationIdList) {
      const reviews = await fetchReviewsForLocation(
        accessToken,
        accountId,
        locationId
      );

      for (const review of reviews) {
        if (!review.reviewId || !review.createTime) continue;

        const starRating = ratingToNumber(review.starRating);
        if (!starRating) continue;

        allRowsToSave.push({
          google_review_id: `${locationId}-${review.reviewId}`,
          location_id: locationId,
          review_date: toDateOnly(review.createTime),
          star_rating: starRating,
          comment: review.comment || null,
          reviewer_name: review.reviewer?.displayName || null,
          raw_json: review,
          synced_at: new Date().toISOString(),
        });
      }
    }

    if (allRowsToSave.length > 0) {
      const { error } = await supabaseAdmin
        .from("google_reviews_raw")
        .upsert(allRowsToSave, {
          onConflict: "google_review_id",
        });

      if (error) throw error;
    }

    return NextResponse.json({
      success: true,
      locations_checked: locationIdList.length,
      reviews_saved: allRowsToSave.length,
    });
  } catch (error: any) {
    const message = error?.message || "Unknown error";
    const needsReconnect = isGoogleReconnectError(message);

    return NextResponse.json(
      {
        success: false,
        error: needsReconnect
          ? "Your Google connection has expired. Please reconnect Google Business."
          : message,
        technical_error: message,
        needsReconnect,
      },
      { status: 500 }
    );
  }
}