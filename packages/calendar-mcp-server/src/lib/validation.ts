import { z } from "zod";
import { BotApiAvailabilityRequest, BotApiEventCreateRequest } from "../shared-types";
import { baseSchemas } from './base-schemas';
import { formatInTimeZone } from 'date-fns-tz';
import { parseDateRange, parseToDate, detectOpenHours } from "./custom-chrono";
import { getCurrentTimeInfo } from "./date-parser";

// Configurable: Maximum allowed meeting duration for short meetings (in hours)
export const MAX_MEETING_DURATION_HOURS = parseInt(process.env.MCP_MAX_MEETING_DURATION_HOURS || '12', 10);

// Forward declaration for BotClient type
interface BotClient {
  getUserInfo(): Promise<{
    grant_id: string;
    email: string;
    provider: string;
    org_id: string;
    timezone: string | null;
  }>;
}

// ==============================================
// USER TIMEZONE DETECTION
// ==============================================

/**
 * Utility for detecting user timezone from various sources
 */
export class UserTimezoneDetector {
  /**
   * Extract timezone from HTTP request headers
   */
  static extractFromHeaders(request?: Request): string | null {
    if (!request) return null;

    try {
      // Check for explicit timezone headers (custom headers that MCP clients could send)
      const explicitTz =
        request.headers.get("X-User-Timezone") ||
        request.headers.get("X-Timezone") ||
        request.headers.get("Timezone");

      if (explicitTz) {
        try {
          Intl.DateTimeFormat(undefined, { timeZone: explicitTz });
          console.log(`🌍 Detected user timezone from headers: ${explicitTz}`);
          return explicitTz;
        } catch {
          console.warn(`Invalid timezone in header '${explicitTz}'`);
        }
      }
    } catch (error) {
      console.warn("Error extracting timezone from request headers:", error);
    }

    return null;
  }

  /**
   * Get user timezone from calendar API
   */
  static async extractFromCalendar(botClient?: BotClient): Promise<string | null> {
    if (!botClient) return null;

    try {
      const userInfo = await botClient.getUserInfo();
      if (userInfo.timezone) {
        try {
          Intl.DateTimeFormat(undefined, { timeZone: userInfo.timezone });
          console.log(`🌍 Detected user timezone from calendar: ${userInfo.timezone}`);
          return userInfo.timezone;
        } catch {
          console.warn(`Invalid timezone from calendar '${userInfo.timezone}'`);
        }
      }
    } catch (error) {
      console.warn("Error extracting timezone from calendar:", error);
    }

    return null;
  }

  /**
   * Require explicit timezone with helpful error messages
   * @param explicitTimezone Timezone provided by user
   * @param request HTTP request for header extraction (optional)
   * @param botClient Bot client for calendar timezone extraction (optional)
   * @returns Valid timezone or throws descriptive error
   */
  static async requireUserTimezone(
    explicitTimezone?: string,
    request?: Request,
    botClient?: BotClient
  ): Promise<string> {
    // 1. Use explicit timezone if provided and valid
    if (explicitTimezone) {
      try {
        Intl.DateTimeFormat(undefined, { timeZone: explicitTimezone });
        return explicitTimezone;
      } catch {
        throw new McpValidationError(
          "timezone",
          `Invalid timezone '${explicitTimezone}'. Use IANA timezone format like 'America/New_York', 'Europe/London', or 'UTC'. Find your timezone at: https://en.wikipedia.org/wiki/List_of_tz_database_time_zones`
        );
      }
    }

    // 2. Try to extract from HTTP request headers as fallback
    const headerTimezone = this.extractFromHeaders(request);
    if (headerTimezone) {
      return headerTimezone;
    }

    // 3. Try to extract from calendar API as fallback
    const calendarTimezone = await this.extractFromCalendar(botClient);
    if (calendarTimezone) {
      return calendarTimezone;
    }

    // 4. Require explicit timezone with helpful error
    throw new McpValidationError(
      "timezone",
      `Timezone is required for accurate time handling. Please specify your timezone using the 'timezone' parameter. Examples: 'America/New_York' (Eastern), 'America/Los_Angeles' (Pacific), 'Europe/London' (GMT), 'Asia/Tokyo' (JST), or 'UTC'. Find your timezone at: https://en.wikipedia.org/wiki/List_of_tz_database_time_zones`
    );
  }

  /**
   * Synchronous version for backwards compatibility
   * @deprecated Use requireUserTimezone instead
   */
  static requireUserTimezoneSync(
    explicitTimezone?: string,
    request?: Request
  ): string {
    // 1. Use explicit timezone if provided and valid
    if (explicitTimezone) {
      try {
        Intl.DateTimeFormat(undefined, { timeZone: explicitTimezone });
        return explicitTimezone;
      } catch {
        throw new McpValidationError(
          "timezone",
          `Invalid timezone '${explicitTimezone}'. Use IANA timezone format like 'America/New_York', 'Europe/London', or 'UTC'. Find your timezone at: https://en.wikipedia.org/wiki/List_of_tz_database_time_zones`
        );
      }
    }

    // 2. Try to extract from HTTP request headers as fallback
    const headerTimezone = this.extractFromHeaders(request);
    if (headerTimezone) {
      return headerTimezone;
    }

    // 3. Require explicit timezone with helpful error
    throw new McpValidationError(
      "timezone",
      `Timezone is required for accurate time handling. Please specify your timezone using the 'timezone' parameter. Examples: 'America/New_York' (Eastern), 'America/Los_Angeles' (Pacific), 'Europe/London' (GMT), 'Asia/Tokyo' (JST), or 'UTC'. Find your timezone at: https://en.wikipedia.org/wiki/List_of_tz_database_time_zones`
    );
  }
}

