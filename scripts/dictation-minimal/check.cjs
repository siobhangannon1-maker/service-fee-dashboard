const fs = require("node:fs"),
  http = require("node:http"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto");
const { build } = require("esbuild"),
  { chromium, firefox, webkit } = require("playwright"),
  { harness, uid } = require("./harness.cjs");
(async () => {
  const h = harness(),
    { state } = h;
  const body = Buffer.alloc(5_000_000, 7),
    context = {
      providerId: uid(2),
      patientFirstName: "Synthetic",
      patientLastName: "Fixture",
      patientDob: "",
      editorKey: "",
      draftId: null,
      recordingId: uid(6),
    };
  const input = {
    context,
    size: body.length,
    mime: "audio/webm",
    sha256: crypto.createHash("sha256").update(body).digest("hex"),
  };
  const signed = await (
    await h.call("/api/report-writing/dictation-upload", input)
  ).json();
  assert.ok(signed.reference);
  assert.equal(
    (
      await h.call("/api/report-writing/transcribe", {
        context,
        reference: signed.reference,
      })
    ).status,
    404,
  );
  const objectPath = new URL(signed.signedUrl).pathname.slice(
    "/storage/".length,
  );
  state.objects.set(objectPath, body);
  assert.equal(
    (
      await h.call("/api/report-writing/transcribe", {
        context,
        reference: signed.reference,
      })
    ).status,
    200,
  );
  const originalRequests = state.providerRequests.slice(-2);
  const legacyForm = new FormData();
  legacyForm.set(
    "audio",
    new File([body], "synthetic.webm", { type: "audio/webm" }),
  );
  legacyForm.set("patientFirstName", "Synthetic");
  legacyForm.set("patientLastName", "Fixture");
  const legacyResponse = await h
    .load("app/api/report-writing/transcribe/route")
    .POST(
      new Request(state.origin + "/legacy", {
        method: "POST",
        body: legacyForm,
      }),
    );
  assert.equal(legacyResponse.status, 200);
  assert.deepEqual(state.providerRequests.slice(-2), originalRequests);
  for (const changed of [
    { ...context, patientLastName: "Different" },
    { ...context, patientDob: "1980-01-01" },
    { ...context, editorKey: "another-letter" },
    { ...context, providerId: uid(4) },
    { ...context, recordingId: uid(7) },
  ])
    assert.equal(
      (
        await h.call("/api/report-writing/transcribe", {
          context: changed,
          reference: signed.reference,
        })
      ).status,
      403,
    );
  state.actor = uid(3);
  assert.equal(
    (
      await h.call("/api/report-writing/transcribe", {
        context,
        reference: signed.reference,
      })
    ).status,
    403,
  );
  state.actor = null;
  assert.equal(
    (
      await h.call("/api/report-writing/transcribe", {
        context,
        reference: signed.reference,
      })
    ).status,
    401,
  );
  state.actor = uid(1);
  assert.equal(
    (
      await h.call(
        "/api/report-writing/dictation-upload",
        input,
        "https://other.invalid",
      )
    ).status,
    403,
  );
  state.objects.set(objectPath, Buffer.alloc(body.length, 8));
  assert.equal(
    (
      await h.call("/api/report-writing/transcribe", {
        context,
        reference: signed.reference,
      })
    ).status,
    409,
  );
  console.log(
    "PASS actual route source: authorised reference round trip, missing audio, owner/provider/patient/recording/origin denials and hash mismatch",
  );
  const bundle = await build({
    entryPoints: [path.join(__dirname, "browser-entry.tsx")],
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
    tsconfig: path.resolve(__dirname, "../../tsconfig.json"),
  });
  const server = http.createServer(async (req, res) => {
    try {
      if (req.url === "/bundle.js") {
        res.setHeader("Content-Type", "application/javascript");
        return res.end(bundle.outputFiles[0].text);
      }
      if (req.method === "PUT" && req.url.startsWith("/storage/")) {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const p = req.url.slice("/storage/".length);
        state.uploads++;
        if (state.objects.has(p)) {
          res.writeHead(400);
          return res.end("{}");
        }
        state.objects.set(p, Buffer.concat(chunks));
        return res.end("{}");
      }
      if (req.method === "POST") {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const bytes = Buffer.concat(chunks);
        state.requests.push({ path: req.url, bytes: bytes.length });
        const r = await h.call(req.url, JSON.parse(bytes), req.headers.origin);
        res.writeHead(r.status, { "Content-Type": "application/json" });
        return res.end(await r.text());
      }
      res.setHeader("Content-Type", "text/html");
      res.end('<div id="root"></div><script src="/bundle.js"></script>');
    } catch {
      res.writeHead(500);
      res.end("{}");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  state.origin = `http://127.0.0.1:${server.address().port}`;
  const results = [];
  try {
    for (const [name, engine] of Object.entries({
      chromium,
      firefox,
      webkit,
    })) {
      const browser = await engine.launch({ headless: true });
      try {
        const page = await browser.newPage({ acceptDownloads: true });
        await page.addInitScript(() => {
          Object.defineProperty(navigator, "mediaDevices", {
            value: {
              getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }),
            },
          });
          class Recorder {
            static isTypeSupported() {
              return true;
            }
            constructor() {
              this.state = "inactive";
              this.mimeType = "audio/webm";
            }
            start() {
              this.state = "recording";
            }
            pause() {
              this.state = "paused";
            }
            resume() {
              this.state = "recording";
            }
            stop() {
              this.state = "inactive";
              this.ondataavailable?.({
                data: new Blob([new Uint8Array(5_000_000).fill(7)], {
                  type: "audio/webm",
                }),
              });
              this.onstop?.();
            }
          }
          window.MediaRecorder = Recorder;
        });
        const start = async () => {
          await page
            .getByRole("button", { name: "Start Dictation", exact: true })
            .click();
          await page
            .getByRole("button", { name: "Pause", exact: true })
            .click();
          await page
            .getByRole("button", { name: "Resume", exact: true })
            .click();
          await page
            .getByRole("button", { name: "Stop and Save Draft" })
            .click();
        };
        await page.goto(state.origin);
        state.failModel = false;
        await start();
        await page.waitForFunction(() =>
          document.querySelector("#letter")?.textContent?.includes("Tooth 16"),
        );
        assert.equal(await page.evaluate(() => window.appliedCount), 1);
        assert.equal(
          await page
            .getByRole("button", { name: "Download recording" })
            .count(),
          0,
        );
        await page.reload();
        state.failModel = true;
        const before = state.uploads;
        await start();
        await page
          .getByRole("status")
          .filter({ hasText: "did not complete" })
          .waitFor();
        const downloadPromise = page.waitForEvent("download");
        await page.getByRole("button", { name: "Download recording" }).click();
        const download = await downloadPromise;
        assert.equal(fs.statSync(await download.path()).size, 5_000_000);
        await page.evaluate(() =>
          window.editLetter("Existing clinical letter"),
        );
        state.failModel = false;
        await page.getByRole("button", { name: "Retry transcription" }).click();
        await page.getByLabel("Transcription for review").waitFor();
        assert.equal(
          await page.locator("#letter").textContent(),
          "Existing clinical letter",
        );
        assert.equal(state.uploads - before, 1);
        // A changed patient must block retry before a request is sent.
        await page.evaluate(() => window.changePatient("Other"));
        const calls = state.modelCalls;
        await page.getByRole("button", { name: "Retry transcription" }).click();
        await page
          .getByRole("status")
          .filter({ hasText: "original patient" })
          .waitFor();
        assert.equal(state.modelCalls, calls);
        page.on("dialog", (dialog) => dialog.accept());
        await page.reload();
        state.delayModel = 250;
        await start();
        await page.evaluate(() =>
          window.editLetter("Edited while transcribing"),
        );
        await page.getByLabel("Transcription for review").waitFor();
        assert.equal(
          await page.locator("#letter").textContent(),
          "Edited while transcribing",
        );
        state.delayModel = 0;
        // A failed direct upload retains a downloadable recording and can be retried without recording again.
        await page.reload();
        await page.route("**/storage/**", (route) => route.abort());
        await start();
        await page
          .getByRole("status")
          .filter({ hasText: "upload was interrupted" })
          .waitFor();
        const failedDownloadPromise = page.waitForEvent("download");
        await page.getByRole("button", { name: "Download recording" }).click();
        assert.equal(
          fs.statSync(await (await failedDownloadPromise).path()).size,
          5_000_000,
        );
        await page.unroute("**/storage/**");
        await page.getByRole("button", { name: "Retry transcription" }).click();
        await page.getByLabel("Transcription for review").waitFor();
        assert.equal(await page.locator("#letter").textContent(), "");
        await page
          .getByRole("button", { name: "Insert reviewed transcription" })
          .click();
        assert.match(await page.locator("#letter").textContent(), /Tooth 16/);
        assert.equal(await page.evaluate(() => window.appliedCount), 1);
        assert.ok(state.requests.every((r) => r.bytes < 16384));
        results.push({
          browser: name,
          passed: true,
          normalSuccessCallbackOnce: true,
          pauseResume: true,
          downloadBytes: 5_000_000,
          metadataOnly: true,
          retryUploads: 1,
        });
        console.log(
          "PASS",
          name,
          "5 MB direct upload, retained download, retry without re-upload, editor preservation and patient-switch protection",
        );
      } finally {
        await browser.close();
      }
    }
  } finally {
    server.close();
  }
  fs.writeFileSync(
    "/private/tmp/dictation-minimal-browser-results.json",
    JSON.stringify(results, null, 2),
  );
})().catch((e) => {
  console.error(e.stack);
  process.exitCode = 1;
});
