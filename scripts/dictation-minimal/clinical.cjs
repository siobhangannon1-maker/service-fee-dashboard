/* Actual unchanged OpenAI pipeline; synthetic fixture and local Storage/auth/database adapters. */
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  { harness, uid } = require("./harness.cjs");
const env = require("dotenv").parse(
    fs.readFileSync(path.resolve(__dirname, "../../.env.local")),
  ),
  OpenAI = require("openai").default;
(async () => {
  const fixture = process.argv[2];
  if (!fixture) throw Error("Synthetic WAV path required");
  const useStorage = process.argv.includes("--storage");
  const storageClient = useStorage
    ? require("@supabase/supabase-js").createClient(
        env.NEXT_PUBLIC_SUPABASE_URL,
        env.SUPABASE_SERVICE_ROLE_KEY,
        { auth: { persistSession: false, autoRefreshToken: false } },
      )
    : null;
  const bytes = fs.readFileSync(fixture),
    h = harness({
      realStorage: storageClient?.storage,
      storageOrigin: env.NEXT_PUBLIC_SUPABASE_URL,
      realAI: new OpenAI({
        apiKey: env.OPENAI_API_KEY,
        maxRetries: 0,
        timeout: 270000,
      }),
    });
  const context = {
    providerId: uid(2),
    patientFirstName: "Synthetic",
    patientLastName: "Fixture",
    patientDob: "",
    editorKey: "",
    draftId: null,
    recordingId: uid(6),
  };
  const upload = await (
    await h.call("/api/report-writing/dictation-upload", {
      context,
      size: bytes.length,
      mime: "audio/wav",
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    })
  ).json();
  let uploadMs = null;
  if (useStorage) {
    const reference = JSON.parse(
      Buffer.from(upload.reference.split(".")[0], "base64url").toString(),
    );
    fs.writeFileSync(
      "/private/tmp/dictation-minimal-storage-object.json",
      JSON.stringify(
        {
          bucket: "report-assets",
          path: reference.path,
          sha256: reference.sha256,
          bytes: bytes.length,
          syntheticOnly: true,
          deleted: false,
        },
        null,
        2,
      ),
    );
    const http = require("node:http"),
      { chromium } = require("playwright");
    const server = http.createServer((req, res) =>
      res.end("<p>Synthetic audio upload test</p>"),
    );
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      const begun = performance.now();
      const status = await page.evaluate(
        async ({ url, base64 }) => {
          const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
          return (
            await fetch(url, {
              method: "PUT",
              headers: { "Content-Type": "audio/wav", "x-upsert": "false" },
              body: bytes,
            })
          ).status;
        },
        { url: upload.signedUrl, base64: bytes.toString("base64") },
      );
      uploadMs = Math.round(performance.now() - begun);
      if (status !== 200) throw Error("Synthetic direct upload failed");
    } finally {
      await browser.close();
      server.close();
    }
  } else {
    h.state.objects.set(
      new URL(upload.signedUrl).pathname.slice("/storage/".length),
      bytes,
    );
  }
  const start = performance.now(),
    response = await h.call("/api/report-writing/transcribe", {
      context,
      reference: upload.reference,
    }),
    result = await response.json();
  if (!response.ok || !result.success)
    throw Error("Synthetic transcription did not complete");
  const text = result.text.toLowerCase(),
    facts = {
      noSuppuration: /no suppuration/.test(text),
      antibioticsNotIndicated: /antibiotics are not indicated/.test(text),
      doNotExtract17: /do not extract tooth 17/.test(text),
      eightMillimetres: /8mm/.test(text),
      sixWeekReview: /6 weeks|six weeks/.test(text),
      noDefinitiveSurgery: /no definitive surgical decision/.test(text),
    };
  const report = {
    syntheticOnly: true,
    storageAndIdentity: useStorage
      ? "Real private Supabase Storage; local identity/database fixtures"
      : "local adapters",
    uploadMs,
    realOpenAICalls: true,
    audioBytes: bytes.length,
    totalMs: Math.round(performance.now() - start),
    modelCalls: h.state.modelCalls,
    formatCalls: h.state.formatCalls,
    facts,
    rawText: result.rawText,
    text: result.text,
  };
  fs.writeFileSync(
    useStorage
      ? "/private/tmp/dictation-minimal-storage-clinical-results.json"
      : "/private/tmp/dictation-minimal-clinical-results.json",
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      ...report,
      rawText: "[synthetic result saved locally]",
      text: "[synthetic result saved locally]",
    }),
  );
  if (Object.values(facts).some((x) => !x)) process.exitCode = 1;
})().catch(() => {
  console.error(
    "Synthetic clinical test failed; credentials and provider details withheld.",
  );
  process.exitCode = 1;
});