// ==============================================
// OPEN HOURS CONFIGURATION
// ==============================================

/**
 * Utility for detecting and configuring open hours from timeframe expressions
 */
export class OpenHoursDetector {
  /**
   * Detect if open hours should be configured for a given timeframe
   * @param timeframe The timeframe expression
   * @param userTimezone User's timezone
   * @returns Open hours configuration or null if not applicable
   */
  static detectFromTimeframe(
    timeframe: string,
    userTimezone: string
  ): Array<{
    days: number[];
    timezone: string;
    start: string;
    end: string;
    exdates?: string[];
  }> | null {
    try {
      const openHours = detectOpenHours(timeframe, userTimezone);
      
      if (!openHours) {
        return null;
      }

      // Convert to Nylas API format
      return [{
        days: openHours.days,
        timezone: openHours.timezone,
        start: openHours.start,
        end: openHours.end
      }];
    } catch (error) {
      console.warn('Error detecting open hours from timeframe:', error);
      return null;
    }
  }

  /**
   * Apply open hours configuration to an availability request if detected
   * @param request The Bot API availability request
   * @param timeframe The original timeframe expression
   * @param userTimezone User's timezone
   * @returns Updated request with open hours configured if applicable
   */
  static applyOpenHours(
    request: BotApiAvailabilityRequest,
    timeframe: string | undefined,
    userTimezone: string
  ): BotApiAvailabilityRequest {
    if (!timeframe) {
      return request;
    }

    const openHours = this.detectFromTimeframe(timeframe, userTimezone);
    
    if (!openHours) {
      return request;
    }

    // Initialize availability_rules if it doesn't exist
    if (!request.availability_rules) {
      request.availability_rules = {};
    }

    // Set default open hours
    request.availability_rules.default_open_hours = openHours;

    console.log(`✅ Applied open hours configuration: ${openHours[0].start}-${openHours[0].end} on days ${openHours[0].days.join(',')} in ${openHours[0].timezone}`);
    
    return request;
  }
}

// ==============================================
// MCP API INPUT VALIDATION
// ==============================================
// Calendar MCP Server is responsible for:
// 1. Validating user input format
// 2. Converting user-friendly formats to internal API formats
// 3. Providing clear error messages to MCP clients

// Custom validation error class
export class McpValidationError extends Error {
  constructor(
    public field: string,
    message: string
  ) {
    super(message);
    this.name = "McpValidationError";
  }
}



export interface McpValidationErrorDetail {
  field: string;
  message: string;
}

// ==============================================
// VALIDATION HELPER FUNCTIONS
// ==============================================

function smartValidateTimeRange(data: {
  timeframe?: string;
  start?: string;
  end?: string;
}): {
  isValid: boolean;
  needsInference: boolean;
  inferenceType?: 'end_from_start' | 'timeframe_from_start';
  message?: string;
} {
  const hasTimeframe = Boolean(data.timeframe);
  const hasStart = Boolean(data.start);
  const hasEnd = Boolean(data.end);

  // Valid combinations:
  // 1. timeframe only
  // 2. start + end
  // 3. start only (end will be inferred)
  if (hasTimeframe) {
    return { isValid: true, needsInference: false };
  }
  if (hasStart && hasEnd) {
    return { isValid: true, needsInference: false };
  }
  if (hasStart && !hasEnd) {
    return { 
      isValid: true, 
      needsInference: true, 
      inferenceType: 'end_from_start',
      message: 'End time will be inferred from start time'
    };
  }

  // Invalid: no valid combination provided
  return { 
    isValid: false, 
    needsInference: false,
    message: "Must provide either 'timeframe' OR 'start' time OR both 'start' and 'end' times"
  };
}

// MCP API Request Schemas (User-Facing) - Enhanced with LLM-friendly validation using base schemas
export const mcpRequestSchemas = {
  my_availability: baseSchemas.my_availability.refine(data => {
    const validation = smartValidateTimeRange(data);
    return validation.isValid;
  }, {
    message: "Must provide either 'timeframe' (e.g., 'next week') OR 'start' time (end time will be inferred if not provided) OR both 'start' and 'end' times"
  }),

  contact_availability: baseSchemas.contact_availability.refine(data => {
    const validation = smartValidateTimeRange(data);
    return validation.isValid;
  }, {
    message: "Must provide either 'timeframe' (e.g., 'next week') OR 'start' time (end time will be inferred if not provided) OR both 'start' and 'end' times"
  }),

  mutual_slots: baseSchemas.mutual_slots.refine(data => {
    const validation = smartValidateTimeRange(data);
    return validation.isValid;
  }, {
    message: "Must provide either 'timeframe' (e.g., 'next week') OR 'start' time (end time will be inferred if not provided) OR both 'start' and 'end' times"
  }),

  schedule_meeting: baseSchemas.schedule_meeting.refine(data => {
    return data.start && data.end;
  }, {
    message: "Must provide both 'start' and 'end' times"
  }),

  consecutive_slots: baseSchemas.consecutive_slots.refine(data => {
    const validation = smartValidateTimeRange(data);
    return validation.isValid;
  }, {
    message: "Must provide either 'timeframe' (e.g., 'next week') OR 'start' time (end time will be inferred if not provided) OR both 'start' and 'end' times"
  }),

  current_time: baseSchemas.current_time,

  user_info: baseSchemas.user_info,

  // DEBUG ONLY: Get events for an email address (dev mode only)
  debug_get_events: baseSchemas.debug_get_events.refine(data => {
    const validation = smartValidateTimeRange(data);
    return validation.isValid;
  }, {
    message: "Must provide either 'timeframe' OR 'start' time (end time will be inferred if not provided) OR both 'start' and 'end' times"
  }),
} as const;

