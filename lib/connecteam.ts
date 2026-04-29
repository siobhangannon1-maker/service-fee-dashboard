const CONNECTEAM_BASE_URL = "https://api.connecteam.com";

export async function connecteamFetch(path: string) {
  const apiKey = process.env.CONNECTEAM_API_KEY;

  if (!apiKey) {
    throw new Error("Missing CONNECTEAM_API_KEY");
  }

  const response = await fetch(`${CONNECTEAM_BASE_URL}${path}`, {
    method: "GET",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  const text = await response.text();

  let data: any = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    throw new Error(
      `Connecteam request failed: ${response.status} ${JSON.stringify(data)}`
    );
  }

  return data;
}

export function getConnecteamTimeClockId() {
  const timeClockId = process.env.CONNECTEAM_TIME_CLOCK_ID;

  if (!timeClockId) {
    throw new Error("Missing CONNECTEAM_TIME_CLOCK_ID");
  }

  return timeClockId;
}