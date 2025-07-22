import { ManagementClient } from "auth0";
import Nylas from "nylas";

/**
 * Base error class for Auth0Integration
 */
export class Auth0IntegrationError extends Error {
  constructor(
    message: string,
    public status: number = 500,
  ) {
    super(message);
    this.name = "Auth0IntegrationError";
  }
}

/**
 * Error thrown when OAuth token is not found
 */
export class TokenNotFoundError extends Auth0IntegrationError {
  constructor(message: string = "OAuth access token not found") {
    super(message, 401);
    this.name = "TokenNotFoundError";
  }
}

/**
 * Error thrown when OAuth provider is not connected
 */
export class ProviderNotConnectedError extends Auth0IntegrationError {
  constructor(provider: string) {
    super(`OAuth provider '${provider}' is not connected for this user`, 401);
    this.name = "ProviderNotConnectedError";
  }
}

/**
 * Error thrown when Auth0 API fails
 */
export class Auth0ApiError extends Auth0IntegrationError {
  constructor(message: string = "Auth0 API request failed") {
    super(message, 502);
    this.name = "Auth0ApiError";
  }
}

/**
 * Auth0Integration class to handle OAuth token retrieval using Auth0 Management API
 */
export class Auth0Integration {
  private managementClient: ManagementClient;
  private provider: string;

  constructor(
    domain: string,
    clientId: string,
    clientSecret: string,
    provider: string = "google-oauth2",
  ) {
    this.managementClient = new ManagementClient({
      domain,
      clientId,
      clientSecret,
      audience: `https://${domain}/api/v2/`,
    });
    this.provider = provider;
  }

  /**
   * Store Nylas grant ID in Auth0 app_metadata
   */
  async storeNylasGrantId(userId: string, grantId: string): Promise<void> {
    try {
      await this.managementClient.users.update(
        { id: userId },
        {
          app_metadata: {
            nylas_grant_id: grantId,
            nylas_grant_updated_at: new Date().toISOString(),
          },
        },
      );
    } catch (error) {
      console.error("Failed to store Nylas grant ID:", error);
      throw new Auth0ApiError("Failed to store Nylas grant ID");
    }
  }

  /**
   * Get stored Nylas grant ID from Auth0 app_metadata
   */
  async getNylasGrantId(userId: string): Promise<string | null> {
    try {
      const response = await this.managementClient.users.get({ id: userId });
      const user = response.data;

      return user.app_metadata?.nylas_grant_id || null;
    } catch (error) {
      console.error("Failed to retrieve Nylas grant ID:", error);
      return null;
    }
  }

  /**
   * Create Nylas client using stored grant ID, fallback to OAuth if not available
   */
  async getUserNylasClientWithGrant(userId: string): Promise<Nylas> {
    // First try to use stored grant ID
    const storedGrantId = await this.getNylasGrantId(userId);

    if (storedGrantId) {
      try {
        // Test if the grant is still valid
        const nylasClient = new Nylas({
          apiKey: process.env.NYLAS_API_KEY!,
          apiUri: process.env.NYLAS_API_URI || "https://api.us.nylas.com",
        });

        // Test the grant by making a simple API call (list calendars)
        await nylasClient.calendars.list({ identifier: storedGrantId });

        return nylasClient;
      } catch (error) {
        console.warn(
          "Stored grant ID is invalid, falling back to OAuth:",
          error,
        );
        // Clear invalid grant ID
        await this.clearNylasGrantId(userId);
      }
    }

    // Fallback to OAuth flow
    return this.getUserNylasClient(userId);
  }

  /**
   * Clear stored Nylas grant ID from Auth0 app_metadata
   */
  async clearNylasGrantId(userId: string): Promise<void> {
    try {
      const response = await this.managementClient.users.get({ id: userId });
      const user = response.data;

      if (user.app_metadata?.nylas_grant_id) {
        const updatedMetadata = { ...user.app_metadata };
        delete updatedMetadata.nylas_grant_id;
        delete updatedMetadata.nylas_grant_updated_at;

        await this.managementClient.users.update(
          { id: userId },
          { app_metadata: updatedMetadata },
        );
      }
    } catch (error) {
      console.error("Failed to clear Nylas grant ID:", error);
      throw new Auth0ApiError("Failed to clear Nylas grant ID");
    }
  }

  /**
   * Complete OAuth flow and store the resulting grant ID
   */
  async completeNylasOAuthAndStore(
    userId: string,
    authorizationCode: string,
  ): Promise<string> {
    try {
      // Exchange authorization code for grant
      const nylasClient = new Nylas({
        apiKey: process.env.NYLAS_API_KEY!,
        apiUri: process.env.NYLAS_API_URI || "https://api.us.nylas.com",
      });

      const grant = await nylasClient.auth.exchangeCodeForToken({
        clientId: process.env.NYLAS_CLIENT_ID!,
        code: authorizationCode,
        redirectUri: process.env.NYLAS_REDIRECT_URI!,
      });

      // Store the grant ID in Auth0
      await this.storeNylasGrantId(userId, grant.grantId);

      return grant.grantId;
    } catch (error) {
      console.error("Failed to complete OAuth and store grant:", error);
      throw new Auth0ApiError("Failed to complete OAuth and store grant");
    }
  }

  async getUserNylasClient(userId: string) {
    const accessToken = await this.getNylasAccessToken(userId);
    return new Nylas({ apiKey: accessToken });
  }

  /**
   * Get OAuth access token for a user from their connected identity provider
   */
  async getNylasAccessToken(userId: string): Promise<string> {
    try {
      // Get the full user profile including identities
      const response = await this.managementClient.users.get({ id: userId });
      const user = response.data;

      if (!user.identities || user.identities.length === 0) {
        throw new ProviderNotConnectedError(this.provider);
      }

      // Find the identity for the specified provider
      const identity = user.identities.find(
        (identity: any) => identity.provider === this.provider,
      );

      if (!identity) {
        throw new ProviderNotConnectedError(this.provider);
      }

      // Extract the access token from the identity
      const accessToken = identity.access_token;

      if (!accessToken) {
        throw new TokenNotFoundError(
          `No access token found for provider ${this.provider}`,
        );
      }

      return accessToken;
    } catch (error) {
      // Re-throw our custom errors
      if (error instanceof Auth0IntegrationError) {
        throw error;
      }
      // Handle other errors
      console.error("Auth0 Management API Error:", error);
      throw new Auth0ApiError("Failed to retrieve OAuth access token");
    }
  }

  /**
   * Get access token for a specific provider (useful for users with multiple identities)
   */
  async getProviderAccessToken(
    userId: string,
    provider: string,
  ): Promise<string> {
    const originalProvider = this.provider;
    this.provider = provider;
    try {
      return await this.getNylasAccessToken(userId);
    } finally {
      this.provider = originalProvider;
    }
  }

  /**
   * List all available identity providers for a user
   */
  async getUserProviders(userId: string): Promise<string[]> {
    try {
      const response = await this.managementClient.users.get({ id: userId });
      const user = response.data;

      if (!user.identities || user.identities.length === 0) {
        return [];
      }

      return user.identities
        .map((identity: any) => identity.provider)
        .filter((provider: any): provider is string => Boolean(provider));
    } catch (error) {
      console.error("Auth0 Management API Error:", error);
      throw new Auth0ApiError("Failed to retrieve user providers");
    }
  }

  /**
   * Check if a user has a specific provider connected
   */
  async hasProvider(userId: string, provider: string): Promise<boolean> {
    try {
      const providers = await this.getUserProviders(userId);
      return providers.includes(provider);
    } catch (error) {
      return false;
    }
  }
}
