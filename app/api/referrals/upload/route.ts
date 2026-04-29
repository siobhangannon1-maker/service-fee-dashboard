import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function normalizeName(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

async function geocodeAddress(row: any) {
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

  const res = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
      fullAddress
    )}&key=${key}`
  );

  const json = await res.json();

  if (!json.results?.[0]) return null;

  return json.results[0].geometry.location;
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

  const title = "New Referrer";

  const description = `Referral received on ${referralReceivedDate} from ${referrer.clinic_name}. Please contact and send referral pack.`;

  const { data: task, error } = await supabase
    .from("practice_manager_tasks")
    .insert({
      title,
      description,
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
    console.error("Could not create practice manager task:", error.message);
    return null;
  }

  return task;
}

export async function POST(req: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || !["admin", "practice_manager"].includes(profile.role)) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  const { rows, fileName, weekStart, weekEnd } = await req.json();

  if (!weekStart || !weekEnd) {
    return NextResponse.json(
      { error: "Week start and week end are required." },
      { status: 400 }
    );
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json(
      { error: "No referral rows were provided." },
      { status: 400 }
    );
  }

  const { data: existingUpload } = await supabase
    .from("referral_uploads")
    .select("id, file_name, week_start, week_end")
    .eq("week_start", weekStart)
    .eq("week_end", weekEnd)
    .maybeSingle();

  if (existingUpload) {
    return NextResponse.json(
      {
        error: `An upload already exists for ${weekStart} to ${weekEnd}. Delete it first, or link/update the existing upload.`,
      },
      { status: 409 }
    );
  }

  const { data: upload, error: uploadError } = await supabase
    .from("referral_uploads")
    .insert({
      file_name: fileName,
      week_start: weekStart,
      week_end: weekEnd,
      created_by: user.id,
    })
    .select()
    .single();

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const newReferrers: any[] = [];
  const createdTasks: any[] = [];
  let recordsInserted = 0;

  for (const row of rows) {
    const clinicName = row.clinic_name?.trim();

    if (!clinicName) continue;

    const normalizedName = normalizeName(clinicName);

    const { data: existingReferrer, error: existingReferrerError } =
      await supabase
        .from("referrers")
        .select("*")
        .eq("normalized_name", normalizedName)
        .maybeSingle();

    if (existingReferrerError) {
      return NextResponse.json(
        { error: existingReferrerError.message },
        { status: 500 }
      );
    }

    let referrer = existingReferrer;
    let isNewReferrer = false;

    if (!referrer) {
      const location = await geocodeAddress(row);

      const { data: createdReferrer, error: referrerError } = await supabase
        .from("referrers")
        .insert({
          clinic_name: clinicName,
          normalized_name: normalizedName,
          address: row.address,
          suburb: row.suburb,
          post_code: row.post_code,
          state: row.state,
          latitude: location?.lat ?? null,
          longitude: location?.lng ?? null,
        })
        .select()
        .single();

      if (referrerError) {
        return NextResponse.json(
          { error: referrerError.message },
          { status: 500 }
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
        referral_count: Number(row.referral_count || 0),
        referral_week_start: weekStart,
        referral_week_end: weekEnd,
      });

    if (recordError) {
      return NextResponse.json({ error: recordError.message }, { status: 500 });
    }

    recordsInserted++;

    if (isNewReferrer) {
      const task = await createNewReferrerTask({
        supabase,
        userId: user.id,
        referrer,
        uploadId: upload.id,
        referralReceivedDate: weekEnd || weekStart,
      });

      if (task) {
        createdTasks.push(task);
      }
    }
  }

  return NextResponse.json({
    success: true,
    upload,
    rowsReceived: rows.length,
    recordsInserted,
    newReferrers,
    createdTasks,
  });
}