import { requestPraktikaJson } from "./praktika-request";

export async function fetchPraktikaJson(
  params: URLSearchParams,
  referer: string
) {
  const data = await requestPraktikaJson({
    path: "/php/json/db_reportingDataWarehouse.php",
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: referer,
    },
    body: params.toString(),
  });

  if (!Array.isArray(data)) {
    console.log("Praktika non-array report response:", data);
    throw new Error("Praktika did not return a report array.");
  }

  return data as any[];
}