import {
  createConfigurationError,
  createErrorResponse,
  createNylasErrorResponse,
  getOrGenerateRequestId,
  handleGenericError
} from '@/lib/errors';
import { signGrantJwt } from '@/lib/jwt';
import { getRequestLogger } from '@/lib/logger';
import { setAccessTokenCookie, setRefreshTokenCookie } from '@/lib/oauth';
import { RedisStore } from '@/lib/redis';
import { ErrorCodes } from '@/shared-types';

export const runtime = 'edge';

export async function GET(request: Request) {
  const requestId = getOrGenerateRequestId(request);
  const logger = getRequestLogger(request);
  
  let code: string | null = null;
  let state: string | null = null;
  
  try {
    const url = new URL(request.url);
    code = url.searchParams.get('code');
    state = url.searchParams.get('state');
    
    logger.oauthStart('google', { code: code?.substring(0, 10) + '...', state });
    
    if (!code || !state) {
      logger.warn('OAuth callback missing parameters', { code: !!code, state: !!state });
      return createErrorResponse(
        ErrorCodes.INVALID_STATE,
        'Missing authorization code or state parameter',
        undefined,
        requestId
      );
    }
    
    // Exchange code for grant using Nylas v3 Connect API
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
    
    // Create Basic Auth credentials (client_id:api_key)
    const credentials = btoa(`${nylasClientId}:${nylasApiKey}`);
    const tokenUrl = `${nylasApiUri}/v3/connect/token`;
    
    logger.httpRequest('POST', tokenUrl, { 
      grant_type: 'authorization_code',
      redirect_uri: `${url.origin}/auth/callback`
    });
    
    // Call Nylas v3 Connect token exchange API
    const exchangeResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${credentials}`
      },
      body: new URLSearchParams({
        code,
        grant_type: 'authorization_code',
        redirect_uri: `${url.origin}/auth/callback`
      })
    });
    
    if (!exchangeResponse.ok) {
      const errorText = await exchangeResponse.text();
      logger.httpError('POST', tokenUrl, new Error(`HTTP ${exchangeResponse.status}: ${errorText}`), {
        status: exchangeResponse.status,
        statusText: exchangeResponse.statusText
      });
      
      return createNylasErrorResponse(
        errorText,
        ErrorCodes.EXCHANGE_FAILED,
        requestId
      );
    }
    
    const exchangeData = await exchangeResponse.json();
    logger.httpResponse('POST', tokenUrl, exchangeResponse.status, undefined, {
      hasGrantId: !!exchangeData.grant_id,
      provider: exchangeData.provider,
      email: exchangeData.email
    });
    
    // Use the grant ID returned by Nylas (not generate our own)
    const grantId = exchangeData.grant_id;
    
    if (!grantId) {
      logger.error('Grant ID missing from Nylas response', undefined, { 
        exchangeData: JSON.stringify(exchangeData, null, 2) 
      });
      return createNylasErrorResponse(
        'Grant ID missing from Nylas response',
        ErrorCodes.EXCHANGE_FAILED,
        requestId
      );
    }
    
    const now = Math.floor(Date.now() / 1000);
    const grantData = {
      provider: 'google',
      org_id: exchangeData.org_id || 'default_org',
      refresh_token: exchangeData.refresh_token,
      created_at: now
    };
    
    logger.info('Storing grant in Redis', { 
      grantId, 
      provider: grantData.provider, 
      org_id: grantData.org_id 
    });
    
    await RedisStore.setGrant(grantId, grantData);
    
    // Create a default API key for immediate use
    const defaultApiKey = await signGrantJwt(
      grantId,
      exchangeData.org_id || 'default_org',
      90 * 24 * 60 * 60, // 90 days TTL
      'Default API Key'
    );
    
    logger.oauthSuccess('google', grantId, {
      org_id: exchangeData.org_id || 'default_org',
      email: exchangeData.email,
      api_key_created: true
    });

    // Store the access token and refresh token in cookies
    await setAccessTokenCookie(exchangeData.access_token);
    await setRefreshTokenCookie(exchangeData.refresh_token);
    
    // Return JSON response for API consumers
    return Response.json({
      success: true,
      data: {
        grant_id: grantId,
        api_key: defaultApiKey.api_key,
        org_id: exchangeData.org_id || 'default_org',
        provider: 'google'
      }
    }, {
      status: 200,
      headers: {
        'X-Request-ID': requestId
      }
    });
    
  } catch (error) {
    logger.oauthError('google', error, { 
      requestId,
      hasCode: !!code,
      hasState: !!state
    });
    return handleGenericError(error, 'OAuth callback error', ErrorCodes.EXCHANGE_FAILED, requestId);
  }
} 