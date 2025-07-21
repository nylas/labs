# Rate Limiting Implementation

## Overview

The Chat API (`/api/chat`) now includes intelligent rate limiting to prevent abuse and protect against excessive OpenAI usage costs. The rate limiting uses multiple strategies to ensure fair usage while preventing system abuse.

## Rate Limiting Strategy

### Multiple Rate Limits

1. **Request Limit**: 60 requests per hour per API key
2. **Token Usage Limit**: ~10,000 estimated tokens per minute
3. **Tool Call Limit**: 100 tool calls per hour (expensive calendar operations)
4. **Burst Protection**: 10 requests per minute to prevent rapid-fire abuse

### Library Used

We use `@upstash/ratelimit` which is:
- **Edge Runtime Compatible** - Works with Next.js Edge functions
- **Redis-backed** - Uses your existing Upstash Redis instance
- **Officially Recommended** - Recommended by Next.js documentation
- **Analytics Enabled** - Provides monitoring capabilities

## How It Works

### Rate Limit Checks

The system performs **parallel rate limit checks** for all strategies:

```typescript
const rateLimitResult = await checkChatRateLimit(apiKey, messages);
```

### Response Headers

When rate limits are hit, the API returns:

```http
HTTP/1.1 429 Too Many Requests
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1642694400
Retry-After: 3600
Content-Type: application/json

{
  "error": "rate_limit_exceeded",
  "message": "Rate limit exceeded: request limit",
  "retryAfter": 3600
}
```

### Smart Features

1. **Token Estimation** - Estimates OpenAI token usage from message content
2. **Tool Call Prediction** - Estimates potential tool calls to prevent expensive operations
3. **Progressive Penalties** - Built into the Upstash library
4. **Fail-Open Design** - If Redis is down, requests are allowed through

## Configuration

### Rate Limits

All limits can be adjusted in `/src/lib/rate-limiter.ts`:

```typescript
// Chat requests per hour
export const chatRateLimit = new Ratelimit({
  redis: redis,
  limiter: Ratelimit.slidingWindow(60, '1 h'), // Adjustable
});

// Token usage per minute  
export const tokenRateLimit = new Ratelimit({
  redis: redis,
  limiter: Ratelimit.slidingWindow(10000, '1 m'), // Adjustable
});
```

### Environment Variables

No additional environment variables needed - uses your existing Redis configuration:
- `KV_REST_API_URL` or `UPSTASH_REDIS_REST_URL`
- `KV_REST_API_TOKEN` or `UPSTASH_REDIS_REST_TOKEN`

## Monitoring

### Analytics

Rate limiting analytics are automatically collected by Upstash. You can view them in your Upstash dashboard to monitor:

- Request patterns
- Rate limit hits
- Usage trends
- Potential abuse attempts

### Logging

All rate limit violations are logged with context:

```typescript
logger.warn("Chat API - Rate limit exceeded", {
  requestId,
  reason: "request limit",
  retryAfter: 3600,
});
```

## Abuse Prevention

### Multi-layered Protection

1. **Request-based**: Prevents API spam
2. **Token-based**: Prevents expensive OpenAI usage
3. **Tool-based**: Prevents calendar operation abuse
4. **Burst-based**: Prevents rapid automation

### Fair Usage

- Legitimate users can have normal conversations
- Short bursts are allowed for natural conversation flow
- Long-term limits prevent sustained abuse
- Different limits for different resource types

## Testing Rate Limits

### Manual Testing

Use curl to test rate limits:

```bash
# Rapid requests to trigger burst limit
for i in {1..15}; do
  curl -X POST https://your-domain.com/api/chat \
    -H "Content-Type: application/json" \
    -d '{"apiKey":"your-key","messages":[{"role":"user","content":"test"}]}'
done
```

### Monitoring Tools

- Check Upstash Redis dashboard for rate limit keys
- Monitor application logs for rate limit violations
- Use rate limit response headers in client applications

## Deployment Considerations

### Redis Performance

Rate limiting adds minimal Redis operations:
- 4 Redis calls per chat request (parallel)
- Keys automatically expire
- Minimal memory footprint

### Edge Runtime

Fully compatible with Vercel Edge Runtime and similar platforms - no Node.js-specific dependencies.

## Future Enhancements

Potential improvements:
- User-based limits (in addition to API key)
- Dynamic limits based on usage patterns
- Integration with OpenAI usage tracking
- Rate limit bypass for premium users 