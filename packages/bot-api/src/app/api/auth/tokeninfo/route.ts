import { getAccessTokenFromCookie, getNylasTokenInfo } from '@/lib/oauth';
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

export async function GET(request: Request) {
  const requestId = getOrGenerateRequestId(request);
  const logger = getRequestLogger(request);
  
  try {
    logger.info('Getting token info');
    
    // Get access token from cookies
    const accessToken = await getAccessTokenFromCookie();
    
    if (!accessToken) {
      logger.warn('No access token found');
      return createErrorResponse(
        ErrorCodes.UNAUTHORIZED,
        'No access token found',
        undefined,
        requestId
      );
    }
    
    // Get required configuration
    const nylasApiKey = process.env.NYLAS_API_KEY;
    const nylasApiUri = process.env.NYLAS_API_URI || 'https://api.us.nylas.com';
    
    if (!nylasApiKey) {
      logger.error('Nylas API key not configured');
      return createConfigurationError(
        'Nylas API key not configured',
        requestId
      );
    }
    
    // Get token info from Nylas API
    const tokenInfoResponse = await getNylasTokenInfo(
      accessToken,
      nylasApiKey,
      nylasApiUri
    );
    
    logger.info('Token info retrieved successfully', {
      sub: tokenInfoResponse.data.sub,
      exp: tokenInfoResponse.data.exp,
      email: tokenInfoResponse.data.email
    });
    
    // Return token info
    return Response.json(tokenInfoResponse, {
      headers: addRequestIdToHeaders({}, requestId)
    });
    
  } catch (error) {
    logger.error('Token info error', error);
    return handleGenericError(error, 'Failed to get token info', ErrorCodes.UNAUTHORIZED, requestId);
  }
} 