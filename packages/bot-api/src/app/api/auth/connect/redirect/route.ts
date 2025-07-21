import { v4 as uuidv4 } from 'uuid';
import { ErrorCodes } from '@/shared-types';
import { createErrorResponse, handleGenericError, getOrGenerateRequestId } from '@/lib/errors';

export const runtime = 'edge';

export async function GET(request: Request) {
  try {
    const nylasApiUri = process.env.NYLAS_API_URI || 'https://api.us.nylas.com';
    const nylasClientId = process.env.NYLAS_CLIENT_ID;
    
    if (!nylasClientId) {
      const requestId = getOrGenerateRequestId(request);
      return createErrorResponse(
        ErrorCodes.OAUTH_URL_ERROR,
        'Nylas client ID not configured',
        undefined,
        requestId
      );
    }
    
    // Generate state nonce for security
    const state = uuidv4();
    
    // Build OAuth URL using Nylas v3 Connect API
    const oauthUrl = new URL(`${nylasApiUri}/v3/connect/auth`);
    oauthUrl.searchParams.set('response_type', 'code');
    oauthUrl.searchParams.set('client_id', nylasClientId);
    oauthUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events');
    oauthUrl.searchParams.set('state', state);
    oauthUrl.searchParams.set('redirect_uri', `${new URL(request.url).origin}/auth/callback`);
    oauthUrl.searchParams.set('provider', 'google');
    oauthUrl.searchParams.set('access_type', 'offline');
    
    return new Response(null, {
      status: 302,
      headers: {
        'Location': oauthUrl.toString()
      }
    });
  } catch (error) {
    return handleGenericError(error, 'OAuth redirect error', ErrorCodes.OAUTH_URL_ERROR, getOrGenerateRequestId(request));
  }
} 