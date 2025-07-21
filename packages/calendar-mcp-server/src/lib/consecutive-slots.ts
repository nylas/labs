import type { ConsecutiveSlotBlock } from './mcp-schema';
import { BotApiAvailabilityRequest, BotApiAvailabilityResponse } from '../shared-types';
import { McpToBotApiTransformer, ResponseTransformer, UserTimezoneDetector, ParticipantAvailabilityFilter } from './validation';

// Bot client interface for dependency injection
interface BotClient {
  availability(body: BotApiAvailabilityRequest): Promise<BotApiAvailabilityResponse>;
  getGrantUserEmail(): Promise<string>;
  getUserInfo(): Promise<{
    grant_id: string;
    email: string;
    provider: string;
    org_id: string;
    timezone: string | null;
  }>;
}

export interface ConsecutiveSlotsParams {
  sessions: Array<{
    label: string;
    emails: string[];
    durationMin: number;
  }>;
  
  timeframe?: string;
  
  gapMaxMin: number;
  timezone?: string;
  includePast?: boolean; // Whether to include past time slots
  maxResults?: number;
  botClient: BotClient; // Injected bot client with user authentication
  httpRequest?: Request; // HTTP request for timezone context
}



// Type for Bot API time slot response (with Unix timestamps)
interface BotApiTimeSlot {
  start_time: number;
  end_time: number;
  emails?: string[];
  // Also support ISO format as fallback
  start?: string;
  end?: string;
}

// Type for processed time slot (with ISO strings)
interface ProcessedTimeSlot {
  start: string;
  end: string;
  emails?: string[];
}

/**
 * Greedy planner for consecutive interview sessions.
 * Steps:
 *  1. For each session definition, call botClient.availability to get ECC-computed intersection.
 *  2. Iterate over first-session slots and chain the rest, ensuring the gap
 *     between consecutive sessions is <= gapMaxMin minutes.
 *  3. Return an array of viable blocks.
 * NOTE: Suitable for ≤10 sessions. Optimize later if required.
 */
export async function computeConsecutiveSlots(params: ConsecutiveSlotsParams): Promise<ConsecutiveSlotBlock[]> {
  const { sessions, timeframe, gapMaxMin, timezone, includePast = false, maxResults = 10, botClient, httpRequest } = params;

  console.log('🔄 computeConsecutiveSlots debug:');
  console.log('  - Sessions:', sessions.length);  
  console.log('  - Gap max:', gapMaxMin, 'minutes');

  // Get grant user email once for all sessions
  const grantUserEmail = await botClient.getGrantUserEmail();
  console.log('  - Grant user email:', grantUserEmail);

  // Get user timezone for consistent timestamp conversion
  const userTimezone = await UserTimezoneDetector.requireUserTimezone(timezone, httpRequest, botClient);
  console.log('  - User timezone:', userTimezone);

  // Step 1: Get availability for each session
  const availabilityPerSession = await Promise.all(
    sessions.map(async (session, index) => {
      // Transform each session to Bot API format using new pattern support
      const mcpRequest = {
        emails: session.emails,
        timeframe,
        durationMin: session.durationMin,
        timezone,
        includePast
      };
      
      console.log(`  - Session ${index + 1} (${session.label}):`, session.emails);
      
      // Determine expected participants for this session (session emails + grant user)
      const expectedParticipants = ParticipantAvailabilityFilter.getExpectedParticipantsForMutualSlots(
        session.emails,
        grantUserEmail
      );
      console.log(`    Expected participants for filtering:`, expectedParticipants);
      
      // Use transformer with HTTP request context and grant user email
      const botRequest = await McpToBotApiTransformer.mutualSlotsRequest(mcpRequest, httpRequest, grantUserEmail, botClient);
      
      const response = await botClient.availability(botRequest);
      console.log(`    Response:`, response);
      
      // Handle both wrapped and unwrapped response formats - cast to unknown first to avoid type conflict
      const responseData = response as unknown as { 
        data?: { time_slots?: BotApiTimeSlot[] }; 
        time_slots?: BotApiTimeSlot[];
      };
      const rawSlots = responseData.data?.time_slots || responseData.time_slots || [];
      
      console.log(`    Raw slots count:`, rawSlots.length);
      
      // Convert Unix timestamps to LLM-friendly ISO strings with timezone info and apply participant filtering
      const transformedSlots = rawSlots.map((slot: BotApiTimeSlot) => 
        ResponseTransformer.transformTimeSlot(slot as unknown as Record<string, unknown>, userTimezone)
      );
      
      // Apply participant availability filtering to ensure all expected participants are available
      const participantFilterResult = ParticipantAvailabilityFilter.filterForCompleteAvailability(
        { time_slots: transformedSlots },
        expectedParticipants
      );
      
      const processedSlots: ProcessedTimeSlot[] = participantFilterResult.timeSlots
        .filter(slot => slot.start && slot.end); // Filter out invalid slots
      
      console.log(`    Processed slots count after participant filtering:`, processedSlots.length);
      if (participantFilterResult.filteringApplied) {
        console.log(`    ${participantFilterResult.message}`);
      }
      
      return processedSlots;
    })
  );

  // Check if any session has no availability
  for (let i = 0; i < availabilityPerSession.length; i++) {
    if (availabilityPerSession[i].length === 0) {
      console.log(`  - Session ${i + 1} has no availability, returning empty result`);
      return [];
    }
  }

  const results: ConsecutiveSlotBlock[] = [];

  // Step 2: Try to chain sessions starting from each slot of the first session
  outer: for (const firstSlot of availabilityPerSession[0]) {
    console.log(`  - Trying to chain starting with slot: ${firstSlot.start} - ${firstSlot.end}`);
    
    const schedule = [
      {
        label: sessions[0].label,
        start: firstSlot.start,
        end: firstSlot.end
      }
    ];

    // Step 3: Try to find compatible slots for remaining sessions
    for (let i = 1; i < sessions.length; i++) {
      const prevEnd = schedule[i - 1].end;
      const prevEndTime = new Date(prevEnd).getTime();

      console.log(`    - Looking for session ${i + 1} after ${prevEnd}`);

      // Find a slot that starts within the allowed gap after the previous session ends
      const nextSlot = availabilityPerSession[i].find((slot: ProcessedTimeSlot) => {
        const slotStartTime = new Date(slot.start).getTime();
        const gapMinutes = (slotStartTime - prevEndTime) / (60 * 1000);
        const isValid = gapMinutes >= 0 && gapMinutes <= gapMaxMin;
        
        console.log(`      - Checking slot ${slot.start}: gap=${gapMinutes}min, valid=${isValid}`);
        return isValid;
      });

      if (!nextSlot) {
        // Cannot find a compatible slot for this session, skip this chain
        console.log(`    - No compatible slot found for session ${i + 1}, skipping chain`);
        continue outer;
      }

      console.log(`    - Found compatible slot: ${nextSlot.start} - ${nextSlot.end}`);
      schedule.push({
        label: sessions[i].label,
        start: nextSlot.start,
        end: nextSlot.end
      });
    }

    // Successfully chained all sessions
    console.log(`  - Successfully chained all sessions!`);
    results.push({
      start: schedule[0].start,
      end: schedule[schedule.length - 1].end,
      schedule
    });

    if (results.length >= maxResults) {
      break;
    }
  }

  console.log(`  - Final result: ${results.length} consecutive slot blocks found`);
  return results;
} 