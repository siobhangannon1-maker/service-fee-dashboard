import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  createAudioReference,
  signAudioReference,
  verifyAudioReference,
} from "./dictation-upload-token";
import {
  DICTATION_MAX_BYTES,
  DictationContext,
} from "./dictation-upload-contract";
import {
  transcribeRetained,
  RetainedRecording,
} from "./dictation-upload-client";
const owner = randomUUID(),
  secret = "synthetic-test-signing-key",
  context: DictationContext = {
    providerId: randomUUID(),
    patientFirstName: "Synthetic",
    patientLastName: "Fixture",
    patientDob: "",
    editorKey: "",
    draftId: null,
    recordingId: randomUUID(),
  };
const reference = () =>
  createAudioReference(owner, context, 100, "audio/webm", "a".repeat(64));
test("reference binds owner, provider, patient, draft and recording; names never enter object paths", () => {
  const r = reference(),
    token = signAudioReference(r, secret);
  assert.equal(
    verifyAudioReference(token, owner, context, secret).path,
    r.path,
  );
  assert.ok(!r.path.includes("Synthetic"));
  for (const target of [
    { ...context, providerId: randomUUID() },
    { ...context, patientFirstName: "Other" },
    { ...context, patientDob: "1980-01-01" },
    { ...context, editorKey: "another-letter" },
    { ...context, draftId: randomUUID() },
    { ...context, recordingId: randomUUID() },
  ])
    assert.throws(() => verifyAudioReference(token, owner, target, secret));
  assert.throws(() =>
    verifyAudioReference(token, randomUUID(), context, secret),
  );
  assert.throws(() =>
    verifyAudioReference(token, owner, context, secret, r.expires),
  );
  assert.throws(() =>
    verifyAudioReference(token + "x", owner, context, secret),
  );
  const payload = Buffer.from(
    JSON.stringify({ ...r, path: "other/audio.webm" }),
  ).toString("base64url");
  assert.throws(() =>
    verifyAudioReference(
      payload + "." + token.split(".")[1],
      owner,
      context,
      secret,
    ),
  );
});
test("oversized or unsupported audio cannot get upload authority", () => {
  assert.throws(() =>
    createAudioReference(owner, context, 100, "__proto__", "a".repeat(64)),
  );
  assert.throws(() =>
    createAudioReference(
      owner,
      context,
      DICTATION_MAX_BYTES + 1,
      "audio/webm",
      "a".repeat(64),
    ),
  );
  assert.throws(() =>
    createAudioReference(owner, context, 100, "text/html", "a".repeat(64)),
  );
  assert.throws(() =>
    createAudioReference(owner, context, 0, "audio/webm", "a".repeat(64)),
  );
});
test("retry reuses the uploaded audio and preserves it after model failure", async () => {
  const old = global.fetch,
    take: RetainedRecording = {
      audio: new Blob(["synthetic"], { type: "audio/webm" }),
      context,
      reference: "test-token",
      uploaded: true,
    };
  let requests = 0;
  global.fetch = async (input, init) => {
    assert.equal(input, "/api/report-writing/transcribe");
    assert.ok(String(init?.body).includes("test-token"));
    requests++;
    return Response.json(
      requests === 1
        ? { success: false, code: "TRANSCRIPTION_FAILED", error: "Retry" }
        : { success: true, text: "No extraction planned." },
      { status: requests === 1 ? 502 : 200 },
    );
  };
  try {
    await assert.rejects(transcribeRetained(take, context));
    assert.equal(take.audio.size, 9);
    assert.equal(
      await transcribeRetained(take, context),
      "No extraction planned.",
    );
    assert.equal(requests, 2);
  } finally {
    global.fetch = old;
  }
});
test("lost upload response recovers through verification without a second PUT", async () => {
  const old = global.fetch,
    take: RetainedRecording = {
      audio: new Blob(["synthetic"], { type: "audio/webm" }),
      context,
      uploaded: false,
    };
  let puts = 0,
    signs = 0;
  global.fetch = async (input) => {
    if (input === "/api/report-writing/dictation-upload") {
      signs++;
      return Response.json({
        success: true,
        reference: "signed-token",
        signedUrl: "https://synthetic.test/upload",
      });
    }
    if (input === "https://synthetic.test/upload") {
      puts++;
      throw Error("network lost after storage accepted");
    }
    return Response.json({ success: true, text: "Retained result" });
  };
  try {
    await assert.rejects(transcribeRetained(take, context), /interrupted/);
    assert.equal(take.reference, "signed-token");
    assert.equal(await transcribeRetained(take, context), "Retained result");
    assert.equal(puts, 1);
    assert.equal(signs, 1);
  } finally {
    global.fetch = old;
  }
});
test("non-JSON 413 preserves recording and changed context makes no request", async () => {
  const old = global.fetch,
    take: RetainedRecording = {
      audio: new Blob(["synthetic"]),
      context,
      reference: "token",
      uploaded: true,
    };
  let calls = 0;
  global.fetch = async () => {
    calls++;
    return new Response("Request too large", { status: 413 });
  };
  try {
    await assert.rejects(
      transcribeRetained(take, context),
      /recording is kept/,
    );
    await assert.rejects(
      transcribeRetained(take, { ...context, patientLastName: "Other" }),
      /original patient/,
    );
    assert.equal(calls, 1);
    assert.equal(take.audio.size, 9);
  } finally {
    global.fetch = old;
  }
});
test("clinical prompts and models still match the previously validated snapshot", () => {
  const source = readFileSync(
      "app/api/report-writing/transcribe/route.ts",
      "utf8",
    ),
    snapshot = JSON.parse(
      readFileSync(
        "scripts/dictation-minimal/clinical-prompts.fixture.json",
        "utf8",
      ),
    ) as { templates: string[] };
  const templates = (s: string) =>
    [...s.matchAll(/`([\s\S]*?)`/g)].map((m) => m[1]);
  for (const t of snapshot.templates) assert.ok(templates(source).includes(t));
  assert.match(source, /model: "gpt-4o-transcribe"/);
  assert.match(source, /model: "gpt-4.1-mini"/);
  assert.match(source, /temperature: 0/);
});