// ==============================================
// VALIDATION FUNCTION
// ==============================================

export function validateMcpRequest<T extends keyof typeof mcpRequestSchemas>(
  operation: T,
  data: unknown
):
  | { success: true; data: z.infer<(typeof mcpRequestSchemas)[T]> }
  | { success: false; errors: McpValidationErrorDetail[] } {
  try {
    // Normalize null values to undefined for better LLM compatibility
    const normalizedData = normalizeNullValues(data);
    console.log(`🔍 MCP validation for ${operation}:`, { original: data, normalized: normalizedData });
    
    const result = mcpRequestSchemas[operation].parse(normalizedData);
    return { success: true, data: result };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errors: McpValidationErrorDetail[] = error.errors.map((err) => ({
        field: err.path.join('.') || 'unknown',
        message: err.message,
      }));
      console.log(`❌ MCP validation failed for ${operation}:`, { errors, originalData: data });
      return { success: false, errors };
    }
    console.log(`❌ MCP validation error for ${operation}:`, error);
    return {
      success: false,
      errors: [{ field: 'unknown', message: 'Validation failed' }],
    };
  }
}

// ==============================================
// DATA TRANSFORMATION UTILITIES
// ==============================================
// These functions handle the transformation between user-friendly MCP API
// and internal Bot API formats

export class DateTimeTransformer {
  /**
   * Parse timeframe into Unix timestamps with smart defaults
   * @param timeframe Natural language timeframe
   * @param userTimezone User's timezone
   * @param includePast Whether to include past time slots
   * @param referenceDate Reference date to use for parsing
   * @returns Unix timestamps for start and end
   */
  static parseTimeframeToDates(timeframe: string, userTimezone: string, referenceDate?: Date): { start: Date; end: Date } {
    try {
      const { start, end } = parseDateRange(timeframe, referenceDate, userTimezone);

      if (!start || !end) {
        throw new McpValidationError("timeframe", "Invalid timeframe result");
      }
      
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        throw new Error(`Invalid timeframe result: ${start} to ${end}`);
      }

      if (start > end) {
        throw new McpValidationError("timeframe", "Start time must be before end time");
      }

      return {
        start,
        end,
      };
    } catch (error) {
      if (error instanceof McpValidationError) {
        throw error;
      }
      if (error instanceof Error) {
        throw new McpValidationError("timeframe", error.message);
      }
      throw new McpValidationError("timeframe", `Failed to parse timeframe: ${timeframe}`);
    }
  }

  /**
   * Parse input parameters into Unix timestamps (handles all patterns)
   * @param input Input parameters object
   * @param userTimezone User's timezone
   * @returns Unix timestamps for start and end
   */
  static parseInputToUnixTimestamps(
    input: {
      timeframe?: string;
      start?: string;
      end?: string;
      duration?: string;
    },
    userTimezone: string
  ): { start_time: number; end_time: number; adjustmentMessage?: string } {
    let start: Date, end: Date;
    let adjustmentMessage: string | undefined;

    // Pattern 1: Timeframe
    if (input.timeframe) {
      console.log(`🔄 Parsing timeframe: ${input.timeframe} in ${userTimezone}`);
      const result = this.parseTimeframeToDates(input.timeframe, userTimezone);
      start = result.start;
      end = result.end;
    }
    // Pattern 2: Start + End (explicit times)
    else if (input.start && input.end) {
      console.log(`🔄 Parsing start and end: ${input.start} to ${input.end} in ${userTimezone}`);
      const parsedStart = parseToDate(input.start, new Date(), userTimezone);
      if (!parsedStart) {
        throw new McpValidationError("start", `Invalid start time result: ${input.start}`);
      }
      const parsedEnd = parseToDate(input.end, new Date(), userTimezone);
      if (!parsedEnd) {
        throw new McpValidationError("end", `Invalid end time result: ${input.end}`);
      }
      start = parsedStart;
      end = parsedEnd;
    }
    // Pattern 3: Only Start provided - infer end time for availability checks
    else if (input.start && !input.end) {
      console.log(`🔄 Inferring end time from start: ${input.start} in ${userTimezone}`);
      const result = this.parseStartWithInferredEnd(input.start, userTimezone);
      start = result.start;
      end = result.end;
    }
    else {
      throw new McpValidationError("input", "Must provide either 'timeframe', or 'start' + 'end', or just 'start' (end will be inferred)");
    }
    
    // Convert back to unix timestamps
    const start_time = this.roundToFiveMinutes(Math.floor(start.getTime() / 1000));
    const end_time = this.roundToFiveMinutes(Math.floor(end.getTime() / 1000));
    
    if (start_time >= end_time) {
      throw new McpValidationError("datetime", "Start time must be before end time");
    }
    
    const result: { start_time: number; end_time: number; adjustmentMessage?: string } = { start_time, end_time };
    if (adjustmentMessage) {
      result.adjustmentMessage = adjustmentMessage;
    }
    
    return result;
  }
  
  /**
   * Parse start time and infer a reasonable end time for availability checks
   * @param start Start time string
   * @param userTimezone User's timezone
   * @param referenceDate Reference date to use for parsing
   * @returns Unix timestamps for start and inferred end
   */
  static parseStartWithInferredEnd(start: string, userTimezone: string, referenceDate?: Date): { start: Date; end: Date } {
    try {
      // Parse the start time
      const startDate = parseToDate(start, referenceDate, userTimezone);

      if (!startDate) {
        throw new McpValidationError("start", `Invalid start time result: ${start}`);
      }
      
      if (isNaN(startDate.getTime())) {
        throw new Error(`Invalid start time result: ${start}`);
      }

      // Infer end time based on the start time
      const endDate = this.inferEndTime(startDate, userTimezone);
      
      if (startDate > endDate) {
        throw new McpValidationError("start", "Inferred end time must be after start time");
      }

      console.log(`✅ Inferred time range: ${start} → ${endDate}`);
      
      return {
        start: startDate,
        end: endDate,
      };
    } catch (error) {
      if (error instanceof McpValidationError) {
        throw error;
      }
      if (error instanceof Error) {
        throw new McpValidationError("start", error.message);
      }
      throw new McpValidationError("start", `Failed to parse start time and infer end: ${start}`);
    }
  }

  /**
   * Infer a reasonable end time based on start time
   * @param startDate Start date
   * @param userTimezone User's timezone
   * @returns Inferred end date
   */
  private static inferEndTime(startDate: Date, userTimezone: string): Date {
    const endDate = new Date(startDate);
    
    // Get the hour of the start time in the user's timezone
    const hourInTz = parseInt(new Intl.DateTimeFormat('en', {
      timeZone: userTimezone,
      hour: '2-digit',
      hour12: false
    }).format(startDate));
    
    // If start is in morning/afternoon (before 2 PM), infer end as end of business day (5 PM)
    if (hourInTz < 14) {
      endDate.setHours(17, 0, 0, 0); // 5 PM
      
      // If that's on the same day as start, use it
      if (endDate > startDate) {
        return endDate;
      }
    }
    
    // Otherwise, infer end as start + 8 hours (full business day)
    const eightHoursLater = new Date(startDate.getTime() + (8 * 60 * 60 * 1000));
    return eightHoursLater;
  }

  /**
   * Rounds Unix timestamp to nearest 5-minute interval (Nylas requirement)
   * @param timestamp Unix timestamp in seconds
   * @returns Unix timestamp rounded to 5-minute boundary
   */
  private static roundToFiveMinutes(timestamp: number): number {
    const FIVE_MINUTES = 5 * 60; // 5 minutes in seconds
    return Math.floor(timestamp / FIVE_MINUTES) * FIVE_MINUTES;
  }

  /**
   * Get current date and time in a specific timezone
   * @param timezone IANA timezone identifier
   * @returns Current date/time info in the specified timezone
   */
  static getCurrentTimeInTimezone(timezone: string): {
    currentDate: string; // YYYY-MM-DD
    currentTime: string; // HH:MM
    currentDateTime: string; // YYYY-MM-DDTHH:MM
    isoString: string; // Full ISO string
    dayOfWeek: string; // Monday, Tuesday, etc.
    timezone: string; // The timezone used
  } {
    return getCurrentTimeInfo(timezone);
  }
}

