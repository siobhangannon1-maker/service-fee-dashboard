const BASE_URL =
  process.env.PRAKTIKA_BASE_URL || "https://appointments.praktika.net.au";

const API_KEY = process.env.PRAKTIKA_API_KEY || "";
const AUTH_KEY = process.env.PRAKTIKA_AUTH_KEY || "";

const BASE_API = `${BASE_URL}/php/onlineBookingV2`;

const PRACTICE_ID = "3434376";

/*
Dr William Huynh (Medical)
*/
const STAFF_ID = "3434380";

/*
COORPAROO Wisdom Teeth Consultation
*/
const APPOINTMENT_TYPE_ID = "5058702";

export type EndpointTestResult = {
  endpoint: string;
  ok: boolean;
  status: number;
  responsePreview: string;
  parsedJson: any;
  error: string | null;
};

function appendDefaultAuth(form: FormData) {
  form.append("apikey", API_KEY);

  if (AUTH_KEY) {
    form.append("authkey", AUTH_KEY);
  }
}

async function safePostRequest(
  endpoint: string,
  body?: Record<string, any>,
): Promise<EndpointTestResult> {
  try {
    const form = new FormData();

    appendDefaultAuth(form);

    if (body) {
      Object.entries(body).forEach(([key, value]) => {
        form.append(key, String(value));
      });
    }

    const response = await fetch(`${BASE_API}/${endpoint}`, {
      method: "POST",
      headers: {
        Accept: "application/json, text/plain, */*",
      },
      body: form,
      cache: "no-store",
    });

    const text = await response.text();

    let parsedJson: any = null;

    try {
      parsedJson = JSON.parse(text);
    } catch {
      parsedJson = null;
    }

    return {
      endpoint,
      ok: response.ok,
      status: response.status,
      responsePreview: text.slice(0, 4000),
      parsedJson,
      error: null,
    };
  } catch (error) {
    return {
      endpoint,
      ok: false,
      status: 0,
      responsePreview: "",
      parsedJson: null,
      error: error instanceof Error ? error.message : "Request failed",
    };
  }
}

export async function runPraktikaEndpointTests() {
  const results: EndpointTestResult[] = [];

  results.push(
    await safePostRequest("db_getCustomerDetails.php"),
  );

  results.push(
    await safePostRequest("db_search.php", {
      practice_id: PRACTICE_ID,
      staff_id: STAFF_ID,
      appointment_type_id: APPOINTMENT_TYPE_ID,
      start_date: new Date().toISOString().slice(0, 10),
      end_date: new Date(
        Date.now() + 14 * 24 * 60 * 60 * 1000,
      )
        .toISOString()
        .slice(0, 10),
    }),
  );

  return results;
}