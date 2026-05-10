import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchPraktikaJson } from "@/lib/praktika/fetch-praktika-json";

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  return createSupabaseAdmin(supabaseUrl, serviceRoleKey);
}

function normalizeWhitespace(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeName(name: string) {
  return normalizeWhitespace(name).toLowerCase();
}

function toNumber(value: unknown): number {
  const num = Number(String(value ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(num) ? num : 0;
}

function pickFirst(row: any, keys: string[]) {
  for (const key of keys) {
    if (
      row[key] !== undefined &&
      row[key] !== null &&
      String(row[key]).trim() !== ""
    ) {
      return row[key];
    }
  }

  return null;
}

function isValidIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function geocodeAddress(row: {
  address: string | null;
  suburb: string | null;
  state: string | null;
  post_code: string | null;
}) {
  const key = process.env.GOOGLE_GEOCODING_API_KEY;
  if (!key) return null;

  const fullAddress = [
    row.address,
    row.suburb,
    row.state,
    row.post_code,
    "Australia",
  ]
    .filter(Boolean)
    .join(", ");

  if (!fullAddress.trim()) return null;

  const res = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
      fullAddress
    )}&key=${key}`,
    { cache: "no-store" }
  );

  const json = await res.json();

  return json.results?.[0]?.geometry?.location ?? null;
}

async function createNewReferrerTask({
  supabase,
  userId,
  referrer,
  uploadId,
  referralReceivedDate,
}: {
  supabase: any;
  userId: string;
  referrer: any;
  uploadId: string;
  referralReceivedDate: string;
}) {
  const { data: existingTask } = await supabase
    .from("practice_manager_tasks")
    .select("id")
    .eq("source_referrer_id", referrer.id)
    .maybeSingle();

  if (existingTask) return null;

  const { data: task, error } = await supabase
    .from("practice_manager_tasks")
    .insert({
      title: "New Referrer",
      description: `Referral received on ${referralReceivedDate} from ${referrer.clinic_name}. Please contact and send referral pack.`,
      task_type: "new_referrer",
      status: "open",
      referral_received_date: referralReceivedDate,
      source_referrer_id: referrer.id,
      source_upload_id: uploadId,
      created_by: userId,
    })
    .select()
    .single();

  if (error) {
    console.error("Could not create new referrer task:", error.message);
    return null;
  }

  return task;
}

export async function POST(request: Request) {
  try {
    const userSupabase = await createClient();

    const {
      data: { user },
    } = await userSupabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not logged in" }, { status: 401 });
    }

    const { data: profile } = await userSupabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!profile || !["admin", "practice_manager"].includes(profile.role)) {
      return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    }

    const body = await request.json();

    const fromDate = String(body.fromDate ?? "").trim();
    const toDate = String(body.toDate ?? "").trim();

    if (!isValidIsoDate(fromDate) || !isValidIsoDate(toDate)) {
      throw new Error("Invalid date range.");
    }

    if (fromDate > toDate) {
      throw new Error("From date must be before To date.");
    }

    const practiceId = process.env.PRAKTIKA_PRACTICE_ID;
    if (!practiceId) throw new Error("Missing PRAKTIKA_PRACTICE_ID.");

    const supabase = getAdminClient();

    const params = new URLSearchParams();
    params.append("sReportName", "referrals");
    params.append("iPracticeId", practiceId);
    params.append("sFromDate", fromDate);
    params.append("sToDate", toDate);
    params.append("sMode", "CLINIC");

    const data = await fetchPraktikaJson(
      params,
      "https://praktika.praktika.net.au/v2/reports/referrals"
    );

    const fileName = `Praktika Referrals ${fromDate} to ${toDate}`;

    const { data: existingUploads, error: existingError } = await supabase
      .from("referral_uploads")
      .select("id")
      .eq("week_start", fromDate)
      .eq("week_end", toDate)
      .ilike("file_name", "Praktika Referrals%");

    if (existingError) {
      throw new Error(
        `Failed to check existing referral sync: ${existingError.message}`
      );
    }

    const existingIds = (existingUploads ?? []).map((row) => row.id);

    if (existingIds.length > 0) {
      const { error: deleteOldError } = await supabase
        .from("referral_uploads")
        .delete()
        .in("id", existingIds);

      if (deleteOldError) {
        throw new Error(
          `Failed to delete old referral sync: ${deleteOldError.message}`
        );
      }
    }

    const { data: upload, error: uploadError } = await supabase
      .from("referral_uploads")
      .insert({
        file_name: fileName,
        week_start: fromDate,
        week_end: toDate,
        created_by: user.id,
      })
      .select()
      .single();

    if (uploadError || !upload) {
      throw new Error(
        `Failed to create referral upload: ${
          uploadError?.message || "No upload returned"
        }`
      );
    }

    let recordsInserted = 0;
    const newReferrers: any[] = [];
    const createdTasks: any[] = [];

    for (const row of data) {
      const clinicName = normalizeWhitespace(
        pickFirst(row, [
          "vchClinic",
          "vchClinicName",
          "vchReferrerClinicName",
          "vchReferrerName",
          "vchReferralSource",
          "clinic_name",
          "referrer",
          "referrer_name",
          "Clinic Name",
          "Referral Source",
        ])
      );

      if (!clinicName) continue;

      const address = normalizeWhitespace(
        pickFirst(row, ["vchStreetAddress", "vchAddress", "address", "Address"])
      );

      const suburb = normalizeWhitespace(
        pickFirst(row, ["vchSuburb", "suburb", "Suburb"])
      );

      const postCode = normalizeWhitespace(
        pickFirst(row, ["vchPostCode", "post_code", "Post Code", "postcode"])
      );

      const state = normalizeWhitespace(
        pickFirst(row, ["vchState", "state", "State"])
      );

      const referralCount =
        toNumber(
          pickFirst(row, [
            "iReferralCount",
            "totalIncoming",
            "referral_count",
            "Referral Count",
            "count",
            "Count",
          ])
        ) || 1;

      const normalizedName = normalizeName(clinicName);

      const { data: existingReferrer, error: existingReferrerError } =
        await supabase
          .from("referrers")
          .select("*")
          .eq("normalized_name", normalizedName)
          .maybeSingle();

      if (existingReferrerError) {
        throw new Error(
          `Failed to check referrer ${clinicName}: ${existingReferrerError.message}`
        );
      }

      let referrer = existingReferrer;
      let isNewReferrer = false;

      if (!referrer) {
        const location = await geocodeAddress({
          address: address || null,
          suburb: suburb || null,
          state: state || null,
          post_code: postCode || null,
        });

        const { data: createdReferrer, error: createReferrerError } =
          await supabase
            .from("referrers")
            .insert({
              clinic_name: clinicName,
              normalized_name: normalizedName,
              address: address || null,
              suburb: suburb || null,
              post_code: postCode || null,
              state: state || null,
              latitude: location?.lat ?? null,
              longitude: location?.lng ?? null,
            })
            .select()
            .single();

        if (createReferrerError || !createdReferrer) {
          throw new Error(
            `Failed to create referrer ${clinicName}: ${
              createReferrerError?.message || "No referrer returned"
            }`
          );
        }

        referrer = createdReferrer;
        isNewReferrer = true;
        newReferrers.push(createdReferrer);
      }

      const { error: recordError } = await supabase
        .from("referral_records")
        .insert({
          upload_id: upload.id,
          referrer_id: referrer.id,
          referral_count: referralCount,
          referral_week_start: fromDate,
          referral_week_end: toDate,
        });

      if (recordError) {
        throw new Error(`Failed to insert referral record: ${recordError.message}`);
      }

      recordsInserted++;

      if (isNewReferrer) {
        const task = await createNewReferrerTask({
          supabase,
          userId: user.id,
          referrer,
          uploadId: upload.id,
          referralReceivedDate: toDate,
        });

        if (task) createdTasks.push(task);
      }
    }

    return NextResponse.json({
      ok: true,
      upload,
      rowsReceived: data.length,
      recordsInserted,
      newReferrers,
      createdTasks,
      message: `Synced ${recordsInserted} referral records from Praktika.`,
    });
  } catch (error: any) {
    console.error("Praktika referrals sync failed:", error);

    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Praktika referrals sync failed.",
      },
      { status: 500 }
    );
  }
}