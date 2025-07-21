# Logging System

This project uses [Pino](https://getpino.io/) for structured logging with enhanced error tracking and operation monitoring.

## Features

- **Structured Logging**: All logs are structured JSON with consistent fields
- **Request Tracing**: Each request gets a unique ID for tracing across components
- **Redis Operation Logging**: Detailed logging of all Redis operations with error handling
- **OAuth Flow Logging**: Complete OAuth flow tracking with success/failure states
- **JWT Operation Logging**: JWT signing and verification with detailed context
- **HTTP Request/Response Logging**: Comprehensive HTTP operation tracking
- **Development-Friendly**: Pretty-printed logs in development, JSON in production

## Configuration

### Environment Variables

```bash
# Set log level (trace, debug, info, warn, error, fatal)
LOG_LEVEL=debug

# Node environment affects log format
NODE_ENV=development  # Pretty printing
NODE_ENV=production   # JSON format
```

### Log Levels

- `trace`: Most verbose, includes all operations
- `debug`: Development debugging, Redis operations, JWT operations
- `info`: Normal operations, OAuth flows, configuration
- `warn`: Warning conditions, fallbacks
- `error`: Error conditions with full context
- `fatal`: Critical errors that might cause app termination

## Usage

### Basic Logging

```typescript
import { logger } from '@/lib/logger';

// Simple info logging
logger.info('Operation completed');

// With additional context
logger.info('User authenticated', { userId: '123', provider: 'google' });

// Error logging
logger.error('Database connection failed', error, { retryCount: 3 });
```

### Request-Specific Logging

```typescript
import { getRequestLogger } from '@/lib/logger';

export async function GET(request: Request) {
  const logger = getRequestLogger(request);
  
  logger.info('Processing request', { operation: 'get_grants' });
  // ... request processing
  logger.success('Request completed', { itemCount: results.length });
}
```

### Specialized Logging Methods

#### Redis Operations
```typescript
// Automatically logged in RedisStore methods
const grant = await RedisStore.getGrant(grantId);

// Manual Redis operation logging
logger.redisOperation('hset', 'user:123', { userId: '123' });
logger.redisError('hset', error, 'user:123', { userId: '123' });
```

#### OAuth Operations
```typescript
logger.oauthStart('google', { redirectUri, state });
logger.oauthSuccess('google', grantId, { email, orgId });
logger.oauthError('google', error, { step: 'token_exchange' });
```

#### HTTP Operations
```typescript
logger.httpRequest('POST', 'https://api.nylas.com/token');
logger.httpResponse('POST', 'https://api.nylas.com/token', 200, 1250);
logger.httpError('POST', 'https://api.nylas.com/token', error);
```

#### JWT Operations
```typescript
// Automatically logged in JWT functions
const token = await signGrantJwt(grantId, orgId);
const payload = await verifyJwt(token);

// Manual JWT logging
logger.jwtOperation('sign', { grantId, ttl: 3600 });
logger.jwtError('verify', error, { kid: 'abc-123' });
```

## Log Structure

All logs follow a consistent structure:

```json
{
  "level": 30,
  "time": "2024-01-15T10:30:00.000Z",
  "name": "mcp-bot-api",
  "env": "development",
  "requestId": "req-uuid-here",
  "operation": "redis",
  "redisOperation": "hset",
  "grantId": "grant-123",
  "key": "grant:grant-123",
  "msg": "Redis hset"
}
```

### Common Fields

- `level`: Log level number (10=trace, 20=debug, 30=info, 40=warn, 50=error, 60=fatal)
- `time`: ISO timestamp
- `name`: Application name
- `env`: Environment (development/production)
- `msg`: Human-readable message
- `requestId`: Request tracking ID
- `operation`: Operation type (redis, oauth, jwt, http_request, etc.)

### Operation-Specific Fields

#### Redis Operations
- `redisOperation`: Redis command (hset, hget, etc.)
- `key`: Redis key being operated on
- `grantId`: Associated grant ID if applicable

#### OAuth Operations
- `provider`: OAuth provider (google, microsoft, etc.)
- `grantId`: Generated grant ID
- `email`: User email
- `orgId`: Organization ID

#### HTTP Operations
- `method`: HTTP method
- `url`: Request URL (sensitive parts masked)
- `status`: Response status code
- `duration`: Request duration in milliseconds

#### JWT Operations
- `jwtOperation`: JWT operation (sign, verify, etc.)
- `kid`: Key ID
- `grantId`: Associated grant ID
- `exp`: Token expiration timestamp

## Error Handling

Errors are logged with full context including:

- Error message and stack trace
- Operation context
- Associated resource IDs
- Request information
- Recovery actions taken

Example error log:
```json
{
  "level": 50,
  "time": "2024-01-15T10:30:00.000Z",
  "name": "mcp-bot-api",
  "requestId": "req-uuid-here",
  "operation": "redis",
  "redisOperation": "hset",
  "key": "grant:grant-123",
  "grantId": "grant-123",
  "error": "fetch failed",
  "stack": "Error: fetch failed\n    at ...",
  "name": "Error",
  "msg": "Redis hset failed"
}
```

## Monitoring and Alerting

### Key Metrics to Monitor

1. **Error Rates**: Count of error-level logs per operation type
2. **Redis Connection Issues**: Logs with `operation: "redis"` and level >= 50
3. **OAuth Failures**: Logs with `operation: "oauth_error"`
4. **JWT Issues**: Logs with `operation: "jwt"` and `jwtOperation: "verify"` failures
5. **HTTP Timeouts**: HTTP operations with high duration or errors

### Alert Conditions

```javascript
// High error rate
level >= 50 AND operation = "redis"

// OAuth flow failures
operation = "oauth_error"

// JWT verification failures
operation = "jwt" AND jwtOperation = "verify" AND level >= 50

// Connection issues
msg CONTAINS "fetch failed" OR msg CONTAINS "connection"
```

## Development Tips

1. **Use appropriate log levels**: Don't use `info` for debug information
2. **Include context**: Always add relevant IDs and parameters
3. **Mask sensitive data**: Never log full tokens, passwords, or secrets
4. **Use structured data**: Prefer additional fields over string concatenation
5. **Test error paths**: Verify error logging works in failure scenarios

## Production Considerations

1. **Log Aggregation**: Use centralized logging (CloudWatch, DataDog, etc.)
2. **Log Retention**: Configure appropriate retention policies
3. **Performance**: Pino is designed for high performance
4. **Storage**: Monitor log volume in production
5. **Alerting**: Set up alerts on error patterns 