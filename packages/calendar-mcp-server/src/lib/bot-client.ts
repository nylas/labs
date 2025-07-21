// Bot API client for MCP server to communicate with the existing Bot API

import { BotApiAvailabilityRequest, BotApiAvailabilityResponse, BotApiEventCreateRequest, BotApiEventResponse } from "../shared-types";

const BOT_API_URL = process.env.BOT_API_URL || "http://localhost:3001";

// Create bot client with user-specific token
export function createBotClientWithToken(userToken: string) {
  const headers = {
    Authorization: `Bearer ${userToken}`,
    "Content-Type": "application/json",
  };

  return {
    // Get availability for participants - accepts Bot API format
    async availability(
          body: BotApiAvailabilityRequest
  ): Promise<BotApiAvailabilityResponse> {
      const response = await fetch(
        `${BOT_API_URL}/api/proxy/calendars/availability`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        }
      );

      if (!response.ok) {
        throw new Error(
          `Bot API availability error: ${response.status} ${await response.text()}`
        );
      }

      return response.json();
    },

    // Create an event - accepts Bot API format
    async createEvent(
          body: BotApiEventCreateRequest
  ): Promise<BotApiEventResponse> {
      // Extract calendar_id from body and pass as query parameter
      const { calendar_id = "primary", ...eventBody } = body;
      const url = new URL(`${BOT_API_URL}/api/proxy/events`);
      url.searchParams.set("calendar_id", calendar_id);

      const response = await fetch(url.toString(), {
        method: "POST",
        headers,
        body: JSON.stringify(eventBody),
      });

      if (!response.ok) {
        throw new Error(
          `Bot API create event error: ${response.status} ${await response.text()}`
        );
      }

      return response.json();
    },

    // Get grant user's email from JWT token
    async getGrantUserEmail(): Promise<string> {
      const response = await fetch(`${BOT_API_URL}/api/auth/me`, {
        method: "GET",
        headers,
      });

      if (!response.ok) {
        throw new Error(
          `Bot API get grant user error: ${response.status} ${await response.text()}`
        );
      }

      const data = await response.json();
      return data.email;
    },

    // Get full user info including timezone
    async getUserInfo(): Promise<{
      grant_id: string;
      email: string;
      provider: string;
      org_id: string;
      timezone: string | null;
    }> {
      const response = await fetch(`${BOT_API_URL}/api/auth/me`, {
        method: "GET",
        headers,
      });

      if (!response.ok) {
        throw new Error(
          `Bot API get user info error: ${response.status} ${await response.text()}`
        );
      }

      const data = await response.json();
      return {
        grant_id: data.grant_id,
        email: data.email,
        provider: data.provider,
        org_id: data.org_id,
        timezone: data.timezone,
      };
    },

    // Health check - ping the Bot API
    async healthCheck(): Promise<boolean> {
      try {
        const response = await fetch(`${BOT_API_URL}/api/health`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${userToken}`,
          },
        });
        return response.ok;
      } catch (error) {
        console.error("Bot API health check failed:", error);
        return false;
      }
    },

    // DEBUG ONLY: Get events for debugging (dev mode only)
    async getEvents(params: {
      email: string;
      start_time: number;
      end_time: number;
    }): Promise<{
      data?: unknown[];
      debug?: Record<string, unknown>;
      [key: string]: unknown;
    }> {
      // Construct the URL with query parameters
      // Try basic events call first without time filtering to see if endpoint works
      const url = new URL(`${BOT_API_URL}/api/proxy/events`);
      url.searchParams.set("calendar_id", "primary");
      url.searchParams.set("limit", "50"); // Get recent events for debugging

      console.log("🔍 DEBUG: Making events API call with URL:", url.toString());

      const response = await fetch(url.toString(), {
        method: "GET",
        headers,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          "🔍 DEBUG: Events API error:",
          response.status,
          errorText
        );
        throw new Error(
          `Bot API get events error: ${response.status} ${errorText}`
        );
      }

      const result = await response.json();

      // Filter events by time range in the response
      if (result.data && Array.isArray(result.data)) {
        const filteredEvents = result.data.filter(
          (event: Record<string, unknown>) => {
            const when = event.when as Record<string, unknown> | undefined;
            if (!when) return false;

            const eventStart =
              (when.start_time as number) ||
              new Date((when.start_date || when.date) as string).getTime() /
                1000;
            const eventEnd =
              (when.end_time as number) ||
              new Date((when.end_date || when.date) as string).getTime() / 1000;

            // Check if event overlaps with requested time range
            return eventStart < params.end_time && eventEnd > params.start_time;
          }
        );

        console.log(
          `🔍 DEBUG: Filtered ${filteredEvents.length} events from ${result.data.length} total events in time range`
        );

        return {
          ...result,
          data: filteredEvents,
          debug: {
            totalEvents: result.data.length,
            filteredEvents: filteredEvents.length,
            timeRange: {
              start: new Date(params.start_time * 1000).toISOString(),
              end: new Date(params.end_time * 1000).toISOString(),
            },
          },
        };
      }

      return result;
    },
  };
}

// Error mapping function as specified in design document
export function mapDownstreamError(err: unknown): {
  status: number;
  code: string;
} {
  if (err && typeof err === "object" && "status" in err) {
    const errorWithStatus = err as { status: number };
    if (errorWithStatus.status === 401)
      return { status: 401, code: "unauthorized" };
    if (errorWithStatus.status === 400)
      return { status: 400, code: "invalid_params" };
  }
  return { status: 502, code: "downstream_failure" };
}
