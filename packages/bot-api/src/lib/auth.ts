import { createUnauthorizedError } from "./errors";
import { extractBearerToken, verifyJwt } from "./jwt";
import { getAccessTokenFromCookie, getNylasTokenInfo, NylasTokenInfo } from "./oauth";
import { logger } from "./logger";

// Helper function to validate access against nylas token info
export async function validateAccessByAccessToken(
  request: Request,
  requestId: string
): Promise<[NylasTokenInfo, null] | [null, Response]> {
  let accessToken: string | undefined = undefined;

  // First try to get access token from cookie using the standardized helper
  accessToken = await getAccessTokenFromCookie();

  // Fall back to authorization header if no cookie
  if (!accessToken) {
    const authHeader = request.headers.get("authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      accessToken = authHeader.slice(7); // Remove 'Bearer '
    }
  }

  // If still no access token, return error
  if (!accessToken) {
    return [null, createUnauthorizedError(
      "Access token required (via nylas_access_token cookie or Authorization header)",
      requestId
    )];
  }

  let tokenInfoResponse;
  try {
    tokenInfoResponse = await getNylasTokenInfo(
      accessToken,
      process.env.NYLAS_API_KEY || "",
      process.env.NYLAS_API_URI || ""
    );
     } catch (error) {
     logger.error("Failed to get token info during access validation", error, { requestId });
     return [null, createUnauthorizedError(
       `Failed to validate access token: ${error instanceof Error ? error.message : 'Unknown error'}`,
       requestId
     )];
   }

  // Check if the token is valid
  if (!tokenInfoResponse.data) {
    return [null, createUnauthorizedError(
      "Invalid or expired Nylas access token",
      requestId
    )];
  }

  // Set org id to 'default' if it is not set
  if (!tokenInfoResponse.data.org_id) {
    tokenInfoResponse.data.org_id = "default";
  }

  return [tokenInfoResponse.data, null]; // No error
}

export async function validateAccessByAccessTokenOrAPIKey(
  request: Request,
  requestId: string
): Promise<[{ grant_id: string; org: string }, null] | [null, Response]> {

  // If it is a jwt token, verify it
  const authHeader = request.headers.get("Authorization");
  const token = extractBearerToken(authHeader);
  if (token) {
    const payload = await verifyJwt(token);
    if (!payload) {
      return [null, createUnauthorizedError("Invalid or expired JWT token", requestId)];
    }

    return [{ grant_id: payload.sub, org: "default" }, null];
  }


  // If we don't have an access token cookie, check the Authorization header
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7); // Remove 'Bearer '
    let tokenInfo;
    try {
      tokenInfo = await getNylasTokenInfo(
        token,
        process.env.NYLAS_API_KEY || "",
        process.env.NYLAS_API_URI || ""
      );
         } catch (error) {
       logger.error("Failed to get token info from Bearer token", error, { requestId });
       return [null, createUnauthorizedError(
         `Failed to validate access token: ${error instanceof Error ? error.message : 'Unknown error'}`,
         requestId
       )];
     }
    
    if (!tokenInfo.data) {
      return [null, createUnauthorizedError(
        "Invalid or expired Nylas access token",
        requestId
      )];
    }

    return [{ grant_id: tokenInfo.data.sub, org: "default" }, null];
  }
  // If we have an access token cookie, use that to validate access
  const accessToken = await getAccessTokenFromCookie();
  if (accessToken) {
    let tokenInfo;
    try {
      tokenInfo = await getNylasTokenInfo(
        accessToken,
        process.env.NYLAS_API_KEY || "",
        process.env.NYLAS_API_URI || ""
      );
         } catch (error) {
       logger.error("Failed to get token info from cookie", error, { requestId });
       return [null, createUnauthorizedError(
         `Failed to validate access token: ${error instanceof Error ? error.message : 'Unknown error'}`,
         requestId
       )];
     }
    
    if (!tokenInfo.data) {
      return [null, createUnauthorizedError(
        "Invalid or expired Nylas access token",
        requestId
      )];
    }

    return [{ grant_id: tokenInfo.data.sub, org: "default" }, null];
  }
  // If we don't have an access token cookie or Authorization header, return an error
  return [null, createUnauthorizedError("No access token provided", requestId)];
}
