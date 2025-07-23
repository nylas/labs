import { config } from "dotenv";
import { createClerkClient } from "@clerk/backend";

// Load environment variables from .env.local and .env files
config({ path: ".env.local" });
config({ path: ".env" });

async function generateTestToken() {
  try {
    // Debug: Check what environment variables are available
    console.log("🔧 Environment variables check:");
    console.log(
      "   CLERK_SECRET_KEY:",
      process.env.CLERK_SECRET_KEY
        ? `${process.env.CLERK_SECRET_KEY.substring(0, 10)}...`
        : "❌ Not found",
    );
    console.log(
      "   CLERK_FRONTEND_API:",
      process.env.CLERK_FRONTEND_API || "❌ Not found",
    );

    if (!process.env.CLERK_SECRET_KEY) {
      console.log("\n❌ CLERK_SECRET_KEY is missing!");
      console.log("💡 Make sure your .env.local file contains:");
      console.log("   CLERK_SECRET_KEY=sk_test_your_actual_secret_key");
      return;
    }

    // Create Clerk client with your secret key
    const clerkClient = createClerkClient({
      secretKey: process.env.CLERK_SECRET_KEY,
    });

    console.log("🔍 Fetching users from Clerk...");

    // Get the first user from your Clerk instance
    const userList = await clerkClient.users.getUserList({ limit: 5 });

    if (userList.data.length === 0) {
      console.log("❌ No users found in your Clerk instance.");
      console.log("💡 Please create a user in your Clerk Dashboard first.");
      return;
    }

    console.log(`✅ Found ${userList.data.length} user(s):`);
    userList.data.forEach((user, index) => {
      const email = user.emailAddresses.find(
        (e) => e.id === user.primaryEmailAddressId,
      )?.emailAddress;
      console.log(
        `   ${index + 1}. ${user.firstName || "Unknown"} ${user.lastName || ""} (${email || "No email"})`,
      );
    });

    // Use the first user
    const testUser = userList.data[0];
    console.log(
      `\n🎯 Using test user: ${testUser.firstName || "Unknown"} ${testUser.lastName || ""}`,
    );

    // Get active sessions for this user
    const sessions = await clerkClient.sessions.getSessionList({
      userId: testUser.id,
      limit: 1,
    });

    if (sessions.data.length === 0) {
      console.log("❌ No active sessions found for this user.");
      console.log(
        "💡 The user needs to sign in to your application first to create a session.",
      );
      console.log(
        "💡 Alternatively, you can create a JWT template and get a token via the browser console.",
      );
      return;
    }

    const session = sessions.data[0];
    console.log(`✅ Found active session: ${session.id}`);

    // Get session token
    console.log("\n🔑 Generating session token...");
    const tokenResponse = await clerkClient.sessions.getToken(session.id);

    // Extract the actual JWT string from the response
    const token =
      typeof tokenResponse === "string" ? tokenResponse : tokenResponse.jwt;

    console.log("\n🎉 SUCCESS! Here's your test JWT token:");
    console.log("=".repeat(80));
    console.log(token);
    console.log("=".repeat(80));

    console.log("\n📋 You can now test your API with this token:");
    console.log(`curl -X POST http://localhost:3999/validate-jwt \\`);
    console.log(`  -H "Authorization: Bearer ${token}" \\`);
    console.log(`  -H "Content-Type: application/json"`);

    console.log(`\ncurl -X GET http://localhost:3999/protected \\`);
    console.log(`  -H "Authorization: Bearer ${token}"`);

    console.log(
      "\n⚠️  Note: This token will expire in ~60 seconds. For longer-lived tokens, use JWT Templates in the Clerk Dashboard.",
    );
  } catch (error) {
    console.error("❌ Error generating test token:", error.message);

    if (error.message.includes("Secret key not provided")) {
      console.log(
        "\n💡 Make sure to set your CLERK_SECRET_KEY in your .env file:",
      );
      console.log("   CLERK_SECRET_KEY=sk_test_your_secret_key_here");
    }
  }
}

// Run the script
generateTestToken();
