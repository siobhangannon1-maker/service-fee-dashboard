import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const GOOGLE_PLACES_URL =
  "https://places.googleapis.com/v1/places:searchNearby";

function getClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  return createClient(supabaseUrl, serviceRoleKey);
}

function normalizeName(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function parseAddress(address: string | null) {
  if (!address) {
    return {
      suburb: null,
      post_code: null,
      state: null,
    };
  }

  const postcodeMatch = address.match(/\b(4\d{3})\b/);
  const postCode = postcodeMatch?.[1] || null;

  const stateMatch = address.match(/\b(QLD|Queensland)\b/i);
  const state = stateMatch ? "QLD" : null;

  const parts = address.split(",").map((part) => part.trim());
  const suburbCandidate =
    parts.length >= 2 ? parts[parts.length - 2].replace(/\bQLD\b/i, "").trim() : null;

  return {
    suburb: suburbCandidate || null,
    post_code: postCode,
    state,
  };
}

async function findMatchingReferrer(
  supabase: ReturnType<typeof getClient>,
  normalizedName: string
) {
  const { data: exact } = await supabase
    .from("referrers")
    .select("id, normalized_name")
    .eq("normalized_name", normalizedName)
    .maybeSingle();

  if (exact) return exact.id;

  const { data: referrers } = await supabase
    .from("referrers")
    .select("id, normalized_name")
    .limit(5000);

  for (const referrer of referrers || []) {
    const existing = normalizeName(referrer.normalized_name || "");

    if (!existing) continue;

    if (
      existing.includes(normalizedName) ||
      normalizedName.includes(existing)
    ) {
      return referrer.id;
    }
  }

  return null;
}

export async function POST(request: Request) {
  try {
    const apiKey =
      process.env.GOOGLE_PLACES_API_KEY ||
      process.env.GOOGLE_GEOCODING_API_KEY;

    if (!apiKey) {
      throw new Error(
        "Missing GOOGLE_PLACES_API_KEY or GOOGLE_GEOCODING_API_KEY."
      );
    }

    const body = await request.json();

    const latitude = Number(body.latitude);
    const longitude = Number(body.longitude);
    const radiusMeters = Number(body.radiusMeters || 5000);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new Error("Missing valid latitude and longitude.");
    }

    const supabase = getClient();

    const googleRes = await fetch(GOOGLE_PLACES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount",
      },
      body: JSON.stringify({
        includedTypes: ["dentist"],
        maxResultCount: 20,
        locationRestriction: {
          circle: {
            center: {
              latitude,
              longitude,
            },
            radius: radiusMeters,
          },
        },
      }),
    });

    const googleJson = await googleRes.json();

    if (!googleRes.ok) {
      throw new Error(
        googleJson?.error?.message || "Google Places request failed."
      );
    }

    const places = googleJson.places || [];
    let upserted = 0;

    for (const place of places) {
      const practiceName = place.displayName?.text || "";
      const normalizedName = normalizeName(practiceName);

      if (!practiceName || !normalizedName) continue;

      const address = place.formattedAddress || null;
      const parsed = parseAddress(address);
      const matchedReferrerId = await findMatchingReferrer(
        supabase,
        normalizedName
      );

      const { error } = await supabase
        .from("dental_practice_prospects")
        .upsert(
          {
            place_id: place.id,
            practice_name: practiceName,
            normalized_name: normalizedName,
            address,
            suburb: parsed.suburb,
            post_code: parsed.post_code,
            state: parsed.state,
            latitude: place.location?.latitude ?? null,
            longitude: place.location?.longitude ?? null,
            google_rating: place.rating ?? null,
            google_user_ratings_total: place.userRatingCount ?? null,
            is_existing_referrer: Boolean(matchedReferrerId),
            matched_referrer_id: matchedReferrerId,
            updated_at: new Date().toISOString(),
          },
          {
            onConflict: "place_id",
          }
        );

      if (error) throw new Error(error.message);

      upserted++;
    }

    return NextResponse.json({
      ok: true,
      found: places.length,
      upserted,
      message: `Synced ${upserted} nearby dental practices.`,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Failed to sync referral opportunities.",
      },
      { status: 500 }
    );
  }
}