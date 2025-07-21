import { validateAccessByAccessToken } from '@/lib/auth';
import {
  addRequestIdToHeaders,
  createValidationError,
  getOrGenerateRequestId,
  handleGenericError
} from '@/lib/errors';
import { signGrantJwt } from '@/lib/jwt';
import { RedisStore } from '@/lib/redis';
import { ErrorCodes } from '@/shared-types';

export const runtime = 'edge';


export async function POST(
  request: Request,
) {
  const requestId = getOrGenerateRequestId(request);
  
  try {
    // Validate grant access (authentication)
    const [tokenInfo, authError] = await validateAccessByAccessToken(request, requestId);
    if (authError) return authError;
    
    // Parse request body
    const body = await request.json().catch(() => ({}));
    const { name, ttl_days, forever } = body;
    
    if (typeof name !== 'string' && name !== undefined) {
      return createValidationError('Name must be a string if provided', requestId);
    }
    
    // Calculate TTL
    let ttlSeconds: number | undefined;
    if (forever === true) {
      ttlSeconds = undefined;
    } else if (typeof ttl_days === 'number' && ttl_days > 0) {
      ttlSeconds = ttl_days * 24 * 60 * 60;
    } else {
      // Default to 90 days
      ttlSeconds = 90 * 24 * 60 * 60;
    }
    
    // Create JWT
    const result = await signGrantJwt(tokenInfo.sub, tokenInfo.org_id || "default", ttlSeconds, name);
    
    return Response.json({
      api_key: result.api_key,
      kid: result.kid,
      expires_at: result.expires_at
    }, { 
      status: 201,
      headers: addRequestIdToHeaders({}, requestId)
    });
    
  } catch (error) {
    return handleGenericError(error, 'Create key error', ErrorCodes.INVALID_BODY, requestId);
  }
}

export async function GET(
  request: Request
) {
  const requestId = getOrGenerateRequestId(request);
  
  try {
   
    // Validate grant access (authentication)
    const [tokenInfo, tokenInfoError] = await validateAccessByAccessToken(request, requestId);
    if (tokenInfoError) return tokenInfoError;
    
    // Get all keys for this grant
    const keys = await RedisStore.getGrantKeys(tokenInfo.sub);
    
    return Response.json({
      keys: keys.map(key => ({
        kid: key.kid,
        name: key.data.name,
        expires_at: key.data.expires_at
      }))
    }, {
      headers: addRequestIdToHeaders({}, requestId)
    });
    
  } catch (error) {
    return handleGenericError(error, 'List keys error', ErrorCodes.INVALID_BODY, requestId);
  }
} 