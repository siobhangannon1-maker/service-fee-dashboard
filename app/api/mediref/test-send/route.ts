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
    "<< /Length 54 >>",
    "stream",
    "BT /F1 18 Tf 40 80 Td (MediRef send test) Tj ET",
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
    // Keep raw text for debugging.
  }

  return { text, outer, inner };
}

export async function POST() {
  const cookie = process.env.MEDIREF_SESSION_COOKIE;

  if (!cookie) {
    return NextResponse.json(
      { success: false, error: "Missing MEDIREF_SESSION_COOKIE in .env.local" },
      { status: 500 },
    );
  }

  const s3uuid = randomId();
  const uploadId = randomId();
  const s3Key = `${PRACTICE_ID}/${s3uuid}/${uploadId}`;

  const patientName = "testing testing";
  const patientDob = "2001-01-01";
  const patientEmail = "siobhangannon1@gmail.com";

  const filename = "DocuDental MediRef Send Test.pdf";
  const filenameWithoutExt = "DocuDental MediRef Send Test";
  const contentType = "application/pdf";
  const pdfBuffer = makeTinyPdfBuffer();

  try {
    await fetch(
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

    const savePayload = [
      {
        s3uuid: 1,
        patient: 2,
        recipients: 8,
        files: 69,
        recipientMsg: 7,
        clientGreetingPeriod: 83,
        externalRecipientReview: -1,
      },
      s3uuid,
      {
        name: 3,
        dob: 4,
        ptEmail: 5,
        extraPwType: 6,
        customPw: 7,
        pwHint: 7,
        ptMsg: 7,
      },
      patientName,
      patientDob,
      patientEmail,
      "none",
      "",
      [9],
      {
        recipientId: 10,
        practiceName: 11,
        doctors: 12,
        address: 59,
        phone: 64,
        status: 67,
        email: 68,
      },
      PRACTICE_ID,
      "Focus Dental Specialists",
      [13, 19, 24, 28, 32, 36, 40, 44, 48, 52, 55],
      { id: 14, title: 15, firstName: 16, lastName: 17, type: 18 },
      "P8kfS59YXnevL3eFj",
      "Dr",
      "Siobhan",
      "Gannon",
      "Periodontist",
      { id: 20, title: 15, firstName: 21, lastName: 22, type: 23 },
      "QJB7mdybGHxNbh52z",
      "Jameel",
      "Kaderbhai",
      "Oral and maxillofacial surgeon",
      { id: 25, title: 15, firstName: 26, lastName: 27, type: 23 },
      "rpxB2HqFhJu96fQMx",
      "William",
      "Huynh",
      { id: 29, title: 15, firstName: 30, lastName: 31, type: 23 },
      "i5v7PoMTHMoRNYizZ",
      "Omar",
      "Breik",
      { id: 33, title: 15, firstName: 34, lastName: 35, type: 18 },
      "7AyNAaD8Z8yjEWxEo",
      "Thomas",
      "Briggs",
      { id: 37, title: 15, firstName: 38, lastName: 39, type: 23 },
      "kByBWarK8C8yJP34u",
      "Jaewon",
      "Heo",
      { id: 41, title: 15, firstName: 42, lastName: 43, type: 18 },
      "zYZBg6nS42Fiu9SNn",
      "Troy",
      "McGowan",
      { id: 45, title: 15, firstName: 46, lastName: 47, type: 23 },
      "EfZi2RKHCFPYKPGmT",
      "Benjamin",
      "Fu",
      { id: 49, title: 15, firstName: 50, lastName: 51, type: 18 },
      "bCqeF5Lcpf8vLS3Yz",
      "Lisetta",
      "Lam",
      { id: 53, title: 15, firstName: 34, lastName: 54, type: 18 },
      "zANdyyJkXpk3taaLG",
      "Young",
      { id: 56, title: 15, firstName: 57, lastName: 58, type: 18 },
      "XLDcDbtwSSk2ffitf",
      "Jenny",
      "Wang",
      { postCode: 60, state: 61, street: 62, suburb: 63 },
      "4151",
      "QLD",
      "7/377 Cavendish Rd",
      "Coorparoo",
      { number: 65, areaCode: 66 },
      "3077 9620",
      "07",
      "mediref",
      "hello@focusds.com.au",
      [70],
      {
        key: 71,
        originalName: 72,
        customName: 73,
        ext: 74,
        type: 75,
        size: 76,
        status: 77,
        progress: 78,
        uploadAttempts: 81,
        uploadId: 82,
        s3key: 71,
      },
      s3Key,
      filename,
      filenameWithoutExt,
      ".pdf",
      contentType,
      pdfBuffer.length,
      "complete",
      {
        uploadStarted: 79,
        bytesUploaded: 76,
        bytesTotal: 76,
        percentage: 80,
      },
      Date.now(),
      100,
      0,
      `docudental-test-${Date.now()}`,
      "evening",
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
          response: uploadParamsParsed.text,
          parsed: uploadParamsParsed.inner,
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

    const uploadText = await uploadResponse.text().catch(() => "");

    if (!uploadResponse.ok) {
      return NextResponse.json(
        {
          success: false,
          step: "s3Upload",
          status: uploadResponse.status,
          response: uploadText,
        },
        { status: 500 },
      );
    }

    const sendResponse = await postMedirefRemote({
      path: "/_app/remote/r6r93r/sendCorrespondence",
      payload: savePayload,
      cookie,
      s3uuid,
    });

    const sendParsed = await parseResponse(sendResponse);

    const medirefSendSuccess =
      Array.isArray(sendParsed.inner) &&
      sendParsed.inner.length > 0 &&
      sendParsed.inner[0]?.success === 1;

    return NextResponse.json({
      success: medirefSendSuccess,
      correspondenceId: Array.isArray(sendParsed.inner)
        ? sendParsed.inner[0]?.correspondenceId
        : null,
      s3uuid,
      s3Key,
      patientName,
      patientDob,
      patientEmail,
      recipient: "Focus Dental Specialists",
      filename,
      fileSize: pdfBuffer.length,
      saveStatus: saveResponse.status,
      uploadParamsStatus: uploadParamsResponse.status,
      s3UploadStatus: uploadResponse.status,
      sendStatus: sendResponse.status,
      sendResponse: sendParsed.text,
      parsedSendResponse: sendParsed.inner,
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