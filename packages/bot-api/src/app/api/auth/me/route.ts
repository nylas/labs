import { validateAccessByAccessTokenOrAPIKey } from '@/lib/auth';
import {
  addRequestIdToHeaders,
  createConfigurationError,
  createUnauthorizedError,
  getOrGenerateRequestId,
  handleGenericError
} from '@/lib/errors';
import { RedisStore } from '@/lib/redis';
import { ErrorCodes } from '@/shared-types';
import { getRequestLogger } from '@/lib/logger';

export const runtime = 'edge';

// Fetch grant data from Nylas API
async function fetchGrantData(nylasApiUri: string, nylasApiKey: string, grantId: string, logger: ReturnType<typeof getRequestLogger>) {
  try {
    const response = await fetch(`${nylasApiUri}/v3/grants/${grantId}`, {
      headers: {
        'Authorization': `Bearer ${nylasApiKey}`,
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch grant: ${response.status}`);
    }
    
    const grant = await response.json();
    return grant;
  } catch (error) {
    logger.error('Error fetching grant data from Nylas API', error, { grantId });
    throw error;
  }
}

// Fetch primary calendar timezone from Nylas API
async function fetchPrimaryCalendarTimezone(nylasApiUri: string, nylasApiKey: string, grantId: string, logger: ReturnType<typeof getRequestLogger>): Promise<string | null> {
  try {
    // Get primary calendar details
    const response = await fetch(`${nylasApiUri}/v3/grants/${grantId}/calendars/primary`, {
      headers: {
        'Authorization': `Bearer ${nylasApiKey}`,
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) {
      logger.warn('Failed to fetch primary calendar timezone', { status: response.status, grantId });
      return null;
    }
    
    const calendar = await response.json();
    
    // Extract timezone from calendar data
    const timezone = calendar.timezone || calendar.data?.timezone;
    
    if (timezone) {
      logger.info('Successfully fetched user\'s primary calendar timezone', { timezone, grantId });
      return timezone;
    }
    
    logger.warn('No timezone found in primary calendar data', { grantId });
    return null;
  } catch (error) {
    logger.error('Error fetching primary calendar timezone', error, { grantId });
    return null;
  }
}

export async function GET(request: Request) {
  const requestId = getOrGenerateRequestId(request);
  const logger = getRequestLogger(request);
  
  try {
    // Verify access
    const [grantInfo, authError] = await validateAccessByAccessTokenOrAPIKey(request, requestId);
    if (authError) return authError;
    
    // Check if grant is still valid
    const grantId = grantInfo.grant_id.replace('grant:', '');
    const grant = await RedisStore.getGrant(grantId);
    if (!grant || grant.disabled) {
      return createUnauthorizedError('Grant not found or has been disabled', requestId);
    }
    
    // Get grant data from Nylas API
    const nylasApiUri = process.env.NYLAS_API_URI || 'https://api.us.nylas.com';
    const nylasApiKey = process.env.NYLAS_API_KEY;
    
    if (!nylasApiKey) {
      return createConfigurationError('Nylas API key not configured', requestId);
    }
    
    const grantData = await fetchGrantData(nylasApiUri, nylasApiKey, grantId, logger);
    
    // Extract email from grant data - check multiple possible locations
    const email = grantData.email || grantData.data?.email || grantData.user_email;
    
    if (!email) {
      throw new Error(`No email found in grant data from Nylas API`);
    }
    
    // Fetch primary calendar timezone
    const timezone = await fetchPrimaryCalendarTimezone(nylasApiUri, nylasApiKey, grantId, logger);
    
    return Response.json({
      grant_id: grantId,
      email: email,
      provider: grantData.provider || grantData.data?.provider || 'google',
      org_id: grantInfo.org,
      timezone: timezone // Include timezone in response, will be null if not available
    }, {
      headers: addRequestIdToHeaders({}, requestId)
    });
    
  } catch (error) {
    return handleGenericError(error, 'Get current user error', ErrorCodes.PROXY_ERROR, requestId);
  }
} 