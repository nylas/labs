import type { ClerkClient } from "@clerk/backend"
import type { Grant, default as Nylas } from "nylas"
import { handlePromise } from "./lib/handle-promise.js"
import type { GoResponse } from "./types.js"

export async function createNylasGrant(
  userId: string,
  clerkClient: ClerkClient,
  nylasClient: Nylas
): Promise<GoResponse<Grant, string>> {
  // Get user
  const user = await clerkClient.users.getUser(userId)

  if (!user) {
    return ["User not found", undefined]
  }

  // Get the refresh token from the user
  const refreshToken = user.privateMetadata["nylasRefreshToken"]

  if (!refreshToken) {
    return ["No refresh token found", undefined]
  }

  // Use custom auth to create a grant
  const [error, response] = await handlePromise(
    nylasClient.auth.customAuthentication({
      requestBody: {
        provider: "google",
        settings: {
          refreshToken,
        },
      },
    })
  )

  if (error) {
    return [error instanceof Error ? error.message : "Unknown error", undefined]
  }

  return [undefined, response.data]
}
