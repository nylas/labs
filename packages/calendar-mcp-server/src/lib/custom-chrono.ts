import * as chrono from "chrono-node";
import type { ParsingResult, ParsingComponents, Component } from "chrono-node";

// ⇢ The public `Refiner` type is exported, but its first parameter is `any`
class DateWithTimeRangeRefiner implements chrono.Refiner {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  refine(_context: any, results: ParsingResult[]): ParsingResult[] {
    const dateRes = results.find((r) => !r.start.isOnlyTime());
    const times = results.filter((r) => r.start.isOnlyTime());

    if (!dateRes || times.length === 0) return results;

    // earliest time token → start
    const merged = dateRes.clone();
    copyTime(merged.start, times[0].start);

    // Determine the end time. It can come from:
    //  1) The same time token having an `end` component (e.g., "between 9am to 5pm")
    //  2) A second separate time token (e.g., "9am 5pm")
    let endSource: ParsingComponents | undefined;
    if (times[0].end) {
      endSource = times[0].end;
    } else if (times[1]) {
      endSource = times[1].start;
    }

    if (endSource) {
      merged.end = merged.start.clone();
      copyTime(merged.end, endSource);

      // If the date phrase refers to an entire week (e.g., "this week", "next week")
      // the parsed `dateRes` represents the *start* of that week according to Chrono.
      // In this case we want the range to span the working week (Mon-Fri).
      // ─────────────────────────────────────────────────────────────────────────────
      // Chrono will typically anchor "next week" to the same weekday as today
      // (so a refDate on Sunday → next Sunday, Saturday → next Saturday, etc.).
      // For scheduling purposes, however, we treat a "week" reference as
      // Monday-through-Friday, with the *end* falling on Friday.
      //
      // We therefore detect the token text for the date component and, if it
      // contains the word "week", we push the `merged.end` date forward to the
      // upcoming Friday while preserving the copied time (e.g. 5 pm).
      if (/\bweek\b/i.test(dateRes.text)) {
        // JS `Date#getDay()` → 0=Sun … 5=Fri, 6=Sat
        const startDate = merged.start.date();
        const startDow = startDate.getDay();
        // Distance to Friday (5) within the same week
        const diffToFriday = (5 - startDow + 7) % 7;
        const fridayDate = new Date(startDate);
        fridayDate.setDate(startDate.getDate() + diffToFriday);

        // Apply the calculated Y/M/D back onto the chrono components
        merged.end.assign("year", fridayDate.getFullYear());
        merged.end.assign("month", fridayDate.getMonth() + 1); // JS months 0-based
        merged.end.assign("day", fridayDate.getDate());
      }
    }

    return [merged];
  }
}

function copyTime(dst: ParsingComponents, src: ParsingComponents) {
  ["hour", "minute", "second", "millisecond", "meridiem"].forEach((k) => {
    const key = k as Component;
    if (src.isCertain(key)) {
      const val = src.get(key);
      if (val !== null) dst.assign(key, val);
    }
  });
}

function makeChronoWithRanges() {
  const c = chrono.casual.clone();
  c.refiners.push(new DateWithTimeRangeRefiner());
  return c;
}

/**
 *
 * @param ianaTimeZone IANA timezone
 * @param date Date to get the timezone abbreviation for
 * @returns Timezone abbreviation
 */
function getTimezoneAbbreviation(
  ianaTimeZone: string,
  date = new Date()
): string | null {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: ianaTimeZone,
      timeZoneName: "short",
    });
    const parts = formatter.formatToParts(date);
    const tzPart = parts.find((part) => part.type === "timeZoneName");
    return tzPart?.value || null;
  } catch {
    return null;
  }
}

// High-level helper
export function parseToDate(
  text: string,
  ref: Date = new Date(),
  tz: string = "UTC"
): Date | null {
  // Create a reference date that represents noon on the reference day in UTC
  // This ensures relative day expressions like "tomorrow" are interpreted correctly
  const refDateStr = ref.toISOString().split('T')[0]; // Get YYYY-MM-DD
  const refInTargetTz = new Date(`${refDateStr}T12:00:00Z`); // Noon on that day in UTC

  const ch = makeChronoWithRanges();
  const abbrivatedTimezone = getTimezoneAbbreviation(tz) || tz;
  const [res] = ch.parse(
    text,
    { instant: refInTargetTz, timezone: abbrivatedTimezone },
    { forwardDate: true }
  );
  return res ? res.start.date() : null;
}

