import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import Nylas from "nylas";
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
    const apiKey = await clerkIntegration.getNylasAccessToken(userId);
    const nylas = new Nylas({ apiKey });
    // Use Nylas SDK to get calendars
    const calendars = await nylas.calendars.list({ identifier: "me" });
    return NextResponse.json({ calendars });
  } catch (error) {
    console.error("API Error:", error);
    // NICE error handling for the integration
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
