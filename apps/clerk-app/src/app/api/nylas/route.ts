import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import {
  ClerkIntegration,
  ClerkIntegrationError,
} from "@/lib/clerk-integration";

export async function GET() {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ message: "User not found" }, { status: 401 });
  }

  try {
    const clerkIntegration = new ClerkIntegration();

    // Clean, simple method call
    const accessToken = await clerkIntegration.getUserOauthAccessToken(userId);

    // Use the token with Nylas API
    const nylasUrl = "https://api.us.nylas.com/v3/grants/me/calendars";

    const nylasResponse = await fetch(nylasUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!nylasResponse.ok) {
      throw new Error(`Nylas API error: ${nylasResponse.status}`);
    }

    const nylasData = await nylasResponse.json();

    return NextResponse.json({ nylasData });
  } catch (error) {
    console.error("API Error:", error);

    // Handle our custom errors
    if (error instanceof ClerkIntegrationError) {
      return NextResponse.json(
        {
          message: error.message,
          code: error.name,
        },
        { status: error.status },
      );
    }

    // Handle other errors
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 },
    );
  }
}