export class McpToBotApiTransformer {
  /**
   * Transform MCP availability request to Bot API format (enhanced for timeframes)
   */
  static async availabilityRequest(
    mcpRequest: {
      timeframe?: string;
      start?: string;
      end?: string;
      email?: string;
      bufferMinutes?: number;
      timezone?: string;
    },
    durationMin: number = 30,
    httpRequest?: Request,
    botClient?: BotClient
  ): Promise<BotApiAvailabilityRequest> {
    // Require user timezone for accurate time handling
    const userTimezone = await UserTimezoneDetector.requireUserTimezone(
      mcpRequest.timezone,
      httpRequest,
      botClient
    );
    
    // Use new parsing method that handles all patterns
    const timestamps = DateTimeTransformer.parseInputToUnixTimestamps(
      {
        timeframe: mcpRequest.timeframe,
        start: mcpRequest.start,
        end: mcpRequest.end,
      },
      userTimezone,
    );

    const botRequest: BotApiAvailabilityRequest = {
      ...timestamps,
      duration_minutes: durationMin,
    };

    // Add participants for contact availability
    if ("email" in mcpRequest && mcpRequest.email) {
      botRequest.participants = [{ email: mcpRequest.email }];
    }

    // Add buffer configuration if specified
    if (mcpRequest.bufferMinutes !== undefined) {
      botRequest.availability_rules = {
        buffer: {
          before: mcpRequest.bufferMinutes,
          after: mcpRequest.bufferMinutes,
        },
      };
      botRequest.tentative_as_busy = true;
    }

    // Apply open hours configuration
    const openHours = OpenHoursDetector.applyOpenHours(botRequest, mcpRequest.timeframe, userTimezone);

    return openHours;
  }

