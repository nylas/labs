import { config } from "dotenv";
import { createClerkClient } from "@clerk/backend";

// Load environment variables
config({ path: ".env.local" });
config({ path: ".env" });

async function detectClerkConfig() {
  try {
    const clerkClient = createClerkClient({
      secretKey: process.env.CLERK_SECRET_KEY,
    });

    console.log("🔍 Detecting Clerk configuration...");

    // Get a session token
    const userList = await clerkClient.users.getUserList({ limit: 1 });
    const testUser = userList.data[0];
    const sessions = await clerkClient.sessions.getSessionList({
      userId: testUser.id,
      limit: 1,
    });

    if (sessions.data.length === 0) {
      console.log("❌ No active sessions found");
      return;
    }

    const tokenResponse = await clerkClient.sessions.getToken(
      sessions.data[0].id,
    );
    const token =
      typeof tokenResponse === "string" ? tokenResponse : tokenResponse.jwt;

    // Decode JWT header and payload (without verification)
    const [header, payload] = token
      .split(".")
      .map((part) => JSON.parse(Buffer.from(part, "base64url").toString()));

    console.log("\n🎯 Detected Clerk Configuration:");
    console.log("=".repeat(50));
    console.log(`Frontend API URL: ${payload.iss}`);
    console.log(`JWKS URL: ${payload.iss}/.well-known/jwks.json`);
    console.log("=".repeat(50));

    console.log("\n📝 Add this to your .env.local file:");
    console.log(`CLERK_FRONTEND_API=${payload.iss}`);

    console.log("\n🔧 Your current environment:");
    console.log(
      `CLERK_FRONTEND_API=${process.env.CLERK_FRONTEND_API || "❌ Not set"}`,
    );
  } catch (error) {
    console.error("❌ Error:", error.message);
  }
}

detectClerkConfig();
