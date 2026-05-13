import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import PatientEntriesReviewClient from "./PatientEntriesReviewClient";

const ALLOWED_ROLES = [
  "billing_staff",
  "practice_manager",
  "admin",
  "super_admin",
];

type ProfileRow = {
  id: string;
  full_name: string | null;
  role: string | null;
};

type Provider = {
  id: string;
  name: string;
};

type BillingPeriod = {
  id: string;
  label: string;
  status: string;
  month: number;
  year: number;
};

type PatientFinancialEntry = {
  id: string;
  provider_id: string;
  related_provider_id: string | null;
  billing_period_id: string | null;
  patient_name: string;
  entry_date: string;
  category:
    | "lab_implant_materials"
    | "fees_paid_to_focus"
    | "fees_paid_in_error"
    | "fees_owed"
    | "paid_to_wrong_provider";
  amount: number;
  notes: string | null;
  deleted_at?: string | null;
  is_verified?: boolean;
  verified_at?: string | null;
  verified_by?: string | null;
  verified_by_initials?: string | null;
  is_review_locked?: boolean;
};

type ReviewerInfo = {
  userId: string;
  displayName: string;
  initials: string;
};

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) return "?";
  if (parts.length === 1) {
    const first = parts[0].replace(/[^a-zA-Z]/g, "");
    return first ? first.slice(0, 2).toUpperCase() : "?";
  }

  const first = parts[0].replace(/[^a-zA-Z]/g, "");
  const second = parts[1].replace(/[^a-zA-Z]/g, "");

  if (!first && !second) return "?";
  if (!first) return second.slice(0, 2).toUpperCase() || "?";
  if (!second) return first.slice(0, 2).toUpperCase() || "?";

  return `${first[0]}${second[0]}`.toUpperCase();
}

export default async function PatientEntriesReviewPage() {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    redirect("/login");
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name, role")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    redirect("/");
  }

  const typedProfile = profile as ProfileRow;

  if (!typedProfile.role || !ALLOWED_ROLES.includes(typedProfile.role)) {
    redirect("/");
  }

  const [
    { data: providers },
    { data: billingPeriods },
    { data: entries, error: entriesError },
  ] = await Promise.all([
    supabaseAdmin.from("providers").select("id, name").order("name"),
    supabaseAdmin
      .from("billing_periods")
      .select("id, label, status, month, year")
      .order("year", { ascending: false })
      .order("month", { ascending: false }),
    supabaseAdmin
      .from("patient_financial_entries")
      .select("*")
      .is("deleted_at", null)
      .order("entry_date", { ascending: false }),
  ]);

  if (entriesError) {
    throw new Error(entriesError.message);
  }

  const typedEntries = (entries || []) as PatientFinancialEntry[];

  const reviewerIds = Array.from(
    new Set(
      typedEntries
        .map((entry) => entry.verified_by)
        .filter((value): value is string => Boolean(value))
    )
  );

  let initialReviewerInfo: Record<string, ReviewerInfo> = {};

  if (reviewerIds.length > 0) {
    const { data: reviewerProfiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name")
      .in("id", reviewerIds);

    const profileMap = new Map(
      ((reviewerProfiles || []) as Pick<ProfileRow, "id" | "full_name">[]).map(
        (item) => [item.id, item.full_name]
      )
    );

    const { data: authUsers } = await supabaseAdmin.auth.admin.listUsers();

    const authEmailMap = new Map(
      (authUsers.users || []).map((authUser) => [
        authUser.id,
        authUser.email || null,
      ])
    );

    initialReviewerInfo = Object.fromEntries(
      reviewerIds.map((reviewerId) => {
        const displayName =
          profileMap.get(reviewerId)?.trim() ||
          authEmailMap.get(reviewerId) ||
          reviewerId;

        return [
          reviewerId,
          {
            userId: reviewerId,
            displayName,
            initials: getInitials(displayName),
          },
        ];
      })
    );
  }

  const currentUserDisplayName =
    typedProfile.full_name?.trim() || user.email || user.id;

  return (
    <PatientEntriesReviewClient
      currentUser={{
        id: user.id,
        displayName: currentUserDisplayName,
        initials: getInitials(currentUserDisplayName),
        role: typedProfile.role,
      }}
      providers={(providers || []) as Provider[]}
      billingPeriods={(billingPeriods || []) as BillingPeriod[]}
      initialEntries={typedEntries}
      initialReviewerInfo={initialReviewerInfo}
    />
  );
}