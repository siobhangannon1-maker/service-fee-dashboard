export type ProbeResult = {
  label: string;
  url: string;
  method: string;
  ok: boolean;
  status: number;
  contentType: string | null;
  responsePreview: string;
  parsedJson: any | null;
  error: string | null;
};

export type PraktikaEndpointHint = {
  source: string;
  kind: string;
  value: string;
};

export type PraktikaDiscoveryResult = {
  probes: ProbeResult[];
  discoveredScriptUrls: string[];
  discoveredApiHints: string[];
  endpointHints: PraktikaEndpointHint[];
};

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function safeJsonParse(text: string) {
  if (!text || !text.trim()) return null;

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function fetchText(url: string) {
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    headers: {
      Accept: "application/json, text/html;q=0.9, */*;q=0.8",
    },
  });

  const text = await response.text();

  return { response, text };
}

function makeProbeResult({
  label,
  url,
  response,
  text,
}: {
  label: string;
  url: string;
  response: Response;
  text: string;
}): ProbeResult {
  return {
    label,
    url,
    method: "GET",
    ok: response.ok,
    status: response.status,
    contentType: response.headers.get("content-type"),
    responsePreview: text ? text.slice(0, 4000) : "[empty response]",
    parsedJson: safeJsonParse(text),
    error: null,
  };
}

async function probeUrl(label: string, url: string): Promise<ProbeResult> {
  try {
    const { response, text } = await fetchText(url);

    return makeProbeResult({
      label,
      url,
      response,
      text,
    });
  } catch (error) {
    return {
      label,
      url,
      method: "GET",
      ok: false,
      status: 0,
      contentType: null,
      responsePreview: "",
      parsedJson: null,
      error: error instanceof Error ? error.message : "Request failed.",
    };
  }
}

function extractScriptUrls(html: string, baseUrl: string) {
  const urls = new Set<string>();

  const quotedRegex = /<script[^>]+src=["']([^"']+)["']/gi;
  const unquotedRegex = /<script[^>]+src=([^>\s]+)[^>]*>/gi;

  let match: RegExpExecArray | null;

  while ((match = quotedRegex.exec(html))) {
    urls.add(new URL(match[1], baseUrl).toString());
  }

  while ((match = unquotedRegex.exec(html))) {
    const raw = match[1].replace(/["']/g, "").trim();
    if (raw) urls.add(new URL(raw, baseUrl).toString());
  }

  return Array.from(urls);
}

function addHint(
  hints: PraktikaEndpointHint[],
  source: string,
  kind: string,
  value: string,
) {
  const cleaned = value.trim();

  if (!cleaned) return;
  if (cleaned.length > 300) return;

  hints.push({
    source,
    kind,
    value: cleaned,
  });
}

function extractEndpointHints(jsText: string, source: string) {
  const hints: PraktikaEndpointHint[] = [];

  const quotedStrings =
    jsText.match(/["'`]([^"'`]{2,300})["'`]/g)?.map((value) =>
      value.slice(1, -1),
    ) || [];

  for (const value of quotedStrings) {
    const lower = value.toLowerCase();

    if (
      lower.includes("api") ||
      lower.includes("patient") ||
      lower.includes("appointment") ||
      lower.includes("booking") ||
      lower.includes("provider") ||
      lower.includes("practitioner") ||
      lower.includes("clinic") ||
      lower.includes("location") ||
      lower.includes("treatment") ||
      lower.includes("service") ||
      lower.includes("calendar") ||
      lower.includes("availability")
    ) {
      addHint(hints, source, "string", value);
    }
  }

  const regexPatterns: Array<{ kind: string; regex: RegExp }> = [
    {
      kind: "absolute-url",
      regex: /https?:\/\/[^"'`\s)\\]+/gi,
    },
    {
      kind: "api-path",
      regex: /\/api\/[^"'`\s)\\]+/gi,
    },
    {
      kind: "online-booking-path",
      regex: /\/online-booking\/[^"'`\s)\\]+/gi,
    },
    {
      kind: "possible-path",
      regex:
        /\/(?:patient|patients|appointment|appointments|booking|bookings|provider|providers|practitioner|practitioners|clinic|clinics|location|locations|treatment|treatments|service|services|availability|calendar)[^"'`\s)\\]*/gi,
    },
    {
      kind: "axios-or-http",
      regex: /(?:axios|this\.\$http|fetch|post|get|put|delete)\s*\([^)]{0,200}/gi,
    },
    {
      kind: "base-url",
      regex: /baseURL\s*[:=]\s*["'`][^"'`]+["'`]/gi,
    },
  ];

  for (const pattern of regexPatterns) {
    const matches = jsText.match(pattern.regex) || [];
    for (const match of matches) {
      addHint(hints, source, pattern.kind, match);
    }
  }

  return hints;
}

function uniqueEndpointHints(hints: PraktikaEndpointHint[]) {
  const seen = new Set<string>();
  const unique: PraktikaEndpointHint[] = [];

  for (const hint of hints) {
    const key = `${hint.source}|${hint.kind}|${hint.value}`;
    if (seen.has(key)) continue;

    seen.add(key);
    unique.push(hint);
  }

  return unique.sort((a, b) => {
    const valueCompare = a.value.localeCompare(b.value);
    if (valueCompare !== 0) return valueCompare;
    return a.kind.localeCompare(b.kind);
  });
}

export async function runPraktikaDiscoveryProbe(): Promise<PraktikaDiscoveryResult> {
  const apiKey = requireEnv("PRAKTIKA_API_KEY");

  const baseUrl =
    process.env.PRAKTIKA_BASE_URL || "https://appointments.praktika.net.au";

  const bookingUrl = `${baseUrl}/online-booking/step1?Apikey=${encodeURIComponent(
    apiKey,
  )}`;

  const probes: ProbeResult[] = [];
  const discoveredScriptUrls: string[] = [];
  const endpointHints: PraktikaEndpointHint[] = [];

  const bookingFetch = await fetchText(bookingUrl);

  probes.push(
    makeProbeResult({
      label: "Online booking app",
      url: bookingUrl,
      response: bookingFetch.response,
      text: bookingFetch.text,
    }),
  );

  const scripts = extractScriptUrls(bookingFetch.text, baseUrl);

  for (const scriptUrl of scripts) {
    discoveredScriptUrls.push(scriptUrl);

    const scriptProbe = await probeUrl(`Script ${scriptUrl}`, scriptUrl);
    probes.push(scriptProbe);

    try {
      const scriptFetch = await fetchText(scriptUrl);
      endpointHints.push(...extractEndpointHints(scriptFetch.text, scriptUrl));
    } catch {
      // Keep discovery resilient.
    }
  }

  const uniqueHints = uniqueEndpointHints(endpointHints);

  return {
    probes,
    discoveredScriptUrls: Array.from(new Set(discoveredScriptUrls)),
    discoveredApiHints: uniqueHints.map((hint) => hint.value),
    endpointHints: uniqueHints,
  };
}