  /**
   * Transform MCP mutual slots request to Bot API format (enhanced for timeframes)
   */
  static async mutualSlotsRequest(
    mcpRequest: {
      timeframe?: string;
      start?: string;
      end?: string;
      emails: string[];
      durationMin: number;
      bufferMinutes?: number;
      timezone?: string;
      includePast?: boolean;
    },
    httpRequest?: Request,
    grantUserEmail?: string,
    botClient?: BotClient
  ): Promise<BotApiAvailabilityRequest> {
    // Require user timezone for accurate time handling
    const userTimezone = await UserTimezoneDetector.requireUserTimezone(
      mcpRequest.timezone,
      httpRequest,
      botClient
    );
    
    // Use new parsing method that handles all patterns
    const timestamps = DateTimeTransformer.parseInputToUnixTimestamps(
      {
        timeframe: mcpRequest.timeframe,
        start: mcpRequest.start,
        end: mcpRequest.end,
      },
      userTimezone,
    );

    const request: BotApiAvailabilityRequest = {
      ...timestamps,
      duration_minutes: mcpRequest.durationMin,
    };

    // For mutual availability, we need ALL participants to get the intersection
    // Include the grant user email if provided, plus all external participants
    const allParticipants = grantUserEmail 
      ? [grantUserEmail, ...mcpRequest.emails]
      : mcpRequest.emails;
    
    request.participants = allParticipants.map((email: string) => ({
      email,
    }));

    // Add buffer configuration if specified
    if (mcpRequest.bufferMinutes !== undefined) {
      request.availability_rules = {
        buffer: {
          before: mcpRequest.bufferMinutes,
          after: mcpRequest.bufferMinutes,
        },
      };
      request.tentative_as_busy = true;
    }

    // Apply open hours configuration
    const openHours = OpenHoursDetector.applyOpenHours(request, mcpRequest.timeframe, userTimezone);

    return openHours;
  }

  /**
   * Transform MCP schedule meeting request to Bot API format (no duration support)
   */
  static async scheduleMeetingRequest(
    mcpRequest: {
      start: string;
      end: string;
      emails: string[];
      title: string;
      description?: string;
      timezone?: string;
    },
    httpRequest?: Request,
    botClient?: BotClient
  ): Promise<BotApiEventCreateRequest> {
    // Require user timezone for accurate time handling
    const userTimezone = await UserTimezoneDetector.requireUserTimezone(
      mcpRequest.timezone,
      httpRequest,
      botClient
    );
    
    // Use parsing method that handles start and end times
    const timestamps = DateTimeTransformer.parseInputToUnixTimestamps(
      {
        start: mcpRequest.start,
        end: mcpRequest.end
      },
      userTimezone
    );

    // Validate meeting duration does not exceed configurable maximum
    const durationSeconds = timestamps.end_time - timestamps.start_time;
    const maxDurationSeconds = MAX_MEETING_DURATION_HOURS * 60 * 60;
    if (durationSeconds > maxDurationSeconds) {
      throw new McpValidationError(
        "datetime",
        `The meeting duration is unusually long (over ${MAX_MEETING_DURATION_HOURS} hours). Please check your start and end times, or specify a shorter meeting. If you intended a long meeting, ask your admin to increase the maximum allowed duration.`
      );
    }

    const eventRequest: BotApiEventCreateRequest = {
      calendar_id: "primary", // This will be extracted and sent as query param by bot-client
      title: mcpRequest.title,
      when: {
        start_time: timestamps.start_time,
        end_time: timestamps.end_time,
      },
      participants: mcpRequest.emails.map((email: string) => ({ email })),
    };

    // Add description if provided
    if (mcpRequest.description) {
      eventRequest.description = mcpRequest.description;
    }

    return eventRequest;
  }

  /**
   * Transform MCP debug get events request to Bot API format (enhanced for timeframes)
   */
  static async debugGetEventsRequest(
    mcpRequest: {
      email: string;
      timeframe?: string;
      start?: string;
      end?: string;
      timezone?: string;  
    },
    httpRequest?: Request,
    botClient?: BotClient
  ): Promise<{ start_time: number; end_time: number; email: string }> {
    // Require user timezone for accurate time handling
    const userTimezone = await UserTimezoneDetector.requireUserTimezone(
      mcpRequest.timezone,
      httpRequest,
      botClient
    );
    
    // Use new parsing method that handles all patterns
    const timestamps = DateTimeTransformer.parseInputToUnixTimestamps(
      {
        timeframe: mcpRequest.timeframe,
        start: mcpRequest.start,
        end: mcpRequest.end,
      },
      userTimezone,
    );

    return {
      ...timestamps,
      email: mcpRequest.email.toLowerCase()
    };
  }
}

// ==============================================
// RESPONSE TRANSFORMER FOR LLM-FRIENDLY OUTPUT
// ==============================================

/**
 * Transforms unix timestamps in responses to human-readable ISO format with timezone information
 * This ensures LLMs can understand and work with the date/time data without additional tooling
 */
export class ResponseTransformer {
      /**
   * Convert unix timestamp to ISO string with timezone information
   * @param timestamp Unix timestamp in seconds
   * @param timezone User's timezone (IANA format)
   * @returns ISO string with timezone offset (e.g., "2025-06-09T14:00:00-04:00")
   */
  static timestampToISOWithTimezone(timestamp: number, timezone: string): string {
    // Ensure we're working with an integer timestamp to avoid precision issues
    const intTimestamp = Math.floor(timestamp);
    
    // Create Date object from unix timestamp (always represents the same absolute moment in time)
    const date = new Date(intTimestamp * 1000);
    
    // Special case for UTC - use built-in ISO string and replace Z suffix
    if (timezone === 'UTC') {
      return date.toISOString().replace(/\.000Z$/, 'Z');
    }
    
    // Use date-fns-tz for reliable timezone conversion
    // This function is guaranteed to be timezone-independent because:
    // 1. Date object is created from absolute unix timestamp
    // 2. formatInTimeZone converts the absolute moment to the target timezone
    // 3. The result is deterministic regardless of server timezone
    return formatInTimeZone(date, timezone, "yyyy-MM-dd'T'HH:mm:ssxxxxx");
  }

