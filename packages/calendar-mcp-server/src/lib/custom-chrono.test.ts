import { describe, it, expect } from 'vitest';
import { parseToDate, parseDateRange, parseDateRangeToUnixTimestamps, detectOpenHours, shouldConfigureOpenHours } from './custom-chrono';

describe('Custom Chrono', () => {
    const referenceDate = new Date('2025-06-01T00:00:00Z'); // Sunday, June 1st 2025 in UTC
  it('should parse "next Wednesday between 9am to 5pm" to a date', () => {
    const date = parseToDate('next Wednesday between 9am to 5pm', referenceDate, 'America/New_York');
    expect(date).toBeDefined();

    // Make sure unix timestamp is correct (next wednesday is june 4th)
    expect(date?.getTime()).toBe(1749042000000);
  });

  it('should parse "next Wednesday between 9am to 5pm" to a date range', () => {
    const dateRange = parseDateRange('next Wednesday between 9am to 5pm', referenceDate, 'America/New_York');
    expect(dateRange).toBeDefined();

    // Make sure unix timestamps are correct (next wednesday is june 4th)
    expect(dateRange.start?.getTime()).toBe(1749042000000);
    expect(dateRange.end?.getTime()).toBe(1749070800000);
  });

  it('should parse "next Wednesday between 9am to 5pm" to unix timestamps', () => {
    const dateRange = parseDateRangeToUnixTimestamps('next Wednesday between 9am to 5pm', referenceDate, 'America/New_York');
    expect(dateRange).toBeDefined();

    // Make sure unix timestamps are correct (next wednesday is june 4th)
    expect(dateRange.start).toBe(1749042000);
    expect(dateRange.end).toBe(1749070800);
  });

  it('should parse "next Wednesday between 9am to 5pm" to unix timestamps with los angeles timezone', () => {
    const dateRange = parseDateRangeToUnixTimestamps('next Wednesday between 9am to 5pm', referenceDate, 'America/Los_Angeles');
    expect(dateRange).toBeDefined();

    // Make sure unix timestamps are correct
    expect(dateRange.start).toBe(1749052800);
    expect(dateRange.end).toBe(1749081600);
  });

  it('should parse "Wednesday June 4th between 4pm to 5pm" to unix timestamps with los angeles timezone', () => {
    const dateRange = parseDateRangeToUnixTimestamps('Wednesday June 4th between 4pm to 5pm', referenceDate, 'America/Los_Angeles');
    expect(dateRange).toBeDefined();

    // Make sure unix timestamps are correct
    expect(dateRange.start).toBe(1749078000);
    expect(dateRange.end).toBe(1749081600);
  });

  it('should not have a valid end date for "Wednesday June 4th at 4pm" with los angeles timezone', () => {
    const dateRange = parseDateRangeToUnixTimestamps('Wednesday June 4th at 4pm', referenceDate, 'America/Los_Angeles');
    expect(dateRange).toBeDefined();

    // Make sure unix timestamps are correct
    expect(dateRange.start).toBe(1749078000);
    expect(dateRange.end).toBe(null);
  });

  it('should parse "next week between 9am to 5pm" to unix timestamps with new york timezone', () => {
    const dateRange = parseDateRangeToUnixTimestamps('next week between 9am to 5pm', referenceDate, 'America/New_York');
    expect(dateRange).toBeDefined();

    // Make sure unix timestamps are correct (Monday June 2nd 9am ET to Friday June 6th 5pm ET)
    expect(dateRange.start).toBe(1749387600); // Monday June 2nd 9am ET
    expect(dateRange.end).toBe(1749848400);   // Friday June 6th 5pm ET
  });
});

describe('Open Hours Detection', () => {
  const referenceDate = new Date('2025-06-01T00:00:00Z'); // Sunday, June 1st 2025 in UTC

  it('should detect open hours from "next week between 9am to 5pm"', () => {
    const openHours = detectOpenHours('next week between 9am to 5pm', 'America/New_York', referenceDate);
    expect(openHours).toBeDefined();
    expect(openHours?.start).toBe('9:00');
    expect(openHours?.end).toBe('17:00');
    expect(openHours?.days).toEqual([1, 2, 3, 4, 5]); // Monday-Friday
    expect(openHours?.timezone).toBe('America/New_York');
  });

  it('should detect open hours from "tomorrow between 8am to 6pm"', () => {
    const openHours = detectOpenHours('tomorrow between 8am to 6pm', 'America/Los_Angeles', referenceDate);
    expect(openHours).toBeDefined();
    expect(openHours?.start).toBe('8:00');
    expect(openHours?.end).toBe('18:00');
    expect(openHours?.days).toEqual([1]); // Tomorrow from Sunday (June 1, 2025) should be Monday (day 1)
    expect(openHours?.timezone).toBe('America/Los_Angeles');
  });

  it('should detect open hours from "this Friday from 10am to 4pm"', () => {
    const openHours = detectOpenHours('this Friday from 10am to 4pm', 'UTC', referenceDate);
    expect(openHours).toBeDefined();
    expect(openHours?.start).toBe('10:00');
    expect(openHours?.end).toBe('16:00');
    expect(openHours?.days).toEqual([5]); // Friday
    expect(openHours?.timezone).toBe('UTC');
  });

  it('should not detect open hours from "tomorrow afternoon"', () => {
    const openHours = detectOpenHours('tomorrow afternoon', 'America/New_York', referenceDate);
    expect(openHours).toBeNull();
  });

  it('should not detect open hours from "next Monday"', () => {
    const openHours = detectOpenHours('next Monday', 'America/New_York', referenceDate);
    expect(openHours).toBeNull();
  });

  it('should detect that "next week between 9am to 5pm" should configure open hours', () => {
    expect(shouldConfigureOpenHours('next week between 9am to 5pm', referenceDate)).toBe(true);
  });

  it('should detect that "tomorrow afternoon" should not configure open hours', () => {
    expect(shouldConfigureOpenHours('tomorrow afternoon', referenceDate)).toBe(false);
  });
});