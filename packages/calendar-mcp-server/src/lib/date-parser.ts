export function validateTimezone(timezone: string): string {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return timezone;
  } catch {
    throw new Error(
      `Invalid timezone '${timezone}'. Use IANA timezone format like 'America/New_York', 'Europe/London', or 'UTC'`
    );
  }
}

export function getCurrentTimeInfo(timezone: string): {
  currentDate: string;
  currentTime: string;
  currentDateTime: string;
  isoString: string;
  dayOfWeek: string;
  timezone: string;
} {
  const validTimezone = validateTimezone(timezone);
  // Use Date.now() to respect test mocking
  const now = new Date(Date.now());

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: validTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "long",
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  const hour = parts.find((p) => p.type === "hour")?.value;
  const minute = parts.find((p) => p.type === "minute")?.value;
  const second = parts.find((p) => p.type === "second")?.value;
  const weekday = parts.find((p) => p.type === "weekday")?.value;

  const currentDate = `${year}-${month}-${day}`;
  const currentTime = `${hour}:${minute}`;
  const currentDateTime = `${currentDate}T${currentTime}`;
  const isoString = `${currentDate}T${hour}:${minute}:${second}`;

  return {
    currentDate,
    currentTime,
    currentDateTime,
    isoString,
    dayOfWeek: weekday || "Unknown",
    timezone: validTimezone,
  };
}