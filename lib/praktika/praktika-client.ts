import { withPraktikaAutoRefresh } from "@/lib/praktika/hybrid-seamless-request";
import {
  getCurrentUserPraktikaSessionMode,
  getPraktikaCookie,
} from "@/lib/praktika/hybrid-session-store";

const PRAKTIKA_BASE_URL = "https://praktika.praktika.net.au";

type PraktikaRequestOptions = {
  path: string;
  body: unknown;
  contentType?: "json" | "form";
  referer?: string;
};

export async function praktikaPost<T>({
  path,
  body,
  contentType = "json",
  referer = `${PRAKTIKA_BASE_URL}/v2/patient-directory/patient-search`,
}: PraktikaRequestOptions): Promise<T> {
  const mode = await getCurrentUserPraktikaSessionMode();

  return await withPraktikaAutoRefresh(
    async () => {
      const cookie = await getPraktikaCookie(mode);

      const headers: HeadersInit = {
        accept: "application/json, text/plain, */*",
        cookie,
        origin: PRAKTIKA_BASE_URL,
        referer,
      };

      let requestBody: BodyInit;

      if (contentType === "form") {
        headers["content-type"] = "application/x-www-form-urlencoded";

        const params = new URLSearchParams();

        Object.entries(body as Record<string, any>).forEach(([key, value]) => {
          if (Array.isArray(value)) {
            value.forEach((item) => params.append(key, String(item)));
          } else if (value !== undefined && value !== null) {
            params.append(key, String(value));
          }
        });

        requestBody = params.toString();
      } else {
        headers["content-type"] = "application/json";
        requestBody = JSON.stringify(body);
      }

      const response = await fetch(`${PRAKTIKA_BASE_URL}${path}`, {
        method: "POST",
        headers,
        body: requestBody,
        cache: "no-store",
      });

      const text = await response.text();

      if (!response.ok) {
        throw new Error(`Praktika request failed: ${response.status} ${text}`);
      }

      try {
        return JSON.parse(text) as T;
      } catch {
        throw new Error(`Praktika returned non-JSON response: ${text}`);
      }
    },
    { mode }
  );
}