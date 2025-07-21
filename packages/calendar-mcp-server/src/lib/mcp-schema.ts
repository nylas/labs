import { z } from 'zod';
import { baseSchemas } from './base-schemas';

// Date/time schemas - Updated with specific chrono-node valid examples
export const dateTimeSchema = z.string().describe('Date/time input. VALID FORMATS: Natural language like "tomorrow at 2pm", "next Monday at 10am", "January 15th at 3:30pm", "Friday at 9 AM" OR ISO format like "2025-06-09T12:00". INVALID FORMATS: Date-only expressions like "tomorrow", "next Monday", "January 15th" - you MUST include explicit times like "at 2pm" or "at 10am".');

// Timeframe schema for single range expressions with valid examples
export const timeframeSchema = z.string().describe('Natural language timeframe. VALID FORMATS: Time ranges like "tomorrow between 9am to 5pm", "This Friday from 2pm to 4pm", "next week between 9am to 5pm", "January 15th from 10am to 3pm"; Time-of-day expressions like "tomorrow morning", "next Friday afternoon"; Multi-day ranges like "next week", "this month". INVALID FORMATS: Date-only expressions like "tomorrow", "this Friday", "next Monday" - you MUST include explicit times like "between 9am to 5pm".');

// Email array schema
export const emailsSchema = z.array(z.string().email()).describe('Array of email addresses');

// Timezone schema with better description
export const timezoneSchema = z.string().optional().describe('Your timezone (e.g., "America/New_York", "Europe/London", "UTC"). If not provided, will be detected from your calendar settings.');

// Include past parameter schema - for availability tools only
export const includePastSchema = z.boolean().optional().default(false).describe('Whether to include time slots in the past. By default, only future availability is returned. Set to true to include past time slots.');

// ==============================================
// MCP TOOL SCHEMAS
// ==============================================

// Tool schemas for MCP registration (uses .shape) - based on baseSchemas
export const mcpToolSchemas = {
  my_availability: baseSchemas.my_availability,
  contact_availability: baseSchemas.contact_availability,
  mutual_slots: baseSchemas.mutual_slots,
  schedule_meeting: baseSchemas.schedule_meeting,
  consecutive_slots: baseSchemas.consecutive_slots,
  current_time: baseSchemas.current_time,
  user_info: baseSchemas.user_info,
  debug_get_events: baseSchemas.debug_get_events
} as const;

// ==============================================
// RESPONSE TYPES
// ==============================================

// Response types
export interface AvailabilitySlot {
  start: string;
  end: string;
}

export interface Slot {
  start: string;
  end: string;
}

export interface Event {
  id: string;
  status: string;
  title?: string;
  description?: string;
  start?: string;
  end?: string;
}

export interface ConsecutiveSlotBlock {
  start: string;
  end: string;
  schedule: Array<{
    label: string;
    start: string;
    end: string;
  }>;
}

export interface CurrentTimeInfo {
  currentDate: string;
  currentTime: string;
  currentDateTime: string;
  isoString: string;
  dayOfWeek: string;
  timezone: string;
}

// ==============================================
// EXPORTED TYPES
// ==============================================

// Export tool types for runtime use
export type McpToolName = keyof typeof mcpToolSchemas;
export type McpToolParams<T extends McpToolName> = z.infer<typeof mcpToolSchemas[T]>; 