import { clerkClient } from "@clerk/nextjs/server";

/**
 * Base error class for ClerkIntegration
 */
export class ClerkIntegrationError extends Error {
  constructor(
    message: string,
    public status: number = 500,
  ) {
    super(message);
    this.name = "ClerkIntegrationError";
  }
}

/**
 * Error thrown when OAuth token is not found
 */
export class TokenNotFoundError extends ClerkIntegrationError {
  constructor(message: string = "OAuth access token not found") {
    super(message, 401);
    this.name = "TokenNotFoundError";
  }
}

/**
 * Error thrown when OAuth provider is not connected
 */
export class ProviderNotConnectedError extends ClerkIntegrationError {
  constructor(provider: string) {
    super(`OAuth provider '${provider}' is not connected for this user`, 401);
    this.name = "ProviderNotConnectedError";
  }
}

/**
 * Error thrown when Clerk API fails
 */
export class ClerkApiError extends ClerkIntegrationError {
  constructor(message: string = "Clerk API request failed") {
    super(message, 502);
    this.name = "ClerkApiError";
  }
}

/**
 * ClerkIntegration class to handle OAuth token retrieval
 */
export class ClerkIntegration {
  private provider: `custom_${string}`;

  constructor(provider: `custom_${string}` = "custom_nylas") {
    this.provider = provider;
  }

  /**
   * Get OAuth access token for a user and provider
   */
  async getNylasAccessToken(userId: string): Promise<string> {
    try {
      const client = await clerkClient();

      const { data } = await client.users.getUserOauthAccessToken(
        userId,
        this.provider,
      );

      if (!data) {
        throw new ProviderNotConnectedError(this.provider);
      }

      if (!data || data.length === 0) {
        throw new ProviderNotConnectedError(this.provider);
      }

      const accessToken = data[0]?.token;

      if (!accessToken) {
        throw new TokenNotFoundError();
      }

      return accessToken;
    } catch (error) {
      // Re-throw our custom errors
      if (error instanceof ClerkIntegrationError) {
        throw error;
      }
      // Handle other errors
      console.error("Clerk API Error:", error);
      throw new ClerkApiError("Failed to retrieve OAuth access token");
    }
  }
}
