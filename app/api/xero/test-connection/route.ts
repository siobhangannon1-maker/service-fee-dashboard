import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fetchXeroOrganisation, getXeroAccessToken } from "@/lib/xero";

async function runTestConnection() {
  let syncRunId: string | null = null;

  try {
    const { data: syncRun, error: syncRunError } = await supabaseAdmin
      .from("xero_sync_runs")
      .insert({
        sync_type: "test_connection",
        status: "started",
      })
      .select("id")
      .single();

    if (syncRunError) {
      throw new Error(`Failed to create sync run: ${syncRunError.message}`);
    }

    syncRunId = syncRun.id;

    const accessToken = await getXeroAccessToken();
    const organisationResponse = await fetchXeroOrganisation(accessToken);

    const organisation = organisationResponse?.Organisations?.[0];

    if (!organisation) {
      throw new Error("No organisation returned from Xero");
    }

    const insertPayload = {
      xero_organisation_id: organisation.OrganisationID ?? null,
      name: organisation.Name ?? null,
      short_code: organisation.ShortCode ?? null,
      country_code: organisation.CountryCode ?? null,
      base_currency: organisation.BaseCurrency ?? null,
      organisation_status: organisation.OrganisationStatus ?? null,
      financial_year_end_day: organisation.FinancialYearEndDay ?? null,
      financial_year_end_month: organisation.FinancialYearEndMonth ?? null,
      raw_json: organisation,
    };

    const { error: insertError } = await supabaseAdmin
      .from("xero_raw_organisation")
      .insert(insertPayload);

    if (insertError) {
      throw new Error(`Failed to save organisation data: ${insertError.message}`);
    }

    const { error: finishError } = await supabaseAdmin
      .from("xero_sync_runs")
      .update({
        status: "success",
        finished_at: new Date().toISOString(),
        records_inserted: 1,
        metadata: {
          organisation_name: organisation.Name ?? null,
          organisation_id: organisation.OrganisationID ?? null,
        },
      })
      .eq("id", syncRunId);

    if (finishError) {
      throw new Error(`Failed to update sync run: ${finishError.message}`);
    }

    return NextResponse.json({
      success: true,
      message: "Xero connection successful",
      organisation: {
        organisationId: organisation.OrganisationID ?? null,
        name: organisation.Name ?? null,
        shortCode: organisation.ShortCode ?? null,
        countryCode: organisation.CountryCode ?? null,
        baseCurrency: organisation.BaseCurrency ?? null,
      },
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : "Unknown error while testing Xero connection";

    if (syncRunId) {
      await supabaseAdmin
        .from("xero_sync_runs")
        .update({
          status: "error",
          finished_at: new Date().toISOString(),
          error_message: errorMessage,
        })
        .eq("id", syncRunId);
    }

    return NextResponse.json(
      {
        success: false,
        message: errorMessage,
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return runTestConnection();
}

export async function POST() {
  return runTestConnection();
}