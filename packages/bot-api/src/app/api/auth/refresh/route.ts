import { 
  refreshNylasToken, 
  getRefreshTokenFromCookie, 
  setAccessTokenCookie,
  NylasApiErrorException
} from '@/lib/oauth';
import { 
  createErrorResponse,
  createConfigurationError,
  handleGenericError,
  getOrGenerateRequestId,
  addRequestIdToHeaders
} from '@/lib/errors';
import { ErrorCodes } from '@/shared-types';
import { getRequestLogger } from '@/lib/logger';

export const runtime = 'edge';

export async function POST(request: Request) {
  const requestId = getOrGenerateRequestId(request);
  const logger = getRequestLogger(request);
  
  try {
    logger.info('Starting token refresh process');
    
    // Get refresh token from cookies first, then check request body
    let refreshToken = await getRefreshTokenFromCookie();
    
    if (!refreshToken) {
      try {
        const body = await request.json();
        refreshToken = body.refresh_token;
      } catch {
        // If we can't parse JSON, that's ok - we'll check if we have a refresh token from cookies
      }
    }
    
    if (!refreshToken) {
      logger.warn('No refresh token provided');
      return createErrorResponse(
        ErrorCodes.UNAUTHORIZED,
        'No refresh token provided. Please include refresh_token in request body or ensure you have valid cookies.',
        undefined,
        requestId
      );
    }
    
    // Get required configuration
    const nylasApiUri = process.env.NYLAS_API_URI || 'https://api.us.nylas.com';
    const nylasClientId = process.env.NYLAS_CLIENT_ID;
    const nylasApiKey = process.env.NYLAS_API_KEY;
    
    if (!nylasClientId || !nylasApiKey) {
      logger.error('OAuth configuration missing', undefined, { 
        hasClientId: !!nylasClientId, 
        hasApiKey: !!nylasApiKey 
      });
      return createConfigurationError(
        'Nylas client ID or API key not configured',
        requestId
      );
    }
    
    logger.info('Making refresh token request to Nylas API');
    
    // Refresh the token
    const refreshResponse = await refreshNylasToken(
      refreshToken,
      nylasClientId,
      nylasApiKey,
      nylasApiUri
    );
    
    logger.info('Token refresh successful', {
      grant_id: refreshResponse.grant_id,
      provider: refreshResponse.provider,
      email: refreshResponse.email,
      token_type: refreshResponse.token_type,
      expires_in: refreshResponse.expires_in
    });
    
    // Update cookies with new tokens
    await setAccessTokenCookie(refreshResponse.access_token);
    
    // Return success response
    return Response.json({
      success: true,
      data: {
        access_token: refreshResponse.access_token,
        refresh_token: refreshResponse.refresh_token,
        grant_id: refreshResponse.grant_id,
        provider: refreshResponse.provider,
        email: refreshResponse.email,
        expires_in: refreshResponse.expires_in,
        token_type: refreshResponse.token_type,
        scope: refreshResponse.scope,
        id_token: refreshResponse.id_token
      }
    }, {
      headers: addRequestIdToHeaders({}, requestId)
    });
    
  } catch (error) {
    if (error instanceof NylasApiErrorException) {
      logger.error('Nylas API error during token refresh', error, {
        error_code: error.errorCode,
        status_code: error.statusCode
      });
      
             return createErrorResponse(
         ErrorCodes.EXCHANGE_FAILED,
         `Token refresh failed: ${error.errorDescription}`,
         {
           nylas_error: error.error,
           nylas_error_code: error.errorCode
         },
         requestId
       );
     }
     
     logger.error('Token refresh error', error);
     return handleGenericError(error, 'Token refresh error', ErrorCodes.EXCHANGE_FAILED, requestId);
  }
} 