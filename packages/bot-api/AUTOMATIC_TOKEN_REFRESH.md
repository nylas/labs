# Automatic Token Refresh

This feature automatically handles refresh token rotation for the bot-api application, ensuring users stay authenticated without manual intervention.

## How It Works

The automatic token refresh system consists of several components working together:

### 1. Enhanced `useAuth` Hook

The `useAuth` hook now includes:
- **Proactive monitoring**: Checks token expiry every 30 seconds when authenticated
- **Smart refresh timing**: Refreshes tokens 5 minutes before expiry
- **Debounced requests**: Prevents multiple simultaneous refresh attempts
- **Automatic retry**: Re-validates user data after successful refresh

### 2. API Client with Interceptor

The `apiFetch` client in `/src/lib/api-client.ts` provides:
- **Transparent refresh**: Automatically refreshes tokens on 401 responses
- **Request queuing**: Queues requests during token refresh
- **Retry logic**: Retries failed requests after successful refresh
- **Graceful fallback**: Redirects to login if refresh fails

### 3. Token Management

- **Access tokens**: Stored in httpOnly cookies, expire in 1 hour by default
- **Refresh tokens**: Stored in httpOnly cookies, expire in 30 days by default
- **Automatic rotation**: Both tokens are updated during refresh

## API Endpoints

### `/api/auth/tokeninfo` (GET)
Returns current token information including expiry time.

**Response:**
```json
{
  "request_id": "...",
  "data": {
    "iss": "https://api.us.nylas.com",
    "aud": "client_id",
    "sub": "grant_id",
    "email": "user@example.com",
    "iat": 1234567890,
    "exp": 1234571490,
    "org_id": "org_id"
  }
}
```

### `/api/auth/refresh` (POST)
Refreshes access and refresh tokens.

**Request:**
```json
{
  "refresh_token": "optional_refresh_token"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "access_token": "new_access_token",
    "refresh_token": "new_refresh_token",
    "grant_id": "grant_id",
    "provider": "google",
    "email": "user@example.com",
    "expires_in": 3600,
    "token_type": "Bearer",
    "scope": "calendar.rw",
    "id_token": "..."
  }
}
```

## Usage

### For New Components

Use the enhanced API client for automatic token refresh:

```typescript
import { apiGet, apiPost } from '@/lib/api-client';

// GET request with automatic token refresh
const data = await apiGet<UserData>('/api/user/profile');

// POST request with automatic token refresh
const result = await apiPost<CreateResponse>('/api/events', {
  title: 'Meeting',
  start_time: '2024-01-01T10:00:00Z'
});
```

### For Existing Components

Replace `fetch` calls with `apiFetch`:

```typescript
// Before
const response = await fetch('/api/data');

// After
import { apiFetch } from '@/lib/api-client';
const response = await apiFetch('/api/data');
```

### Manual Token Refresh

The `useAuth` hook exposes a manual refresh function:

```typescript
const { checkAndRefreshToken } = useAuth();

// Manually trigger token refresh check
await checkAndRefreshToken();
```

## Configuration

### Token Expiry Buffer

Tokens are refreshed 5 minutes before expiry. This can be adjusted in the `shouldRefreshToken` function:

```typescript
const expiryBuffer = 5 * 60; // 5 minutes in seconds
```

### Refresh Intervals

- **Periodic checks**: Every 60 seconds when authenticated
- **SWR refresh**: Every 30 seconds for auth state
- **Manual throttling**: Minimum 30 seconds between refresh attempts

### Cookie Settings

Access and refresh tokens are stored as httpOnly cookies:

```typescript
// Access token: 1 hour expiry
await setAccessTokenCookie(token, { maxAge: 60 * 60 });

// Refresh token: 30 days expiry
await setRefreshTokenCookie(token, { maxAge: 60 * 60 * 24 * 30 });
```

## Error Handling

### Token Refresh Failure
- Logs error and stops retry attempts
- Subsequent API calls will trigger refresh attempts
- Eventually redirects to login if refresh consistently fails

### Network Errors
- Retries with exponential backoff (handled by underlying fetch)
- Falls back to manual refresh if needed
- Graceful degradation for offline scenarios

### Security Considerations
- All tokens stored in httpOnly cookies
- Automatic cleanup on logout
- CSRF protection via SameSite cookies
- Secure flag in production

## Monitoring and Debugging

### Console Logs
The system logs key events for debugging:
- Token refresh attempts
- Successful refreshes
- Refresh failures
- Queue management

### Request IDs
All refresh requests include unique request IDs for tracing.

### Health Checks
Token health is monitored through the `/api/auth/tokeninfo` endpoint.

## Migration Guide

### From Manual Refresh
If you were manually handling token refresh:

1. Remove manual refresh logic
2. Replace `fetch` with `apiFetch`
3. Remove token expiry checks
4. Let the system handle refresh automatically

### Backward Compatibility
The existing `/api/auth/refresh` endpoint remains unchanged and can still be called manually if needed.

## Best Practices

1. **Use the API client**: Always use `apiFetch` or the helper functions for API calls
2. **Avoid manual refresh**: Let the system handle token refresh automatically
3. **Handle auth errors**: Provide fallback UI for authentication failures
4. **Monitor logs**: Check console logs for refresh-related issues
5. **Test offline**: Ensure graceful degradation when offline

## Troubleshooting

### Common Issues

**Infinite refresh loops**: Check that the refresh endpoint isn't causing the loop
**Multiple refresh attempts**: Ensure components aren't bypassing the API client
**Cookie issues**: Verify httpOnly cookies are being set correctly
**Timing issues**: Check that token expiry times are correct

### Debug Mode

Enable debug logging by checking the browser console for messages starting with:
- "Token expired or expiring soon, refreshing..."
- "Token refresh successful"
- "Token refresh failed" 