// Using Node.js runtime for @vercel/mcp-adapter compatibility

import { createMcpHandler } from '@vercel/mcp-adapter';
import { createBotClientWithToken, mapDownstreamError } from '@/lib/bot-client';
import { computeConsecutiveSlots } from '@/lib/consecutive-slots';
import { 
  validateMcpRequest, 
  McpToBotApiTransformer,
  DateTimeTransformer,
  UserTimezoneDetector,
  ResponseTransformer,
  ParticipantAvailabilityFilter
} from '@/lib/validation';
import { mcpToolSchemas } from '@/lib/mcp-schema';

// Helper to extract Bearer token from Authorization header
function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7);
}

// Authentication wrapper that validates JWT and provides botClient to tools
async function withAuth(req: Request) {
  // Enhanced logging for SSE and HTTP Streaming requests
  const contentType = req.headers.get('content-type');
  const accept = req.headers.get('accept');
  const cacheControl = req.headers.get('cache-control');
  const connection = req.headers.get('connection');
  const upgrade = req.headers.get('upgrade');
  
  // Detect request type
  const isSSE = accept?.includes('text/event-stream') || 
                accept?.includes('application/json') && cacheControl?.includes('no-cache');
  const isStreaming = contentType?.includes('application/json') && 
                     (connection?.toLowerCase().includes('keep-alive') || 
                      accept?.includes('text/plain') ||
                      req.method === 'POST');
  
  let requestBody = null;
  let bodyString = '';
  
  // Handle body reading for different request types
  try {
    if (req.body && req.method !== 'GET') {
      // Clone the request to avoid consuming the original body
      const clonedRequest = req.clone();
      bodyString = await clonedRequest.text();
      
      // Try to parse as JSON if possible
      if (bodyString) {
        try {
          requestBody = JSON.parse(bodyString);
        } catch {
          requestBody = bodyString; // Keep as string if not valid JSON
        }
      }
    }
  } catch (error) {
    console.warn('⚠️ Could not read request body:', error);
    requestBody = '[Body reading failed]';
  }

  // Comprehensive logging for all request types
  console.log('🌐 Incoming Request Details:', {
    requestType: isSSE ? 'SSE' : isStreaming ? 'HTTP_STREAMING' : 'STANDARD',
    method: req.method,
    url: req.url,
    headers: {
      'content-type': contentType,
      'accept': accept,
      'authorization': req.headers.get('authorization') ? 'Bearer [REDACTED]' : 'None',
      'user-agent': req.headers.get('user-agent'),
      'cache-control': cacheControl,
      'connection': connection,
      'upgrade': upgrade,
      'content-length': req.headers.get('content-length'),
      'transfer-encoding': req.headers.get('transfer-encoding'),
      'x-forwarded-for': req.headers.get('x-forwarded-for'),
      'x-real-ip': req.headers.get('x-real-ip'),
      'host': req.headers.get('host'),
      'origin': req.headers.get('origin'),
      'referer': req.headers.get('referer')
    },
    requestMetadata: {
      timestamp: new Date().toISOString(),
      bodySize: bodyString.length,
      hasBody: !!bodyString,
      isSSE,
      isStreaming,
      urlParams: new URL(req.url).searchParams.toString()
    },
    body: requestBody
  });

  // Additional logging for SSE requests
  if (isSSE) {
    console.log('📡 SSE Request Detected:', {
      acceptHeader: accept,
      cacheControlHeader: cacheControl,
      note: 'This is a Server-Sent Events request'
    });
  }

  // Additional logging for HTTP Streaming requests
  if (isStreaming && !isSSE) {
    console.log('🌊 HTTP Streaming Request Detected:', {
      contentType,
      connectionHeader: connection,
      note: 'This is an HTTP Streaming request'
    });
  }

  const authHeader = req.headers.get('Authorization');
  const userToken = extractBearerToken(authHeader);
  
  if (!userToken) {
    console.log('❌ Authentication failed: Missing or invalid Authorization header');
    return new Response(JSON.stringify({ error: 'Missing or invalid Authorization header' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  console.log('✅ Authentication successful: Bearer token found');

  // Create bot client with user's token
  const botClient = createBotClientWithToken(userToken);

  console.log('🔧 Creating MCP handler...');

  // Create MCP handler with authenticated bot client and proper SSE configuration
  const mcpHandler = createMcpHandler((server) => {
    console.log('🛠️ MCP Server initializing with tools...');
    // my_availability tool
    server.tool(
      'my_availability', 
      `Get my primary calendar free-busy information. BUSINESS HOURS: By default, ambiguous timeframes like "tomorrow" or "this Friday" use 9am-5pm business hours. To specify different hours, use the timeframe property with explicit times (e.g., "tomorrow between 8am to 6pm", "next Friday from 10am to 4pm"). FUTURE-ONLY: Only future availability is returned by default (past time slots filtered out). TIMEZONE: Automatically detected from your calendar settings, or override explicitly (e.g., "America/New_York", "Europe/London"). EXAMPLES: Use "tomorrow between 9am to 5pm" or "next Wednesday between 8am to 6pm" to specify custom hours. Avoid vague expressions like a relative day combined with a part-of-day (e.g., "morning" or "afternoon") without explicit time ranges. For relative dates, consider using current_time tool first.`,
      mcpToolSchemas.my_availability.shape,
      async (params) => {
        console.log('📥 MCP Request - my_availability:', JSON.stringify(params, null, 2));
        try {
          // Validate input using MCP API schema
          const validation = validateMcpRequest('my_availability', params);
          if (!validation.success) {
            throw new Error(`Validation failed: ${validation.errors.map(e => `${e.field}: ${e.message}`).join(', ')}`);
          }

          // Get grant user email to include in availability check
          const grantUserEmail = await botClient.getGrantUserEmail();

          console.log('🔄 MCP Server my_availability debug:');
          console.log('  - Grant user email:', grantUserEmail);
          console.log('  - Validated data:', validation.data);
          
          // Add grant user email to the request data
          const dataWithEmail = {
            ...validation.data,
            email: grantUserEmail
          };

          // Transform to Bot API format
          const botRequest = await McpToBotApiTransformer.availabilityRequest(dataWithEmail, validation.data.durationMin || 30, req, botClient);
          
          // Call Bot API
          const response = await botClient.availability(botRequest);
          
          // Get user timezone for response formatting
          const userTimezone = await UserTimezoneDetector.requireUserTimezone(validation.data.timezone, req, botClient);
          
          // Transform unix timestamps to LLM-friendly ISO format with future-looking filtering
          const transformedResponse = ResponseTransformer.transformAvailabilityResponse(
            response, 
            userTimezone, 
            validation.data.includePast || false
          );
          
          return {
            content: [
              { type: 'text', text: JSON.stringify(transformedResponse) }
            ]
          };
        } catch (err) {
          const mapped = mapDownstreamError(err);
          throw new Error(`${mapped.code}: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      }
    );

    // contact_availability tool
    server.tool(
      'contact_availability',
      `Get a single contact's free-busy information. IMPORTANT: You must have the EXACT email address of the contact - do NOT guess or fabricate email addresses. If the user mentions someone by name only (e.g., "Hazik"), ask them to provide the exact email address. BUSINESS HOURS: By default, ambiguous timeframes like "tomorrow" or "this Friday" use 9am-5pm business hours. To specify different hours, use the timeframe property with explicit times (e.g., "tomorrow between 8am to 6pm", "next Friday from 10am to 4pm"). FUTURE-ONLY: Only future availability is returned by default (past time slots filtered out). TIMEZONE: Automatically detected from your calendar settings, or override explicitly (e.g., "America/New_York", "Europe/London"). EXAMPLES: Use "tomorrow between 9am to 5pm" or "next Wednesday between 7am to 8pm" for extended hours. Avoid vague expressions like a relative day combined with a part-of-day (e.g., "afternoon") without explicit time ranges. For relative dates, consider using current_time tool first.`,
      mcpToolSchemas.contact_availability.shape,
      async (params) => {
        console.log('📥 MCP Request - contact_availability:', JSON.stringify(params, null, 2));
        try {
          // Validate input using MCP API schema
          const validation = validateMcpRequest('contact_availability', params);
          if (!validation.success) {
            throw new Error(`Validation failed: ${validation.errors.map(e => `${e.field}: ${e.message}`).join(', ')}`);
          }

          // Normalize email to lowercase for case-sensitive Bot API
          const normalizedData = {
            ...validation.data,
            email: validation.data.email.toLowerCase()
          };

          // Transform to Bot API format
          const botRequest = await McpToBotApiTransformer.availabilityRequest(normalizedData, validation.data.durationMin || 30, req, botClient);
          
          // Call Bot API
          const response = await botClient.availability(botRequest);
          
          // Get user timezone for response formatting
          const userTimezone = await UserTimezoneDetector.requireUserTimezone(validation.data.timezone, req, botClient);
          
          // Transform unix timestamps to LLM-friendly ISO format with future-looking filtering
          const transformedResponse = ResponseTransformer.transformAvailabilityResponse(
            response, 
            userTimezone, 
            validation.data.includePast || false
          );
          
          return {
            content: [
              { type: 'text', text: JSON.stringify(transformedResponse) }
            ]
          };
        } catch (err) {
          const mapped = mapDownstreamError(err);
          throw new Error(`${mapped.code}: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      }
    );

    // mutual_slots tool
    server.tool(
      'mutual_slots',
      `Find time slots where all participants (including recruiter) are simultaneously free. IMPORTANT: You must have the EXACT email addresses of all participants - do NOT guess or fabricate email addresses. If the user mentions people by name only (e.g., "Hazik and Sarah"), ask them to provide the exact email addresses for each person. BUSINESS HOURS: By default, ambiguous timeframes like "next week" or "this Friday" use 9am-5pm business hours. To specify different hours, use the timeframe property with explicit times (e.g., "next week between 8am to 6pm", "this Friday from 10am to 4pm"). FUTURE-ONLY: Only future availability is returned by default (past time slots filtered out). TIMEZONE: Automatically detected from your calendar settings, or override explicitly (e.g., "America/New_York", "Europe/London"). EXAMPLES: Use "next week between 9am to 5pm" (Mon-Fri) or "next Wednesday between 8am to 7pm" for extended hours. Avoid vague expressions like a relative day combined with a part-of-day (e.g., "afternoon") without explicit time ranges. For relative dates, consider using current_time tool first.`,
      mcpToolSchemas.mutual_slots.shape,
      async (params) => {
        console.log('📥 MCP Request - mutual_slots:', JSON.stringify(params, null, 2));
        try {
          // Validate input using MCP API schema
          const validation = validateMcpRequest('mutual_slots', params);
          if (!validation.success) {
            throw new Error(`Validation failed: ${validation.errors.map(e => `${e.field}: ${e.message}`).join(', ')}`);
          }

          // Normalize emails to lowercase for case-sensitive Bot API
          const normalizedData = {
            ...validation.data,
            emails: validation.data.emails.map((email: string) => email.toLowerCase())
          };

          // Get grant user email to include in mutual availability check
          const grantUserEmail = await botClient.getGrantUserEmail();
          console.log('🔄 MCP Server mutual_slots debug:');
          console.log('  - Grant user email:', grantUserEmail);
          console.log('  - Validated data:', validation.data);
          console.log('  - Normalized data:', normalizedData);

          // Determine expected participants for filtering (requested emails + grant user)
          const expectedParticipants = ParticipantAvailabilityFilter.getExpectedParticipantsForMutualSlots(
            normalizedData.emails,
            grantUserEmail
          );
          console.log('  - Expected participants for filtering:', expectedParticipants);

          // Transform to Bot API format with grant user email
          const botRequest = await McpToBotApiTransformer.mutualSlotsRequest(normalizedData, req, grantUserEmail, botClient);
          console.log('  - Bot request:', JSON.stringify(botRequest, null, 2));
          
          // Call Bot API
          const response = await botClient.availability(botRequest);
          console.log('  - Bot response:', JSON.stringify(response, null, 2));
          
          // Get user timezone for response formatting
          const userTimezone = await UserTimezoneDetector.requireUserTimezone(normalizedData.timezone, req, botClient);
          
          // Transform unix timestamps to LLM-friendly ISO format with participant and future-looking filtering
          const transformedResponse = ResponseTransformer.transformAvailabilityResponse(
            response, 
            userTimezone, 
            validation.data.includePast || false,
            expectedParticipants
          );
          
          console.log('  - Transformed time slots count:', transformedResponse.time_slots.length);
          
          return {
            content: [
              { type: 'text', text: JSON.stringify(transformedResponse) }
            ]
          };
        } catch (err) {
          const mapped = mapDownstreamError(err);
          throw new Error(`${mapped.code}: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      }
    );

    // schedule_meeting tool
    server.tool(
      'schedule_meeting',
      `Create a meeting event with specified participants. IMPORTANT: You must have the EXACT email addresses of all participants - do NOT guess or fabricate email addresses. If the user mentions people by name only, ask them to provide the exact email addresses. Both start and end times are required. Timezone is automatically detected from your calendar settings, or can be overridden explicitly (e.g., "America/New_York", "Europe/London"). Times without timezone info are treated as local time in your detected/specified timezone. For relative times (like "next Monday at 2pm"), first use the current_time tool to get today's date in your timezone, then convert to ISO format: start: "2025-06-09T14:00:00", end: "2025-06-09T15:00:00"`,
      mcpToolSchemas.schedule_meeting.shape,
      async (params) => {
        console.log('📥 MCP Request - schedule_meeting:', JSON.stringify(params, null, 2));
        try {
          // Validate input using MCP API schema
          const validation = validateMcpRequest('schedule_meeting', params);
          if (!validation.success) {
            throw new Error(`Validation failed: ${validation.errors.map(e => `${e.field}: ${e.message}`).join(', ')}`);
          }

          // Normalize emails to lowercase for case-sensitive Bot API
          const normalizedData = {
            ...validation.data,
            emails: validation.data.emails.map((email: string) => email.toLowerCase())
          };

          // Transform to Bot API format
          const botRequest = await McpToBotApiTransformer.scheduleMeetingRequest(normalizedData, req, botClient);
          
          // Call Bot API
          const event = await botClient.createEvent(botRequest);
          
          // Get user timezone for response formatting
          const userTimezone = await UserTimezoneDetector.requireUserTimezone(normalizedData.timezone, req, botClient);
          
          // Transform unix timestamps to LLM-friendly ISO format
          const transformedEvent = ResponseTransformer.transformEventResponse(event as unknown as Record<string, unknown>, userTimezone);
          
          return {
            content: [
              { type: 'text', text: JSON.stringify(transformedEvent) }
            ]
          };
        } catch (err) {
          const mapped = mapDownstreamError(err);
          throw new Error(`${mapped.code}: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      }
    );

    // consecutive_slots tool
    server.tool(
      'consecutive_slots',
      `Find day-of options where all sessions can be booked back-to-back. IMPORTANT: You must have the EXACT email addresses of all participants for each session - do NOT guess or fabricate email addresses. If the user mentions people by name only, ask them to provide the exact email addresses for each person. BUSINESS HOURS: By default, ambiguous timeframes like "this Friday" or "next week" use 9am-5pm business hours. To specify different hours, use the timeframe property with explicit times (e.g., "this Friday between 8am to 6pm", "next Tuesday from 10am to 4pm"). FUTURE-ONLY: Only future availability is returned by default (past time slots filtered out). TIMEZONE: Automatically detected from your calendar settings, or override explicitly (e.g., "America/New_York", "Europe/London"). EXAMPLES: Use "this Friday between 9am to 5pm" (defaults), or "next Wednesday between 8am to 7pm" for extended interview days. For relative dates, consider using current_time tool first.`,
      mcpToolSchemas.consecutive_slots.shape,
      async (params) => {
        console.log('📥 MCP Request - consecutive_slots:', JSON.stringify(params, null, 2));
        try {
          // Validate input using MCP API schema
          const validation = validateMcpRequest('consecutive_slots', params);
          if (!validation.success) {
            throw new Error(`Validation failed: ${validation.errors.map(e => `${e.field}: ${e.message}`).join(', ')}`);
          }

          // Normalize emails to lowercase for case-sensitive Bot API
          const normalizedData = {
            ...validation.data,
            sessions: validation.data.sessions.map((session: { label: string; emails: string[]; durationMin: number }) => ({
              ...session,
              emails: session.emails.map((email: string) => email.toLowerCase())
            }))
          };

          // Use consecutive slots computer with normalized data
          const blocks = await computeConsecutiveSlots({
            sessions: normalizedData.sessions,
            timeframe: normalizedData.timeframe,
            gapMaxMin: normalizedData.gapMaxMin,
            timezone: normalizedData.timezone,
            includePast: validation.data.includePast || false,
            maxResults: 10,
            botClient, // Pass the authenticated client
            httpRequest: req // Pass HTTP request for timezone context
          });
          
          return {
            content: [
              { type: 'text', text: JSON.stringify(blocks) }
            ]
          };
        } catch (err) {
          const mapped = mapDownstreamError(err);
          throw new Error(`${mapped.code}: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      }
    );

    // current_time tool
    server.tool(
      'current_time',
      `Get the current date and time in the user's timezone. Use this tool to get today's date for relative time queries like "tomorrow", "next Monday", etc. Returns current date, time, day of week, and timezone information.`,
      mcpToolSchemas.current_time.shape,
      async (params) => {
        console.log('📥 MCP Request - current_time:', JSON.stringify(params, null, 2));
        try {
          // Validate input using MCP API schema
          const validation = validateMcpRequest('current_time', params);
          if (!validation.success) {
            throw new Error(`Validation failed: ${validation.errors.map(e => `${e.field}: ${e.message}`).join(', ')}`);
          }

          // Require user timezone for accurate current time
          const userTimezone = await UserTimezoneDetector.requireUserTimezone(validation.data.timezone, req, botClient);
          
          // Get current time in user's timezone
          const currentTimeInfo = DateTimeTransformer.getCurrentTimeInTimezone(userTimezone);
          
          return {
            content: [
              { 
                type: 'text', 
                text: JSON.stringify({
                  ...currentTimeInfo,
                  message: `Current time in ${userTimezone}: ${currentTimeInfo.dayOfWeek}, ${currentTimeInfo.currentDateTime}`
                }, null, 2)
              }
            ]
          };
        } catch (err) {
          const mapped = mapDownstreamError(err);
          throw new Error(`${mapped.code}: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      }
    );

    // user_info tool
    server.tool(
      'user_info',
      `Get current user information including email, provider, timezone, and organization details. Useful for understanding the authenticated user's context and timezone preferences.`,
      mcpToolSchemas.user_info.shape,
      async (params) => {
        console.log('📥 MCP Request - user_info:', JSON.stringify(params, null, 2));
        try {
          // Validate input using MCP API schema
          const validation = validateMcpRequest('user_info', params);
          if (!validation.success) {
            throw new Error(`Validation failed: ${validation.errors.map(e => `${e.field}: ${e.message}`).join(', ')}`);
          }

          // Get user info from the Bot API
          const userInfo = await botClient.getUserInfo();
          
          return {
            content: [
              { 
                type: 'text', 
                text: JSON.stringify({
                  ...userInfo,
                  message: `Authenticated user: ${userInfo.email} (${userInfo.provider})${userInfo.timezone ? ` in timezone ${userInfo.timezone}` : ''}`
                }, null, 2)
              }
            ]
          };
        } catch (err) {
          const mapped = mapDownstreamError(err);
          throw new Error(`${mapped.code}: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      }
    );

    // DEBUG ONLY: Get events tool (only available in dev mode)
    if (process.env.NODE_ENV === 'development') {
      server.tool(
        'debug_get_events',
        `[DEBUG ONLY - DEV MODE] Get events for a given email address to debug availability checks. IMPORTANT: You must have the EXACT email address - do NOT guess or fabricate email addresses. Always assumes calendar_id is 'primary'. This tool helps verify if a user has events during a time period when debugging availability results. For relative dates (like "next Monday"), first use the current_time tool to get today's date in your timezone, then convert to ISO format: start: "2025-06-09T12:00", end: "2025-06-09T18:00". Avoid vague timeframes that omit explicit times (e.g., a relative day combined with "afternoon").`,
        mcpToolSchemas.debug_get_events.shape,
        async (params) => {
          console.log('📥 MCP Request - debug_get_events:', JSON.stringify(params, null, 2));
          try {
            // Validate input using MCP API schema
            const validation = validateMcpRequest('debug_get_events', params);
            if (!validation.success) {
              throw new Error(`Validation failed: ${validation.errors.map(e => `${e.field}: ${e.message}`).join(', ')}`);
            }

            // Normalize email to lowercase for case-sensitive Bot API
            const normalizedData = {
              ...validation.data,
              email: validation.data.email.toLowerCase()
            };

            // Transform to Bot API format
            const botRequest = await McpToBotApiTransformer.debugGetEventsRequest(normalizedData, req, botClient);
            
            console.log('🔍 DEBUG: Getting events for email:', normalizedData.email);
            console.log('🔍 DEBUG: Time range:', new Date(botRequest.start_time * 1000).toISOString(), 'to', new Date(botRequest.end_time * 1000).toISOString());
            
            // Call Bot API
            const events = await botClient.getEvents(botRequest);
            
            console.log('🔍 DEBUG: Found', events?.data?.length || 0, 'events');
            
            // Get user timezone for response formatting
            const userTimezone = await UserTimezoneDetector.requireUserTimezone(normalizedData.timezone, req, botClient);
            
            return {
              content: [
                { 
                  type: 'text', 
                  text: JSON.stringify({
                    email: normalizedData.email,
                    timeRange: {
                      start: ResponseTransformer.timestampToISOWithTimezone(botRequest.start_time, userTimezone),
                      end: ResponseTransformer.timestampToISOWithTimezone(botRequest.end_time, userTimezone)
                    },
                    eventsCount: events?.data?.length || 0,
                    events: ResponseTransformer.transformResponse(events, userTimezone)
                  }, null, 2)
                }
              ]
            };
          } catch (err) {
            const mapped = mapDownstreamError(err);
            throw new Error(`${mapped.code}: ${err instanceof Error ? err.message : 'Unknown error'}`);
          }
        }
      );
    }
  }, 
  {
    // Optional server options
  },
  {
    // MCP adapter configuration for SSE support
    maxDuration: 60,
    verboseLogs: true,
  });

  // Call the MCP handler with the request
  console.log('📞 Calling MCP handler...');
  try {
    const response = await mcpHandler(req);
    console.log('✅ MCP handler completed successfully');
    return response;
  } catch (error) {
    console.error('❌ MCP handler error:', error);
    return new Response(JSON.stringify({ 
      error: 'Internal server error', 
      message: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export const GET = withAuth;
export const POST = withAuth;
export const DELETE = withAuth;

// Force dynamic rendering to avoid build-time evaluation
export const dynamic = 'force-dynamic';