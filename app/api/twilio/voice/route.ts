import { NextResponse } from "next/server";
import twilio from "twilio";

export async function POST() {
  const response = new twilio.twiml.VoiceResponse();

  response.dial("+61730779620");

  return new NextResponse(response.toString(), {
    headers: {
      "Content-Type": "text/xml",
    },
  });
}