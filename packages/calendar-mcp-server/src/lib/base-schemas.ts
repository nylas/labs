import { z } from 'zod';

// ==============================================
// BASE FIELD SCHEMAS
// ==============================================

// Date/time schemas - Updated with specific chrono-node valid examples
export const dateTimeSchema = z.string().describe('Date/time input. VALID FORMATS: Natural language like "tomorrow at 2pm", "next Monday at 10am", "January 15th at 3:30pm", "Friday at 9 AM" OR ISO format like "2025-06-09T12:00". INVALID FORMATS: Date-only expressions like "tomorrow", "next Monday", "January 15th" - you MUST include explicit times like "at 2pm" or "at 10am".');

// Timeframe schema for single range expressions with valid examples
export const timeframeSchema = z.string().describe('Natural language timeframe. VALID FORMATS: Time ranges like "tomorrow between 9am to 5pm", "this Friday from 2pm to 4pm", "next week between 9am to 5pm", "January 15th from 10am to 3pm"; Multi-day ranges like "next week", "this month". INVALID FORMATS: Vague expressions like "tomorrow afternoon" or "next Friday morning" without explicit time ranges. Date-only expressions like "tomorrow", "this Friday", "next Monday" - you MUST include explicit times like "between 9am to 5pm".');

// Email array schema - with hallucination prevention
export const emailsSchema = z.array(z.string().email()).describe('EXACT email addresses of participants. DO NOT guess or fabricate email addresses - if you do not know the exact email address, ask the user to provide it. Examples: ["john.doe@company.com", "jane.smith@company.com"]');

// Timezone schema with better description
export const timezoneSchema = z.string().optional().describe('Your timezone (e.g., "America/New_York", "Europe/London", "UTC"). If not provided, will be detected from your calendar settings.');

// Include past parameter schema - for availability tools only
export const includePastSchema = z.boolean().optional().default(false).describe('Whether to include time slots in the past. By default, only future availability is returned. Set to true to include past time slots.');

// Enhanced date/time validation - now accepts natural language and timeframes
export const dateTimeValidationSchema = z
  .string()
  .describe(
    'Date/time input. VALID FORMATS: Natural language like "tomorrow at 2pm", "next Monday at 10am", "January 15th at 3:30pm", "Friday at 9 AM" OR ISO format like "2025-06-09T12:00". INVALID FORMATS: Date-only expressions like "tomorrow", "next Monday", "January 15th" - you MUST include explicit times like "at 2pm" or "at 10am".'
  )
  .refine((dateTime) => {
    // Accept any non-empty string - let the NaturalLanguageDateParser handle validation
    return dateTime.trim().length > 0;
  }, 'Date/time cannot be empty. You MUST include explicit times like "tomorrow at 2pm" instead of date-only expressions like "tomorrow".');

// Timeframe validation for single range expressions
export const timeframeValidationSchema = z
  .string()
  .describe(
    'Natural language timeframe. VALID FORMATS: "tomorrow between 9am to 5pm", "next Friday from 2pm to 4pm", "next week between 9am to 5pm", "this month". INVALID FORMATS: Vague expressions like "tomorrow afternoon" or "next Friday morning" without explicit time ranges. Date-only expressions like "tomorrow", "this Friday", "next Monday" - you MUST include explicit times like "between 9am to 5pm".'
  )
  .refine((timeframe) => {
    return timeframe.trim().length > 0;
  }, 'Timeframe cannot be empty. You MUST include explicit times like "tomorrow between 9am to 5pm" instead of date-only expressions like "tomorrow".');

export const emailSchema = z.string().email("Invalid email format");
export const emailArraySchema = z.array(emailSchema).min(0, "Emails must be an array");
export const durationSchema = z
  .number()
  .int()
  .min(1, "Duration must be a positive integer");

// ==============================================
// BASE OBJECT SCHEMAS
// ==============================================

