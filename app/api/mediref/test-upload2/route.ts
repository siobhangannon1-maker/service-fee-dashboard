import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MEDIREF_BASE_URL = "https://www.mediref.com.au";
const PRACTICE_ID = "ayjWHBhgAZyCsJ4fG";

function randomId(length = 24) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";

  let value = "";

  for (let i = 0; i < length; i += 1) {
    value += chars[Math.floor(Math.random() * chars.length)];
  }

  return value;
}

function encodeRemotePayload(value: unknown) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function makeTinyPdfBuffer() {
  const pdfText = [
    "%PDF-1.4",
    "1 0 obj",
    "<< /Type /Catalog /Pages 2 0 R >>",
    "endobj",
    "2 0 obj",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "endobj",
    "3 0 obj",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    "endobj",
    "4 0 obj",
    "<< /Length 62 >>",
    "stream",
    "BT /F1 18 Tf 40 80 Td (DocuDental MediRef upload test) Tj ET",
    "endstream",
    "endobj",
    "5 0 obj",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "endobj",
    "trailer",
    "<< /Root 1 0 R >>",
    "%%EOF",
  ].join("\n");

  return Buffer.from(pdfText, "utf8");
}

async function postMedirefRemote(params: {
  path: string;
  payload: unknown;
  cookie: string;
  s3uuid: string;
}) {
  const { path, payload, cookie, s3uuid } = params;

  return fetch(`${MEDIREF_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      accept: "*/*",
      "content-type": "application/json",
      cookie,
      origin: MEDIREF_BASE_URL,
      referer: `${MEDIREF_BASE_URL}/compose/${s3uuid}`,
      "x-sveltekit-pathname": `/compose/${s3uuid}`,
      "x-sveltekit-search": "",
    },
    body: JSON.stringify({
      payload: encodeRemotePayload(payload),
      refreshes: [],
    }),
  });
}

async function parseResponse(response: Response) {
  const text = await response.text();

  let outer: any = null;
  let inner: any = null;

  try {
    outer = JSON.parse(text);

    if (outer && typeof outer.result === "string") {
      inner = JSON.parse(outer.result);
    }
  } catch {
    // Return raw text below.
  }

  return { text, outer, inner };
}

export async function POST() {
  const cookie = process.env.MEDIREF_SESSION_COOKIE;

  if (!cookie) {
    return NextResponse.json(
      {
        success: false,
        error: "Missing MEDIREF_SESSION_COOKIE in .env.local",
      },
      { status: 500 },
    );
  }

  const s3uuid = randomId();
  const uploadId = randomId();
  const s3Key = `${PRACTICE_ID}/${s3uuid}/${uploadId}`;
  const filename = "DocuDental MediRef Upload Test.pdf";
  const contentType = "application/pdf";
  const pdfBuffer = makeTinyPdfBuffer();

  try {
    const composeResponse = await fetch(
      `${MEDIREF_BASE_URL}/compose/${s3uuid}/__data.json?x-sveltekit-invalidated=0101`,
      {
        method: "GET",
        headers: {
          accept: "*/*",
          cookie,
          "cache-control": "no-cache",
        },
      },
    );

    const composeText = await composeResponse.text();

    if (!composeResponse.ok || composeText.includes("/login")) {
      return NextResponse.json(
        {
          success: false,
          step: "compose",
          status: composeResponse.status,
          response: composeText.slice(0, 1000),
        },
        { status: 500 },
      );
    }

    const savePayload = [
      {
        s3uuid: 1,
        patient: 2,
        recipients: 6,
        files: 7,
        recipientMsg: 4,
      },
      s3uuid,
      {
        name: 3,
        dob: 4,
        ptEmail: 4,
        extraPwType: 5,
        customPw: 4,
        pwHint: 4,
        ptMsg: 4,
      },
      "DocuDental Upload Test",
      "",
      "none",
      [],
      [],
    ];

    const saveResponse = await postMedirefRemote({
      path: "/_app/remote/fd8vn1/saveDraft",
      payload: savePayload,
      cookie,
      s3uuid,
    });

    const saveParsed = await parseResponse(saveResponse);

    if (!saveResponse.ok || saveParsed.text.includes("/login")) {
      return NextResponse.json(
        {
          success: false,
          step: "saveDraft",
          status: saveResponse.status,
          response: saveParsed.text,
        },
        { status: 500 },
      );
    }

    const uploadParamsPayload = [
      {
        key: 1,
        type: 2,
        filename: 3,
      },
      s3Key,
      contentType,
      filename,
    ];

    const uploadParamsResponse = await postMedirefRemote({
      path: "/_app/remote/1wqh9sd/getUploadParameters",
      payload: uploadParamsPayload,
      cookie,
      s3uuid,
    });

    const uploadParamsParsed = await parseResponse(uploadParamsResponse);

    const signedUploadUrl =
      Array.isArray(uploadParamsParsed.inner) &&
      typeof uploadParamsParsed.inner[0] === "string"
        ? uploadParamsParsed.inner[0]
        : "";

    if (!uploadParamsResponse.ok || !signedUploadUrl) {
      return NextResponse.json(
        {
          success: false,
          step: "getUploadParameters",
          status: uploadParamsResponse.status,
          rawResponse: uploadParamsParsed.text,
          parsedResponse: uploadParamsParsed.inner,
        },
        { status: 500 },
      );
    }

    const uploadResponse = await fetch(signedUploadUrl, {
      method: "PUT",
      headers: {
        "content-type": contentType,
      },
      body: pdfBuffer,
    });

    const uploadResponseText = await uploadResponse.text().catch(() => "");

    const deletePayload = [{ s3uuid: 1 }, s3uuid];

    const deleteResponse = await postMedirefRemote({
      path: "/_app/remote/143lgbm/deleteDraft",
      payload: deletePayload,
      cookie,
      s3uuid,
    });

    const deleteParsed = await parseResponse(deleteResponse);

    return NextResponse.json({
      success: uploadResponse.ok,
      s3uuid,
      s3Key,
      filename,
      contentType,
      fileSize: pdfBuffer.length,
      composeStatus: composeResponse.status,
      saveStatus: saveResponse.status,
      saveResponse: saveParsed.text,
      uploadParamsStatus: uploadParamsResponse.status,
      uploadParamsResponse: uploadParamsParsed.text,
      s3UploadStatus: uploadResponse.status,
      s3UploadOk: uploadResponse.ok,
      s3UploadResponse: uploadResponseText.slice(0, 500),
      deleteStatus: deleteResponse.status,
      deleteResponse: deleteParsed.text,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        s3uuid,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

export async function GET() {
  return POST();
}