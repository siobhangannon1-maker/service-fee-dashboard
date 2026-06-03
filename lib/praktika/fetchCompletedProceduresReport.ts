import "server-only";

import { praktikaHelperPostForCurrentUser } from "@/lib/praktika/helper-job-client";

export type PraktikaCompletedProcedure = {
  iProcedureId: string;
  vchCode: string;
  vchADACodeRef?: string;
  vchCodeDescShort: string;
  iTotalFee: string;
  vchPatientName: string;
  iPatientNumber: string;
  iProviderId: string;
  vchProvider: string;
  dtCompleted: string;
  iPracticeId: string;
};

export type ProductionReportLine = {
  patientName: string;
  patientNumber: string;
  itemCode: string;
  description: string;
  providerName: string;
  providerId: string;
  completedDate: string;
  amount: number;
};

function centsToDollars(value: string | number | null | undefined) {
  return Number(value || 0) / 100;
}

export async function fetchCompletedProceduresReport(params: {
  fromDate: string;
  toDate: string;
  providerIds?: string[];
}): Promise<ProductionReportLine[]> {
  const practiceId = process.env.PRAKTIKA_PRACTICE_ID || "1181";

  const body: Record<string, string | string[]> = {
    sReportName: "completedProcedures",
    sFromDate: params.fromDate,
    sToDate: params.toDate,
    "iPracticeIds[]": [practiceId],
  };

  if (params.providerIds?.length) {
    body["iProviderIds[]"] = params.providerIds;
  } else {
    body.iProviderIds = "";
  }

  const rows = await praktikaHelperPostForCurrentUser<PraktikaCompletedProcedure[]>({
    jobType: "completed_procedures_report",
    priority: 20,
    path: "/php/json/db_reportingDataWarehouse.php",
    contentType: "form",
    referer: "https://praktika.praktika.net.au/v2/reports/production",
    timeoutMs: 120_000,
    body,
  });

  const safeRows: PraktikaCompletedProcedure[] = Array.isArray(rows) ? rows : [];

  return safeRows.map((row) => ({
    patientName: row.vchPatientName || "",
    patientNumber: row.iPatientNumber || "",
    itemCode: row.vchADACodeRef || row.vchCode || "",
    description: row.vchCodeDescShort || "",
    providerName: row.vchProvider || "",
    providerId: row.iProviderId || "",
    completedDate: row.dtCompleted || "",
    amount: centsToDollars(row.iTotalFee),
  }));
}