export function parseDateRange(
  text: string,
  ref: Date = new Date(),
  tz: string = "UTC"
): { start: Date | null; end: Date | null } {
  // Create a reference date that represents noon on the reference day in UTC
  // This ensures relative day expressions like "tomorrow" are interpreted correctly
  const refDateStr = ref.toISOString().split('T')[0]; // Get YYYY-MM-DD
  const refInTargetTz = new Date(`${refDateStr}T12:00:00Z`); // Noon on that day in UTC

  const ch = makeChronoWithRanges();
  const abbrivatedTimezone = getTimezoneAbbreviation(tz) || tz;
  const [res] = ch.parse(
    text,
    { instant: refInTargetTz, timezone: abbrivatedTimezone },
    { forwardDate: true }
  );
  return res
    ? { start: res.start.date(), end: res.end ? res.end.date() : null }
    : { start: null, end: null };
}

export function parseDateRangeToUnixTimestamps(
  text: string,
  ref: Date = new Date(),
  tz: string = "UTC"
): { start: number | null; end: number | null } {
  const res = parseDateRange(text, ref, tz);
  if (!res.start) return { start: null, end: null };
  return {
    start: Math.floor(res.start.getTime() / 1000),
    end: res.end ? Math.floor(res.end.getTime() / 1000) : null,
  };
}

/**
 * Detects if a timeframe expression contains open hours information
 * that should be used to configure default_open_hours for availability requests.
 * 
 * @param text The timeframe expression (e.g., "next week between 9am to 5pm")
 * @param tz The timezone to use for parsing
 * @param ref Reference date to use for parsing (defaults to current date)
 * @returns Open hours configuration or null if not detected
 */
export function detectOpenHours(
  text: string,
  tz: string = "UTC",
  ref: Date = new Date()
): {
  start: string; // e.g. "9:00"
  end: string;   // e.g. "17:00"
  days: number[]; // e.g. [1,2,3,4,5] for Monday-Friday
  timezone: string;
} | null {
  try {
    // Check if the text contains time range indicators
    const hasTimeRange = /\b(between|from)\s+\d+\s*(am|pm)\s+(to|and|-)\s+\d+\s*(am|pm)\b/i.test(text);
    
    if (!hasTimeRange) {
      return null;
    }

    // Create a reference date that represents noon on the reference day in the target timezone
    // This ensures "tomorrow" is interpreted correctly in the target timezone context
    const refDateStr = ref.toISOString().split('T')[0]; // Get YYYY-MM-DD
    const refInTargetTz = new Date(`${refDateStr}T12:00:00`); // Noon on that day

    const ch = makeChronoWithRanges();
    const abbrivatedTimezone = getTimezoneAbbreviation(tz) || tz;
    const [res] = ch.parse(
      text,
      { instant: refInTargetTz, timezone: abbrivatedTimezone },
      { forwardDate: true }
    );

    if (!res || !res.start || !res.end) {
      return null;
    }

    // Extract start and end times
    const startHour = res.start.get('hour');
    const startMinute = res.start.get('minute') || 0;
    const endHour = res.end.get('hour');
    const endMinute = res.end.get('minute') || 0;

    if (startHour === null || endHour === null) {
      return null;
    }

    // Format times in 24-hour format without leading zeros (Nylas format)
    const formatTime = (hour: number, minute: number): string => {
      return `${hour}:${minute.toString().padStart(2, '0')}`;
    };

    const startTime = formatTime(startHour, startMinute);
    const endTime = formatTime(endHour, endMinute);

    // Determine which days to apply the open hours to
    let days: number[];
    
    // Check if it's a week-based expression
    if (/\bweek\b/i.test(text)) {
      // For "week" expressions, default to Monday-Friday (1-5)
      days = [1, 2, 3, 4, 5];
    } else {
      // For specific day expressions, use the day from the parsed result
      const startDate = res.start.date();
      const dayOfWeek = startDate.getDay(); // 0=Sunday, 1=Monday, etc.
      days = [dayOfWeek];
    }

    return {
      start: startTime,
      end: endTime,
      days,
      timezone: tz
    };
  } catch (error) {
    console.warn('Error detecting open hours from timeframe:', error);
    return null;
  }
}

/**
 * Helper function to check if a timeframe should trigger open hours configuration
 * @param text The timeframe expression
 * @param ref Reference date to use for parsing (defaults to current date)
 * @returns True if open hours should be configured
 */
export function shouldConfigureOpenHours(text: string, ref: Date = new Date()): boolean {
  return detectOpenHours(text, "UTC", ref) !== null;
}
