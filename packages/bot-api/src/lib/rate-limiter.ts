import { Ratelimit } from '@upstash/ratelimit';
import { redis, testRedisWritePermissions } from './redis';

// Test Redis write permissions on startup
let redisWritePermissionsChecked = false;
let redisHasWriteAccess = false;

async function ensureRedisWriteAccess(): Promise<boolean> {
  if (!redisWritePermissionsChecked) {
    redisHasWriteAccess = await testRedisWritePermissions();
    redisWritePermissionsChecked = true;
  }
  return redisHasWriteAccess;
}

// Chat-specific rate limiter with intelligent limits
export const chatRateLimit = new Ratelimit({
  redis: redis,
  limiter: Ratelimit.slidingWindow(60, '1 h'), // 60 requests per hour
  analytics: true, // Enable analytics for monitoring
  prefix: 'chat',
});

// Token usage rate limiter (estimated)
export const tokenRateLimit = new Ratelimit({
  redis: redis,
  limiter: Ratelimit.slidingWindow(10000, '1 m'), // ~10k tokens per minute
  analytics: true,
  prefix: 'tokens',
});

// Tool call rate limiter (expensive operations)
export const toolCallRateLimit = new Ratelimit({
  redis: redis,
  limiter: Ratelimit.slidingWindow(100, '1 h'), // 100 tool calls per hour
  analytics: true,
  prefix: 'tools',
});

// Burst protection - allow short bursts but prevent sustained abuse
export const burstRateLimit = new Ratelimit({
  redis: redis,
  limiter: Ratelimit.slidingWindow(10, '1 m'), // 10 requests per minute for bursts
  analytics: true,
  prefix: 'burst',
});

// Helper function to estimate tokens from messages
export function estimateTokens(messages: Array<{ role: string; content: string }>): number {
  const text = JSON.stringify(messages);
  // Conservative estimation: ~4 characters per token for GPT models
  return Math.ceil(text.length / 4);
}

// Helper function to count potential tool calls
export function countPotentialToolCalls(messages: Array<{ role: string; content: string }>): number {
  // Look for user messages that might trigger tool calls
  const userMessages = messages.filter(m => m.role === 'user');
  // Estimate 1-3 tool calls per user message on average
  return userMessages.length * 2;
}

// Rate limit result interface for better error handling
export interface RateLimitCheck {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
  pending?: Promise<unknown>;
}

// Combined rate limit check for chat endpoint
export async function checkChatRateLimit(
  identifier: string,
  _messages: Array<{ role: string; content: string }>
): Promise<{
  allowed: boolean;
  reason?: string;
  retryAfter?: number;
  details: {
    requests: RateLimitCheck;
    tokens: RateLimitCheck;
    tools: RateLimitCheck;
    burst: RateLimitCheck;
  };
}> {
  // Check Redis write permissions first
  const hasWriteAccess = await ensureRedisWriteAccess();
  if (!hasWriteAccess) {
    return {
      allowed: false,
      reason: 'Redis write permissions unavailable - rate limiting disabled. Check that KV_REST_API_TOKEN has write permissions.',
      details: {
        requests: { success: false, limit: 0, remaining: 0, reset: Date.now() + 60000 },
        tokens: { success: false, limit: 0, remaining: 0, reset: Date.now() + 60000 },
        tools: { success: false, limit: 0, remaining: 0, reset: Date.now() + 60000 },
        burst: { success: false, limit: 0, remaining: 0, reset: Date.now() + 60000 },
      },
    };
  }

  // Estimate usage for future use (currently not used in parallel calls)
  // const estimatedTokens = estimateTokens(messages);
  // const estimatedToolCalls = countPotentialToolCalls(messages);

  // Check all rate limits in parallel
  const [requestCheck, tokenCheck, toolCheck, burstCheck] = await Promise.all([
    chatRateLimit.limit(identifier),
    tokenRateLimit.limit(identifier + ':tokens'),
    toolCallRateLimit.limit(identifier + ':tools'),
    burstRateLimit.limit(identifier + ':burst'),
  ]);

  const details = {
    requests: requestCheck,
    tokens: tokenCheck,
    tools: toolCheck,
    burst: burstCheck,
  };

  // Check if any limit is exceeded
  const failedChecks = [];
  if (!requestCheck.success) failedChecks.push('request limit');
  if (!tokenCheck.success) failedChecks.push('token limit');
  if (!toolCheck.success) failedChecks.push('tool call limit');
  if (!burstCheck.success) failedChecks.push('burst limit');

  if (failedChecks.length > 0) {
    // Find the most restrictive reset time
    const nextReset = Math.min(
      requestCheck.reset,
      tokenCheck.reset,
      toolCheck.reset,
      burstCheck.reset
    );
    
    const retryAfter = Math.ceil((nextReset - Date.now()) / 1000);

    return {
      allowed: false,
      reason: `Rate limit exceeded: ${failedChecks.join(', ')}`,
      retryAfter,
      details,
    };
  }

  return {
    allowed: true,
    details,
  };
} 