import { NextResponse } from "next/server";
import { connecteamFetch } from "@/lib/connecteam";

export async function GET() {
  try {
    const data = await connecteamFetch("/users/v1/users?limit=10&offset=0");

    return NextResponse.json({
      message: "Connecteam users debug response",
      data,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        error: error.message,
      },
      { status: 500 }
    );
  }
}