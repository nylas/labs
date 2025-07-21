import { validateAccessByAccessTokenOrAPIKey } from '@/lib/auth';
import {
  addRequestIdToHeaders,
  createConfigurationError,
  createValidationError,
  getOrGenerateRequestId,
  handleGenericError
} from '@/lib/errors';
import { ErrorCodes } from '@/shared-types';
import { getRequestLogger } from '@/lib/logger';

export const runtime = 'edge';

interface NylasGrantResponse {
  data: Array<{
    id: string;
    provider: string;
    email: string;
    organization_id: string;
    account_id: string;
    scope: string[];
    created_at: number;
    updated_at: number;
  }>;
}

async function findGrantByEmail(
  nylasApiUri: string, 
  nylasApiKey: string, 
  email: string,
  orgId: string,
  logger: ReturnType<typeof getRequestLogger>
): Promise<string | null> {
  try {
    const url = new URL(`${nylasApiUri}/v3/grants`);
    url.searchParams.set('email', email);
    
    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${nylasApiKey}`,
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Failed to fetch grants from Nylas API', undefined, { 
        status: response.status, 
        statusText: response.statusText,
        error: errorText,
        email 
      });
      return null;
    }
    
    const data: NylasGrantResponse = await response.json();
    
    // Find a grant that matches the email and organization
    const matchingGrant = data.data.find(grant => 
      grant.email === email && grant.organization_id === orgId
    );
    
    if (matchingGrant) {
      // For Google Calendar, the primary calendar_id is typically the user's email
      // or "primary" depending on the context
      return "primary";
    }
    
    return null;
  } catch (error) {
    logger.error('Error fetching grants from Nylas API', error, { email, orgId });
    return null;
  }
}

export async function GET(request: Request) {
  const requestId = getOrGenerateRequestId(request);
  const logger = getRequestLogger(request);
  
  try {
    // Verify access
    const [grantInfo, authError] = await validateAccessByAccessTokenOrAPIKey(request, requestId);
    if (authError) {
      logger.error('Authentication error', undefined, { requestId });
      return authError;
    }
    
    // Extract email parameter from URL
    const url = new URL(request.url);
    const email = url.searchParams.get('email');
    
    if (!email) {
      logger.error('Email parameter is required', undefined, { requestId });
      return createValidationError('Email parameter is required', requestId);
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      logger.error('Invalid email format', undefined, { email, requestId });
      return createValidationError('Invalid email format', requestId);
    }
    
    // Build Nylas API configuration
    const nylasApiUri = process.env.NYLAS_API_URI || 'https://api.us.nylas.com';
    const nylasApiKey = process.env.NYLAS_API_KEY;
    
    if (!nylasApiKey) {
      logger.error('Nylas API key not configured', undefined, { requestId });
      return createConfigurationError('Nylas API key not configured', requestId);
    }
    
    // Extract org_id from JWT payload
    const orgId = grantInfo.org;
    
    // Look up the grant for this email
    const calendarId = await findGrantByEmail(nylasApiUri, nylasApiKey, email, orgId, logger);
    
    if (!calendarId) {
      const errorResponse = {
        error: 'email_not_connected',
        description: 'Email not connected to this organization',
        request_id: requestId
      };
      
      const responseHeaders = addRequestIdToHeaders({
        'Content-Type': 'application/json'
      }, requestId);
      
      return new Response(
        JSON.stringify(errorResponse),
        {
          status: 404,
          headers: responseHeaders
        }
      );
    }
    
    // Return the calendar_id
    const responseHeaders = addRequestIdToHeaders({
      'Content-Type': 'application/json'
    }, requestId);
    
    return new Response(
      JSON.stringify({ calendar_id: calendarId }),
      {
        status: 200,
        headers: responseHeaders
      }
    );
    
  } catch (error) {
    logger.error('Error in directory lookup', error, { requestId });
    return handleGenericError(error, 'Directory lookup error', ErrorCodes.PROXY_ERROR, requestId);
  }
} 