  /**
   * Transform a time slot object from unix timestamps to ISO format
   * @param slot Time slot with unix timestamps
   * @param timezone User's timezone
   * @returns Time slot with ISO format timestamps
   */
  static transformTimeSlot(
    slot: Record<string, unknown>,
    timezone: string
  ): { start: string; end: string; [key: string]: unknown } {
    const transformed = { ...slot };
    
    // Convert unix timestamps to ISO format if present
    if (typeof slot.start_time === 'number') {
      transformed.start = this.timestampToISOWithTimezone(slot.start_time, timezone);
      delete transformed.start_time;
    }
    if (typeof slot.end_time === 'number') {
      transformed.end = this.timestampToISOWithTimezone(slot.end_time, timezone);
      delete transformed.end_time;
    }
    
    return transformed as { start: string; end: string; [key: string]: unknown };
  }

  /**
   * Transform availability response to LLM-friendly format with future-looking filtering
   * @param response Raw availability response from Bot API
   * @param timezone User's timezone
   * @param includePast Whether to include past time slots (defaults to false)
   * @param expectedParticipants Optional array of participant emails to filter for complete availability
   * @returns Transformed response with ISO format timestamps and filtering info
   */
  static transformAvailabilityResponse(
    response: unknown,
    timezone: string,
    includePast: boolean = false,
    expectedParticipants?: string[]
  ): { 
    time_slots: Array<{ start: string; end: string; [key: string]: unknown }>;
    filtering_info?: {
      past_slots_filtered: number;
      partial_availability_slots_filtered?: number;
      filtering_applied: boolean;
      message?: string;
    };
  } {
    // Handle both wrapped and unwrapped response formats
    const responseData = response as { 
      data?: { time_slots?: unknown[] }; 
      time_slots?: unknown[]; 
    };
    const timeSlots = responseData.data?.time_slots || responseData.time_slots || [];
    
    // Transform each time slot to ISO format first
    const transformedSlots = timeSlots.map(slot => this.transformTimeSlot(slot as Record<string, unknown>, timezone));
    
    // Apply participant availability filter first (if expected participants provided)
    let currentSlots = transformedSlots;
    let participantFilterResult: ParticipantFilterResult | undefined;
    
    if (expectedParticipants && expectedParticipants.length > 0) {
      participantFilterResult = ParticipantAvailabilityFilter.filterForCompleteAvailability(
        { time_slots: currentSlots },
        expectedParticipants
      );
      currentSlots = participantFilterResult.timeSlots;
    }
    
    // Apply future-looking filter
    const futureFilterResult = FutureLookingFilter.filterAvailabilityResponse(
      { time_slots: currentSlots }, 
      includePast
    );
    
    const result: {
      time_slots: Array<{ start: string; end: string; [key: string]: unknown }>;
      filtering_info?: {
        past_slots_filtered: number;
        partial_availability_slots_filtered?: number;
        filtering_applied: boolean;
        message?: string;
      };
    } = {
      time_slots: futureFilterResult.timeSlots
    };
    
    // Combine filtering info if any filtering was applied
    const hasParticipantFiltering = participantFilterResult?.filteringApplied;
    const hasFutureFiltering = futureFilterResult.filteringApplied;
    
    if (hasParticipantFiltering || hasFutureFiltering) {
      const messages: string[] = [];
      
      if (participantFilterResult?.message) {
        messages.push(participantFilterResult.message);
      }
      if (futureFilterResult.message) {
        messages.push(futureFilterResult.message);
      }
      
      result.filtering_info = {
        past_slots_filtered: futureFilterResult.pastSlotsFiltered,
        partial_availability_slots_filtered: participantFilterResult?.partialAvailabilitySlotsFiltered,
        filtering_applied: hasParticipantFiltering || hasFutureFiltering,
        message: messages.join(' ')
      };
    }
    
    return result;
  }

  /**
   * Transform event response to LLM-friendly format
   * @param event Raw event response from Bot API
   * @param timezone User's timezone
   * @returns Transformed event with ISO format timestamps
   */
  static transformEventResponse(
    event: Record<string, unknown>,
    timezone: string
  ): Record<string, unknown> {
    const transformed = { ...event };
    
    // Transform event timing information
    if (event.when && typeof event.when === 'object' && event.when !== null) {
      const when = event.when as Record<string, unknown>;
      if (typeof when.start_time === 'number') {
        transformed.start = this.timestampToISOWithTimezone(when.start_time, timezone);
      }
      if (typeof when.end_time === 'number') {
        transformed.end = this.timestampToISOWithTimezone(when.end_time, timezone);
      }
      
      // Replace when object with individual start/end fields for LLM clarity
      delete transformed.when;
    }
    
    // Also handle direct start_time/end_time fields
    if (typeof event.start_time === 'number') {
      transformed.start = this.timestampToISOWithTimezone(event.start_time, timezone);
      delete transformed.start_time;
    }
    if (typeof event.end_time === 'number') {
      transformed.end = this.timestampToISOWithTimezone(event.end_time, timezone);
      delete transformed.end_time;
    }
    
    return transformed;
  }

