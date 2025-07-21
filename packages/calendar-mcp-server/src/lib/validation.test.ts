// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { ResponseTransformer, OpenHoursDetector } from './validation';

describe('ResponseTransformer.timestampToISOWithTimezone', () => {
  describe('UTC timezone', () => {
    it('should format UTC timestamp correctly', () => {
      // January 20, 2025 14:00:00 UTC
      const timestamp = 1737381600;
      const result = ResponseTransformer.timestampToISOWithTimezone(timestamp, 'UTC');
      expect(result).toBe('2025-01-20T14:00:00Z');
    });

    it('should handle midnight UTC', () => {
      // January 20, 2025 00:00:00 UTC
      const timestamp = 1737331200;
      const result = ResponseTransformer.timestampToISOWithTimezone(timestamp, 'UTC');
      expect(result).toBe('2025-01-20T00:00:00Z');
    });
  });

  describe('Eastern timezone (America/New_York)', () => {
    it('should format Eastern Standard Time correctly', () => {
      // January 20, 2025 14:00:00 UTC = January 20, 2025 09:00:00 EST
      const timestamp = 1737381600;
      const result = ResponseTransformer.timestampToISOWithTimezone(timestamp, 'America/New_York');
      expect(result).toBe('2025-01-20T09:00:00-05:00');
    });

    it('should format Eastern Daylight Time correctly', () => {
      // July 20, 2025 12:00:00 UTC = July 20, 2025 08:00:00 EDT
      const timestamp = 1753012800;
      const result = ResponseTransformer.timestampToISOWithTimezone(timestamp, 'America/New_York');
      expect(result).toBe('2025-07-20T08:00:00-04:00');
    });
  });

  describe('Pacific timezone (America/Los_Angeles)', () => {
    it('should format Pacific Standard Time correctly', () => {
      // January 20, 2025 14:00:00 UTC = January 20, 2025 06:00:00 PST
      const timestamp = 1737381600;
      const result = ResponseTransformer.timestampToISOWithTimezone(timestamp, 'America/Los_Angeles');
      expect(result).toBe('2025-01-20T06:00:00-08:00');
    });

    it('should format Pacific Daylight Time correctly', () => {
      // July 20, 2025 12:00:00 UTC = July 20, 2025 05:00:00 PDT
      const timestamp = 1753012800;
      const result = ResponseTransformer.timestampToISOWithTimezone(timestamp, 'America/Los_Angeles');
      expect(result).toBe('2025-07-20T05:00:00-07:00');
    });
  });

  describe('London timezone (Europe/London)', () => {
    it('should format Greenwich Mean Time correctly', () => {
      // January 20, 2025 14:00:00 UTC = January 20, 2025 14:00:00 GMT
      const timestamp = 1737381600;
      const result = ResponseTransformer.timestampToISOWithTimezone(timestamp, 'Europe/London');
      expect(result).toBe('2025-01-20T14:00:00+00:00');
    });

    it('should format British Summer Time correctly', () => {
      // July 20, 2025 12:00:00 UTC = July 20, 2025 13:00:00 BST
      const timestamp = 1753012800;
      const result = ResponseTransformer.timestampToISOWithTimezone(timestamp, 'Europe/London');
      expect(result).toBe('2025-07-20T13:00:00+01:00');
    });
  });

  describe('Tokyo timezone (Asia/Tokyo)', () => {
    it('should format Japan Standard Time correctly', () => {
      // January 20, 2025 14:00:00 UTC = January 20, 2025 23:00:00 JST
      const timestamp = 1737381600;
      const result = ResponseTransformer.timestampToISOWithTimezone(timestamp, 'Asia/Tokyo');
      expect(result).toBe('2025-01-20T23:00:00+09:00');
    });

    it('should handle date rollover correctly', () => {
      // January 20, 2025 16:00:00 UTC = January 21, 2025 01:00:00 JST
      const timestamp = 1737388800;
      const result = ResponseTransformer.timestampToISOWithTimezone(timestamp, 'Asia/Tokyo');
      expect(result).toBe('2025-01-21T01:00:00+09:00');
    });
  });

  describe('Edge cases', () => {
    it('should handle leap year correctly', () => {
      // February 29, 2024 12:00:00 UTC
      const timestamp = 1709208000;
      const result = ResponseTransformer.timestampToISOWithTimezone(timestamp, 'UTC');
      expect(result).toBe('2024-02-29T12:00:00Z');
    });

    it('should handle year boundaries correctly', () => {
      // December 31, 2024 23:59:59 UTC
      const timestamp = 1735689599;
      const result = ResponseTransformer.timestampToISOWithTimezone(timestamp, 'UTC');
      expect(result).toBe('2024-12-31T23:59:59Z');
    });

    it('should handle negative timezone offsets', () => {
      // January 20, 2025 14:00:00 UTC in Hawaii (UTC-10)
      const timestamp = 1737381600;
      const result = ResponseTransformer.timestampToISOWithTimezone(timestamp, 'Pacific/Honolulu');
      expect(result).toBe('2025-01-20T04:00:00-10:00');
    });

    it('should handle fractional timezone offsets', () => {
      // Test with a timezone that has a 30-minute offset
      const timestamp = 1737381600;
      const result = ResponseTransformer.timestampToISOWithTimezone(timestamp, 'Asia/Kolkata');
      expect(result).toBe('2025-01-20T19:30:00+05:30');
    });
  });

  describe('Format validation', () => {
    it('should always return valid ISO format', () => {
      const timestamp = 1737381600;
      const timezones = ['UTC', 'America/New_York', 'Europe/London', 'Asia/Tokyo'];
      
      timezones.forEach(timezone => {
        const result = ResponseTransformer.timestampToISOWithTimezone(timestamp, timezone);
        
        // Should match ISO format: YYYY-MM-DDTHH:mm:ss(Z|±HH:mm)
        const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/;
        expect(result).toMatch(isoRegex);
        
        // Should be parseable as a valid date
        const parsedDate = new Date(result);
        expect(parsedDate.getTime()).toBe(timestamp * 1000);
      });
    });

    it('should handle seconds precision correctly', () => {
      // Test various seconds values
      const baseTimestamp = 1737381600; // 2025-01-20T14:00:00 UTC
      
      for (let seconds = 0; seconds < 60; seconds += 15) {
        const timestamp = baseTimestamp + seconds;
        const result = ResponseTransformer.timestampToISOWithTimezone(timestamp, 'UTC');
        const expectedSeconds = seconds.toString().padStart(2, '0');
        expect(result).toBe(`2025-01-20T14:00:${expectedSeconds}Z`);
      }
    });
  });

  // Test with a known timestamp: January 15, 2025 at 10:30:00 UTC
  const testTimestamp = 1736937000; // Unix timestamp for 2025-01-15T10:30:00Z

  it('should produce consistent output regardless of server timezone', () => {
    // Test with different timezones - the output should be deterministic
    const utcResult = ResponseTransformer.timestampToISOWithTimezone(testTimestamp, 'UTC');
    const nyResult = ResponseTransformer.timestampToISOWithTimezone(testTimestamp, 'America/New_York');
    const londonResult = ResponseTransformer.timestampToISOWithTimezone(testTimestamp, 'Europe/London');
    
    // UTC should always be the same
    expect(utcResult).toBe('2025-01-15T10:30:00Z');
    
    // NY should be UTC-5 in January (EST)
    expect(nyResult).toBe('2025-01-15T05:30:00-05:00');
    
    // London should be UTC+0 in January (GMT)
    expect(londonResult).toBe('2025-01-15T10:30:00+00:00');
  });

  it('should handle DST transitions correctly', () => {
    // Test during summer time: July 15, 2025 at 10:30:00 UTC
    const summerTimestamp = 1752575400; // Unix timestamp for 2025-07-15T10:30:00Z
    
    const nyResult = ResponseTransformer.timestampToISOWithTimezone(summerTimestamp, 'America/New_York');
    const londonResult = ResponseTransformer.timestampToISOWithTimezone(summerTimestamp, 'Europe/London');
    
    // NY should be UTC-4 in July (EDT)
    expect(nyResult).toBe('2025-07-15T06:30:00-04:00');
    
    // London should be UTC+1 in July (BST)
    expect(londonResult).toBe('2025-07-15T11:30:00+01:00');
  });

  it('should be timezone independent when run on different servers', () => {
    // This test simulates the function being called on servers in different timezones
    // The output should be identical regardless of server location
    
    // Mock different server timezones by setting TZ env var
    const originalTZ = process.env.TZ;
    
    const results: string[] = [];
    
    // Test as if server is in different timezones
    const serverTimezones = ['UTC', 'America/Los_Angeles', 'Asia/Tokyo'];
    
    try {
      for (const serverTz of serverTimezones) {
        process.env.TZ = serverTz;
        
        // Force Node.js to use the new timezone
        if (typeof process.hrtime.bigint === 'function') {
          // This is a hack to refresh timezone info in Node.js
          new Date().getTimezoneOffset();
        }
        
        const result = ResponseTransformer.timestampToISOWithTimezone(testTimestamp, 'America/New_York');
        results.push(result);
      }
      
      // All results should be identical
      expect(results[0]).toBe(results[1]);
      expect(results[1]).toBe(results[2]);
      expect(results[0]).toBe('2025-01-15T05:30:00-05:00');
      
    } finally {
      // Restore original timezone
      if (originalTZ) {
        process.env.TZ = originalTZ;
      } else {
        delete process.env.TZ;
      }
    }
  });

  it('should demonstrate the timezone independence bug fix', () => {
    // This test specifically demonstrates that the function is now robust against
    // server timezone changes that would have caused issues in previous versions
    
    const knownTimestamp = 1704110400; // 2024-01-01T12:00:00Z
    
    // Test with various target timezones
    const results = [
      ResponseTransformer.timestampToISOWithTimezone(knownTimestamp, 'America/New_York'),
      ResponseTransformer.timestampToISOWithTimezone(knownTimestamp, 'Europe/London'),
      ResponseTransformer.timestampToISOWithTimezone(knownTimestamp, 'Asia/Tokyo'),
      ResponseTransformer.timestampToISOWithTimezone(knownTimestamp, 'UTC'),
    ];
    
    // Expected results should be consistent regardless of server timezone
    expect(results[0]).toBe('2024-01-01T07:00:00-05:00'); // EST
    expect(results[1]).toBe('2024-01-01T12:00:00+00:00'); // GMT
    expect(results[2]).toBe('2024-01-01T21:00:00+09:00'); // JST  
    expect(results[3]).toBe('2024-01-01T12:00:00Z');      // UTC
    
    // Verify that all results represent the same absolute moment in time
    // by converting back to timestamps
    const backToTimestamps = results.map(isoString => {
      return Math.floor(new Date(isoString).getTime() / 1000);
    });
    
    // All should equal the original timestamp
    backToTimestamps.forEach(ts => {
      expect(ts).toBe(knownTimestamp);
    });
  });
});

