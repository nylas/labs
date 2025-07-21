import { deleteAllTokenCookies } from '@/lib/oauth';
import { 
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
    logger.info('User logout initiated', { requestId });
    
    // Delete both access token and refresh token cookies
    await deleteAllTokenCookies();
    
    logger.info('User logout successful - cookies cleared', { requestId });
    
    return Response.json({
      success: true,
      message: 'Successfully logged out'
    }, {
      status: 200,
      headers: addRequestIdToHeaders({}, requestId)
    });
    
  } catch (error) {
    logger.error('Logout error', error, { requestId });
    return handleGenericError(error, 'Logout error', ErrorCodes.LOGOUT_FAILED, requestId);
  }
}