// Base schemas that define the core structure without complex validation
export const baseSchemas = {
  my_availability: z.object({
    timeframe: timeframeSchema.optional(),
    durationMin: z.number().int().min(1).optional().default(30).describe('Required duration of the meeting slots in minutes (e.g., 30 for 30-minute meetings)'),
    timezone: timezoneSchema,
    bufferMinutes: z.number().int().min(0).max(120).optional().describe('Buffer time in minutes before/after meetings (optional, max: 120)'),
    includePast: includePastSchema
  }),

  contact_availability: z.object({
    email: z.string().email().describe('EXACT email address of the contact whose availability to check. DO NOT guess or fabricate email addresses - if you do not know the exact email address, ask the user to provide it. Example: "john.doe@company.com"'),
    timeframe: timeframeSchema.optional(),
    durationMin: z.number().int().min(1).optional().default(30).describe('Required duration of the meeting slots in minutes (e.g., 30 for 30-minute meetings)'),
    timezone: timezoneSchema,
    bufferMinutes: z.number().int().min(0).max(120).optional().describe('Buffer time in minutes before/after meetings (optional, max: 120)'),
    includePast: includePastSchema
  }),

  mutual_slots: z.object({
    emails: emailsSchema.describe('EXACT email addresses of participants to find mutual availability for (recruiter is automatically included). DO NOT guess or fabricate email addresses - if you do not know the exact email addresses, ask the user to provide them. Examples: ["john.doe@company.com", "jane.smith@company.com"]'),
    timeframe: timeframeSchema.optional(),
    durationMin: z.number().int().min(1).describe('Required duration of the meeting slots in minutes (e.g., 30 for 30-minute meetings)'),
    timezone: timezoneSchema,
    bufferMinutes: z.number().int().min(0).max(120).optional().describe('Buffer time in minutes before/after meetings (optional, max: 120)'),
    includePast: includePastSchema
  }),

  schedule_meeting: z.object({
    emails: emailsSchema.describe('EXACT email addresses of participants to invite to the meeting. DO NOT guess or fabricate email addresses - if you do not know the exact email addresses, ask the user to provide them. Examples: ["john.doe@company.com", "jane.smith@company.com"]'),
    
    // Both start and end are required - no duration support
    start: dateTimeSchema.describe('Meeting start time. Use natural language like "tomorrow at 2pm", "next Monday at 10:30am", "Friday at 9 AM".'),
    end: dateTimeSchema.describe('Meeting end time. Use natural language like "tomorrow at 3pm", "next Monday at 11:30am", "Friday at 10 AM".'),
    
    title: z.string().describe('Title/subject of the meeting (e.g., "Team Standup", "Client Review")'),
    description: z.string().optional().describe('Optional detailed description of the meeting (e.g., "Weekly team sync to discuss project progress and blockers")'),
    timezone: timezoneSchema,
    addSelf: z.boolean().optional().default(true).describe('Whether to include the recruiter/creator in the meeting (default: true)')
  }),

  consecutive_slots: z.object({
    sessions: z.array(z.object({
      label: z.string().describe('Label for this session (e.g., "HR Interview", "Technical Round")'),
      emails: emailsSchema.describe('EXACT email addresses of participants for this specific session. DO NOT guess or fabricate email addresses - if you do not know the exact email addresses, ask the user to provide them. Examples: ["john.doe@company.com", "jane.smith@company.com"]'),
      durationMin: z.number().int().min(1).describe('Duration of this session in minutes')
    })).describe('Array of interview sessions to schedule consecutively back-to-back'),
    timeframe: timeframeSchema.optional(),
    gapMaxMin: z.number().int().min(0).describe('Maximum allowed gap between consecutive sessions in minutes (e.g., 15 for 15-minute breaks, 0 for no gaps)'),
    timezone: timezoneSchema,
    includePast: includePastSchema
  }),

  current_time: z.object({
    timezone: z.string().describe('Timezone to get current time for (e.g., "America/New_York", "Europe/London", "UTC"). REQUIRED.')
  }),

  user_info: z.object({
    // No parameters needed
  }),

  debug_get_events: z.object({
    email: z.string().email().describe('EXACT email address to get events for. DO NOT guess or fabricate email addresses - if you do not know the exact email address, ask the user to provide it. Example: "john.doe@company.com"'),
    
    // Option 1: Simple timeframe
    timeframe: timeframeSchema.optional(),
    
    // Option 2: Separate start/end
    start: dateTimeSchema.optional(),
    end: dateTimeSchema.optional(),
    
    timezone: timezoneSchema,
    includePast: z
      .boolean()
      .optional()
      .default(true)
      .describe("Whether to include events in the past. Debug tool includes past events by default for comprehensive debugging."),
  })
} as const;

// Export types for the base schemas
export type BaseSchemaName = keyof typeof baseSchemas;
export type BaseSchemaParams<T extends BaseSchemaName> = z.infer<typeof baseSchemas[T]>; 