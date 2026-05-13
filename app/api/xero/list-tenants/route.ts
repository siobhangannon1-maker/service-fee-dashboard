import { NextResponse } from "next/server";
import { XeroClient } from "xero-node";

export async function GET() {
  try {
    const xero = new XeroClient({
      clientId: process.env.XERO_CLIENT_ID!,
      clientSecret: process.env.XERO_CLIENT_SECRET!,
      redirectUris: [process.env.XERO_REDIRECT_URI!],
      scopes: [
        "openid",
        "profile",
        "email",
        "offline_access",
        "accounting.transactions",
        "accounting.contacts",
        "accounting.attachments",
      ],
    });

    await xero.initialize();

    /*
      Replace this with your existing token loading logic.
    */
    const tokenSet = await getStoredXeroTokenSet();
    await xero.setTokenSet(tokenSet);

    const tenants = await xero.updateTenants();

    return NextResponse.json({
      success: true,
      tenants,
    });
  } catch (error: any) {
    console.error("List Xero tenants error:", error);

    return NextResponse.json(
      {
        success: false,
        error: error.message ?? "Failed to list Xero tenants.",
      },
      { status: 500 }
    );
  }
}

async function getStoredXeroTokenSet(): Promise<any> {
  throw new Error("Connect this to your existing Xero token storage.");
}