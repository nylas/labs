import { RedisStore } from '@/lib/redis';
import { ErrorCodes } from '@/shared-types';
import { 
  createNotFoundError, 
  createUnauthorizedError,
  handleGenericError, 
  getOrGenerateRequestId,
  addRequestIdToHeaders 
} from '@/lib/errors';
import { validateAccessByAccessToken } from '@/lib/auth';

export const runtime = 'edge';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ kid: string }> }
) {
  const requestId = getOrGenerateRequestId(request);
  
  try {
    const { kid } = await params;
    
    // Verify access
    const [grantInfo, authError] = await validateAccessByAccessToken(request, requestId);
    if (authError) return authError;
    
    // Check if key exists
    const keyData = await RedisStore.getKey(kid);
    if (!keyData) {
      return createNotFoundError('key', kid, requestId);
    }
    
    // Verify the grant_id matches the key's grant_id
    if (keyData.grant_id !== grantInfo.sub) {
      return createUnauthorizedError('Key does not belong to provided grant', requestId);
    }
    
    // Verify grant exists and is active
    const grant = await RedisStore.getGrant(grantInfo.sub);
    if (!grant || grant.disabled) {
      return createUnauthorizedError('Invalid grant credentials', requestId);
    }
    
    // Delete the key
    await RedisStore.deleteKey(kid);
    
    return new Response(null, { 
      status: 204,
      headers: addRequestIdToHeaders({}, requestId)
    });
    
  } catch (error) {
    return handleGenericError(error, 'Delete key error', ErrorCodes.KEY_NOT_FOUND, requestId);
  }
} 