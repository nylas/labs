import { cookies } from 'next/headers';

export interface NylasTokenInfo {
  iss: string;
  aud: string;
  sub: string;
  email: string;
  iat: number;
  exp: number;
  org_id?: string;
}

export interface NylasTokenInfoResponse {
  request_id: string;
  data: NylasTokenInfo;
}

export interface NylasRefreshTokenResponse {
  access_token: string;
  expires_in: number;
  id_token?: string;
  email: string;
  refresh_token: string;
  scope: string;
  token_type: string;
  grant_id: string;
  provider: string;
}

export interface NylasApiError {
  error: string;
  error_description?: string;
  error_uri?: string;
  error_code?: number;
  message?: string;
  type?: string;
  description?: string;
}

export class NylasApiErrorException extends Error {
  public readonly error: string;
  public readonly errorDescription: string;
  public readonly errorUri?: string;
  public readonly errorCode: number;
  public readonly statusCode: number;

  constructor(apiError: NylasApiError, statusCode: number) {
    const errorString = typeof apiError.error === 'string' 
      ? apiError.error 
      : (apiError.type || apiError.message || JSON.stringify(apiError.error) || 'unknown_error');
    
    const errorDescription = apiError.error_description 
      || apiError.message 
      || apiError.description
      || `HTTP ${statusCode} error`;
    
    super(`Nylas API Error: ${errorString} - ${errorDescription}`);
    this.name = 'NylasApiErrorException';
    this.error = errorString;
    this.errorDescription = errorDescription;
    this.errorUri = apiError.error_uri;
    this.errorCode = apiError.error_code || statusCode;
    this.statusCode = statusCode;
  }
}

// Cookie names
const ACCESS_TOKEN_COOKIE = 'nylas_access_token';
const REFRESH_TOKEN_COOKIE = 'nylas_refresh_token';

/**
 * Sets the access token cookie
 * @param accessToken - The access token to store
 * @param options - Cookie options (maxAge defaults to 1 hour)
 */
export async function setAccessTokenCookie(
  accessToken: string,
  options?: {
    maxAge?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'strict' | 'lax' | 'none';
  }
): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(ACCESS_TOKEN_COOKIE, accessToken, {
    maxAge: options?.maxAge ?? 60 * 60, // Default 1 hour
    httpOnly: options?.httpOnly ?? true,
    secure: options?.secure ?? process.env.NODE_ENV === 'production',
    sameSite: options?.sameSite ?? 'lax',
    path: '/',
  });
}

/**
 * Sets the refresh token cookie
 * @param refreshToken - The refresh token to store
 * @param options - Cookie options (maxAge defaults to 30 days)
 */
export async function setRefreshTokenCookie(
  refreshToken: string,
  options?: {
    maxAge?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'strict' | 'lax' | 'none';
  }
): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(REFRESH_TOKEN_COOKIE, refreshToken, {
    maxAge: options?.maxAge ?? 60 * 60 * 24 * 30, // Default 30 days
    httpOnly: options?.httpOnly ?? true,
    secure: options?.secure ?? process.env.NODE_ENV === 'production',
    sameSite: options?.sameSite ?? 'lax',
    path: '/',
  });
}

/**
 * Gets the access token from cookies
 * @returns The access token or undefined if not found
 */
export async function getAccessTokenFromCookie(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;
}

/**
 * Gets the refresh token from cookies
 * @returns The refresh token or undefined if not found
 */
export async function getRefreshTokenFromCookie(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get(REFRESH_TOKEN_COOKIE)?.value;
}

/**
 * Deletes the access token cookie
 */
export async function deleteAccessTokenCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(ACCESS_TOKEN_COOKIE);
}

/**
 * Deletes the refresh token cookie
 */
export async function deleteRefreshTokenCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(REFRESH_TOKEN_COOKIE);
}

/**
 * Deletes both access token and refresh token cookies
 */
export async function deleteAllTokenCookies(): Promise<void> {
  await deleteAccessTokenCookie();
  await deleteRefreshTokenCookie();
}

/**
 * Gets token info from the Nylas API using an access token
 * @param accessToken - The access token
 * @param nylasApiKey - The Nylas API key for authorization
 * @param nylasApiUri - The Nylas API URI (defaults to US region)
 * @returns Promise with token info response
 */
export async function getNylasTokenInfo(
  accessToken: string,
  nylasApiKey: string,
  nylasApiUri: string = 'https://api.us.nylas.com'
): Promise<NylasTokenInfoResponse> {
  const url = new URL(`${nylasApiUri}/v3/connect/tokeninfo`);
  url.searchParams.append('access_token', accessToken);

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Accept': 'application/json, application/gzip',
      'Authorization': `Bearer ${nylasApiKey}`
    }
  });

  if (!response.ok) {
    let errorData: NylasApiError;
    try {
      errorData = await response.json();
    } catch {
      // If we can't parse the response as JSON, create a basic error object
      errorData = {
        error: 'parse_error',
        error_description: `Failed to parse error response: ${response.status} ${response.statusText}`,
        error_code: response.status
      };
    }
    throw new NylasApiErrorException(errorData, response.status);
  }

  const data: NylasTokenInfoResponse = await response.json();
  
  return data;
}

/**
 * Refreshes an access token using a refresh token via the Nylas API
 * @param refreshToken - The refresh token
 * @param nylasClientId - The Nylas client ID
 * @param nylasClientSecret - The Nylas client secret (API key)
 * @param nylasApiUri - The Nylas API URI (defaults to US region)
 * @returns Promise with refresh token response
 */
export async function refreshNylasToken(
  refreshToken: string,
  nylasClientId: string,
  nylasClientSecret: string,
  nylasApiUri: string = 'https://api.us.nylas.com'
): Promise<NylasRefreshTokenResponse> {
  const tokenUrl = `${nylasApiUri}/v3/connect/token`;

  const requestBody = {
    client_id: nylasClientId,
    client_secret: nylasClientSecret,
    grant_type: 'refresh_token' as const,
    refresh_token: refreshToken
  };

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    let errorData: NylasApiError;
    try {
      errorData = await response.json();
    } catch {
      // If we can't parse the response as JSON, create a basic error object
      errorData = {
        error: 'parse_error',
        error_description: `Failed to parse error response: ${response.status} ${response.statusText}`,
        error_code: response.status
      };
    }
    throw new NylasApiErrorException(errorData, response.status);
  }

  const data: NylasRefreshTokenResponse = await response.json();
  
  return data;
}