import "server-only";

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
  const praktikaCookie = process.env.PRAKTIKA_COOKIE;
  const practiceId = process.env.PRAKTIKA_PRACTICE_ID || "1181";

  if (!praktikaCookie) {
    throw new Error("Missing PRAKTIKA_COOKIE");
  }

  const body = new URLSearchParams();

  body.set("sReportName", "completedProcedures");
  body.set("sFromDate", params.fromDate);
  body.set("sToDate", params.toDate);

  if (params.providerIds?.length) {
    for (const providerId of params.providerIds) {
      body.append("iProviderIds[]", providerId);
    }
  } else {
    body.set("iProviderIds", "");
  }

  body.append("iPracticeIds[]", practiceId);

  const response = await fetch(
    "https://praktika.praktika.net.au/php/json/db_reportingDataWarehouse.php",
    {
      method: "POST",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: praktikaCookie,
        Origin: "https://praktika.praktika.net.au",
        Referer: "https://praktika.praktika.net.au/v2/reports/production",
      },
      body,
      cache: "no-store",
    }
  );

  const text = await response.text();

  let data: any;
  try {
    data = text ? JSON.parse(text) : [];
  } catch {
    throw new Error(`Praktika did not return JSON: ${text.slice(0, 500)}`);
  }

  if (!response.ok) {
    throw new Error(
      `Praktika report failed: ${response.status} ${JSON.stringify(data).slice(
        0,
        500
      )}`
    );
  }

  const rows: PraktikaCompletedProcedure[] = Array.isArray(data) ? data : [];

  return rows.map((row) => ({
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