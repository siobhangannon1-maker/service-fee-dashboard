import { NextResponse } from "next/server";

export async function GET() {
  const apiKey = process.env.CONNECTEAM_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "API key is missing" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    message: "API key loaded successfully",
    keyPreview: apiKey.slice(0, 5) + "...",
  });
}