  /**
   * Transform any response object that might contain unix timestamps
   * @param response Raw response object
   * @param timezone User's timezone
   * @returns Transformed response with human-readable timestamps
   */
  static transformResponse(response: unknown, timezone: string): unknown {
    if (!response || typeof response !== 'object') {
      return response;
    }

    // Handle arrays
    if (Array.isArray(response)) {
      return response.map(item => this.transformResponse(item, timezone));
    }

    const responseObj = response as Record<string, unknown>;
    const transformed = { ...responseObj };

    // Transform common timestamp fields
    if (typeof transformed.start_time === 'number') {
      transformed.start = this.timestampToISOWithTimezone(transformed.start_time, timezone);
      delete transformed.start_time;
    }
    if (typeof transformed.end_time === 'number') {
      transformed.end = this.timestampToISOWithTimezone(transformed.end_time, timezone);
      delete transformed.end_time;
    }

    // Recursively transform nested objects
    for (const [key, value] of Object.entries(transformed)) {
      if (value && typeof value === 'object') {
        transformed[key] = this.transformResponse(value, timezone);
      }
    }

    return transformed;
  }
}

// ==============================================
// INPUT NORMALIZATION UTILITIES
// ==============================================

/**
 * Normalize null values to undefined for better LLM compatibility
 * LLMs often send null instead of omitting fields, but Zod expects undefined for optional fields
 */
function normalizeNullValues(data: unknown): unknown {
  if (data === null || data === undefined) {
    return undefined;
  }
  
  if (Array.isArray(data)) {
    return data.map(normalizeNullValues);
  }
  
  if (typeof data === 'object' && data !== null) {
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      normalized[key] = normalizeNullValues(value);
    }
    return normalized;
  }
  
  return data;
}

// ==============================================
// FUTURE-LOOKING FILTER
// ==============================================

export interface FutureLookingFilterResult {
  timeSlots: Array<{ start: string; end: string; [key: string]: unknown }>;
  adjustedRange?: {
    originalStart: string;
    originalEnd: string;
    actualStart: string;
    actualEnd: string;
  };
  filteringApplied: boolean;
  pastSlotsFiltered: number;
  message?: string;
}

/**
 * Filters availability responses to ensure only future-looking results
 * unless explicitly requested to include past times
 */
export class FutureLookingFilter {
  /**
   * Filter availability response to exclude past time slots
   */
  static filterAvailabilityResponse(
    response: { time_slots: Array<{ start: string; end: string; [key: string]: unknown }> },
    includePast: boolean = false
  ): FutureLookingFilterResult {
    if (includePast) {
      return {
        timeSlots: response.time_slots,
        filteringApplied: false,
        pastSlotsFiltered: 0
      };
    }

    const now = new Date();
    const nowUnix = Math.floor(now.getTime() / 1000);
    
    const filteredSlots = response.time_slots.filter(slot => {
      // Parse slot start time to unix timestamp for comparison
      const slotStartUnix = Math.floor(new Date(slot.start).getTime() / 1000);
      return slotStartUnix > nowUnix;
    });

    const pastSlotsFiltered = response.time_slots.length - filteredSlots.length;
    
    let message: string | undefined;
    if (pastSlotsFiltered > 0) {
      message = `⏰ Filtered ${pastSlotsFiltered} past time slot${pastSlotsFiltered > 1 ? 's' : ''} (showing only future availability). Use 'includePast: true' to include past times.`;
    }

    return {
      timeSlots: filteredSlots,
      filteringApplied: pastSlotsFiltered > 0,
      pastSlotsFiltered,
      message
    };
  }

  /**
   * Adjust time range to ensure it starts in the future
   * This is used when parsing user input time ranges that may start in the past
   */
  static adjustTimeRangeToFuture(
    originalStart: string,
    originalEnd: string,
    includePast: boolean = false,
    timezone: string
  ): {
    start: string;
    end: string;
    adjustedRange?: {
      originalStart: string;
      originalEnd: string;
      actualStart: string;
      actualEnd: string;
    };
    message?: string;
  } {
    if (includePast) {
      return {
        start: originalStart,
        end: originalEnd
      };
    }

    const now = new Date();
    const startDate = new Date(originalStart);
    const endDate = new Date(originalEnd);
    
    // If start time is not in the past, no adjustment needed
    if (startDate >= now) {
      return {
        start: originalStart,
        end: originalEnd
      };
    }
    
    // If entire range is in the past, adjust start to now
    if (endDate <= now) {
      const adjustedStart = this.formatDateInTimezone(now, timezone);
      const adjustedEnd = this.formatDateInTimezone(new Date(now.getTime() + (24 * 60 * 60 * 1000)), timezone); // Next day same time
      
      return {
        start: adjustedStart,
        end: adjustedEnd,
        adjustedRange: {
          originalStart,
          originalEnd,
          actualStart: adjustedStart,
          actualEnd: adjustedEnd
        },
        message: `⏰ Requested time range was in the past. Adjusted to search from now onwards. Use 'includePast: true' to include past times.`
      };
    }
    
    // If range spans past and future, adjust start to now but keep original end
    const adjustedStart = this.formatDateInTimezone(now, timezone);
    
    return {
      start: adjustedStart,
      end: originalEnd,
      adjustedRange: {
        originalStart,
        originalEnd,
        actualStart: adjustedStart,
        actualEnd: originalEnd
      },
      message: `⏰ Adjusted start time from past to present (${this.formatDateInTimezone(now, timezone)}). Use 'includePast: true' to include past times.`
    };
  }

