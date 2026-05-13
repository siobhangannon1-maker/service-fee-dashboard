import { NextResponse } from "next/server";
import { xeroFetch } from "@/lib/xero";

export async function GET() {
  try {
    const result = await xeroFetch("/Contacts");

    const contacts =
      result?.Contacts?.map((contact: any) => ({
        contactID: contact.ContactID,
        name: contact.Name,
        email: contact.EmailAddress,
      })) || [];

    return NextResponse.json({
      success: true,
      contacts,
    });
  } catch (error: any) {
    console.error("List contacts error:", error);

    return NextResponse.json(
      {
        success: false,
        error: error.message || "Failed to load contacts.",
      },
      { status: 500 }
    );
  }
}