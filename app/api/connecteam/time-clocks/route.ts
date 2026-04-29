import { NextResponse } from "next/server";

export async function GET() {
  const apiKey = process.env.CONNECTEAM_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing CONNECTEAM_API_KEY" },
      { status: 500 }
    );
  }

  try {
    const response = await fetch(
      "https://api.connecteam.com/time-clock/v1/time-clocks",
      {
        method: "GET",
        headers: {
          "X-API-KEY": apiKey,
          "Content-Type": "application/json",
        },
      }
    );

    const data = await response.json();

    return NextResponse.json({
      status: response.status,
      data,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}