describe('Open Hours Integration', () => {
  it('should apply open hours to availability request from timeframe', () => {
    const mockRequest = {
      start_time: 1749301200,
      end_time: 1749848400,
      duration_minutes: 30
    };

    const updatedRequest = OpenHoursDetector.applyOpenHours(
      mockRequest,
      'next week between 9am to 5pm',
      'America/New_York'
    );

    expect(updatedRequest.availability_rules).toBeDefined();
    expect(updatedRequest.availability_rules?.default_open_hours).toBeDefined();
    expect(updatedRequest.availability_rules?.default_open_hours?.[0]).toEqual({
      days: [1, 2, 3, 4, 5], // Monday-Friday
      timezone: 'America/New_York',
      start: '9:00',
      end: '17:00'
    });
  });

  it('should not apply open hours when timeframe has no time range', () => {
    const mockRequest = {
      start_time: 1749301200,
      end_time: 1749848400,
      duration_minutes: 30
    };

    const updatedRequest = OpenHoursDetector.applyOpenHours(
      mockRequest,
      'next week',
      'America/New_York'
    );

    // Should not have modified the request
    expect(updatedRequest.availability_rules?.default_open_hours).toBeUndefined();
  });

  it('should detect open hours from specific day expressions', () => {
    const openHours = OpenHoursDetector.detectFromTimeframe(
      'tomorrow between 8am to 6pm',
      'UTC'
    );

    expect(openHours).toBeDefined();
    expect(openHours?.[0].start).toBe('8:00');
    expect(openHours?.[0].end).toBe('18:00');
    expect(openHours?.[0].timezone).toBe('UTC');
  });
}); 