  /**
   * Format date in specific timezone (helper method)
   */
  private static formatDateInTimezone(date: Date, timezone: string): string {
    // Convert to ISO string in the specified timezone
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    
    const parts = formatter.formatToParts(date);
    const datePart = parts.find(p => p.type === 'year')?.value + '-' +
                    parts.find(p => p.type === 'month')?.value + '-' +
                    parts.find(p => p.type === 'day')?.value;
    const timePart = parts.find(p => p.type === 'hour')?.value + ':' +
                    parts.find(p => p.type === 'minute')?.value + ':' +
                    parts.find(p => p.type === 'second')?.value;
    
    return `${datePart}T${timePart}`;
  }
}

// ==============================================
// PARTICIPANT AVAILABILITY FILTER
// ==============================================

export interface ParticipantFilterResult {
  timeSlots: Array<{ start: string; end: string; [key: string]: unknown }>;
  filteringApplied: boolean;
  partialAvailabilitySlotsFiltered: number;
  expectedParticipants: string[];
  message?: string;
}

/**
 * Filters availability responses to ensure only time slots where ALL expected participants are available
 * This is critical for mutual_slots and consecutive_slots where partial availability is not useful
 */
export class ParticipantAvailabilityFilter {
  /**
   * Filter availability response to only include slots where ALL expected participants are available
   * @param response The availability response with time slots that may have partial participant availability
   * @param expectedParticipants Array of all participant emails that should be available in each slot
   * @returns Filtered response with only complete availability slots
   */
  static filterForCompleteAvailability(
    response: { time_slots: Array<{ start: string; end: string; emails?: string[]; [key: string]: unknown }> },
    expectedParticipants: string[]
  ): ParticipantFilterResult {
    // Normalize expected participants to lowercase for consistent comparison
    const normalizedExpectedParticipants = expectedParticipants.map(email => email.toLowerCase()).sort();
    
    console.log('🔍 ParticipantAvailabilityFilter debug:');
    console.log('  - Expected participants:', normalizedExpectedParticipants);
    console.log('  - Total slots to filter:', response.time_slots.length);
    
    const filteredSlots = response.time_slots.filter(slot => {
      // Check if this slot has the emails array
      if (!slot.emails || !Array.isArray(slot.emails)) {
        console.log(`  - Slot ${slot.start} has no emails array, filtering out`);
        return false;
      }
      
      // Normalize slot emails to lowercase for comparison
      const normalizedSlotEmails = slot.emails.map((email: string) => email.toLowerCase()).sort();
      
      // Check if all expected participants are present in this slot
      const hasAllParticipants = normalizedExpectedParticipants.every(expectedEmail => 
        normalizedSlotEmails.includes(expectedEmail)
      );
      
      console.log(`  - Slot ${slot.start}: slot emails=[${normalizedSlotEmails.join(', ')}], hasAll=${hasAllParticipants}`);
      
      return hasAllParticipants;
    });

    const partialAvailabilitySlotsFiltered = response.time_slots.length - filteredSlots.length;
    
    let message: string | undefined;
    if (partialAvailabilitySlotsFiltered > 0) {
      message = `🎯 Filtered ${partialAvailabilitySlotsFiltered} slot${partialAvailabilitySlotsFiltered > 1 ? 's' : ''} with partial availability (showing only slots where ALL ${normalizedExpectedParticipants.length} participants are available).`;
    }

    console.log(`  - Filtered result: ${filteredSlots.length} slots remain after filtering`);
    
    return {
      timeSlots: filteredSlots,
      filteringApplied: partialAvailabilitySlotsFiltered > 0,
      partialAvailabilitySlotsFiltered,
      expectedParticipants: normalizedExpectedParticipants,
      message
    };
  }

  /**
   * Helper method to determine expected participants for mutual_slots
   * @param requestedEmails Emails from the MCP request
   * @param grantUserEmail Grant user email (if injected)
   * @returns Complete list of expected participants
   */
  static getExpectedParticipantsForMutualSlots(
    requestedEmails: string[],
    grantUserEmail?: string
  ): string[] {
    const participants = [...requestedEmails];
    
    // Add grant user if provided and not already in the list
    if (grantUserEmail && !participants.includes(grantUserEmail.toLowerCase())) {
      participants.push(grantUserEmail);
    }
    
    return participants;
  }

  /**
   * Helper method to determine expected participants for consecutive_slots
   * @param sessions Array of sessions with their participant emails
   * @param grantUserEmail Grant user email (if injected)
   * @returns Complete list of unique expected participants across all sessions
   */
  static getExpectedParticipantsForConsecutiveSlots(
    sessions: Array<{ emails: string[]; [key: string]: unknown }>,
    grantUserEmail?: string
  ): string[] {
    // Get all unique emails across all sessions
    const allEmails = new Set<string>();
    
    sessions.forEach(session => {
      session.emails.forEach(email => {
        allEmails.add(email.toLowerCase());
      });
    });
    
    // Add grant user if provided and not already present
    if (grantUserEmail && !allEmails.has(grantUserEmail.toLowerCase())) {
      allEmails.add(grantUserEmail.toLowerCase());
    }
    
    return Array.from(allEmails);
  }
}
