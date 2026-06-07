import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MEDIREF_BASE_URL = "https://www.mediref.com.au";

function randomS3Uuid() {
  return Array.from({ length: 24 }, () =>
    "abcdefghijklmnopqrstuvwxyz0123456789".charAt(
      Math.floor(Math.random() * 36),
    ),
  ).join("");
}

function encodeRemotePayload(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64").replace(/=+$/, "");
}

export async function POST() {
  const cookie = process.env.MEDIREF_SESSION_COOKIE;

  if (!cookie) {
    return NextResponse.json(
      { success: false, error: "Missing MEDIREF_SESSION_COOKIE in .env.local" },
      { status: 500 },
    );
  }

  const s3uuid = randomS3Uuid();

  try {
    const composeResponse = await fetch(
      `${MEDIREF_BASE_URL}/compose/${s3uuid}/__data.json?x-sveltekit-invalidated=0101`,
      {
        method: "GET",
        headers: {
          cookie,
          accept: "*/*",
          "cache-control": "no-cache",
        },
      },
    );

    const composeText = await composeResponse.text();

    if (!composeResponse.ok) {
      return NextResponse.json(
        {
          success: false,
          step: "compose",
          status: composeResponse.status,
          body: composeText.slice(0, 500),
        },
        { status: 500 },
      );
    }

    const savePayload = encodeRemotePayload([
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
      "DocuDental Test Patient",
      "",
      "none",
      [],
      [],
    ]);

    const saveResponse = await fetch(
      `${MEDIREF_BASE_URL}/_app/remote/fd8vn1/saveDraft`,
      {
        method: "POST",
        headers: {
          cookie,
          accept: "*/*",
          "content-type": "application/json",
          origin: MEDIREF_BASE_URL,
          referer: `${MEDIREF_BASE_URL}/compose/${s3uuid}`,
          "x-sveltekit-pathname": `/compose/${s3uuid}`,
          "x-sveltekit-search": "",
        },
        body: JSON.stringify({
          payload: savePayload,
          refreshes: [],
        }),
      },
    );

    const saveText = await saveResponse.text();

    const deletePayload = encodeRemotePayload([{ s3uuid: 1 }, s3uuid]);

    const deleteResponse = await fetch(
      `${MEDIREF_BASE_URL}/_app/remote/143lgbm/deleteDraft`,
      {
        method: "POST",
        headers: {
          cookie,
          accept: "*/*",
          "content-type": "application/json",
          origin: MEDIREF_BASE_URL,
          referer: `${MEDIREF_BASE_URL}/compose/${s3uuid}`,
          "x-sveltekit-pathname": `/compose/${s3uuid}`,
          "x-sveltekit-search": "",
        },
        body: JSON.stringify({
          payload: deletePayload,
          refreshes: [],
        }),
      },
    );

    const deleteText = await deleteResponse.text();

    return NextResponse.json({
      success: saveResponse.ok && deleteResponse.ok,
      s3uuid,
      composeStatus: composeResponse.status,
      saveStatus: saveResponse.status,
      saveResponse: saveText,
      deleteStatus: deleteResponse.status,
      deleteResponse: deleteText,
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