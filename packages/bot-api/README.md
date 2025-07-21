# MCP Bot API

A thin, secure façade for recruiting chatbots that provides:

1. Hosted Google OAuth via Nylas Connect
2. Grant-scoped API keys (JWT)
3. Calendar operations proxy to Nylas v3

## Architecture

This is a **Vercel Edge Runtime** deployment using Next.js App Router and TypeScript.

## Features

- **OAuth Flow**: Google Calendar connection via Nylas
- **JWT API Keys**: Short-lived, grant-scoped tokens
- **Calendar Proxy**: Pass-through operations to Nylas v3
- **Edge Runtime**: All routes run on Vercel Edge for global performance
- **Redis Storage**: Upstash Redis for grants and key management

## API Endpoints

### Authentication
- `GET /api/auth/connect/redirect` - Start OAuth flow
- `GET /api/auth/callback` - OAuth callback handler
- `GET /api/auth/me` - Get current user info (includes timezone from primary calendar)

### Key Management
- `POST /api/grants/{grant_id}/keys` - Create API key
- `GET /api/grants/{grant_id}/keys` - List keys for grant
- `DELETE /api/keys/{kid}` - Revoke API key

### Calendar Proxy
- `GET /api/directory/calendars` - Look up calendar_id by email
- `POST /api/proxy/calendars/availability` - Check availability
- `POST /api/proxy/events` - Create event
- `GET /api/proxy/events/{id}` - Get event
- `PATCH /api/proxy/events/{id}` - Update event
- `DELETE /api/proxy/events/{id}` - Delete event
- `POST /api/proxy/events/{id}/send-rsvp` - Send RSVP response

*Note: The proxy uses catch-all routing (`/api/proxy/[...nylas]`) to forward requests directly to Nylas API v3. All standard Nylas v3 endpoints are supported.*

### Utility
- `GET /api/health` - Health check
- `GET /schema/mcp.json` - MCP schema discovery

## Environment Variables

Copy `env.example` to `.env.local` and configure:

```bash
# Nylas API Configuration
NYLAS_API_KEY=your_nylas_api_key_here
NYLAS_API_URI=https://api.nylas.com

# Redis/KV Configuration (preferred)
KV_REST_API_URL=your_kv_rest_api_url_here
KV_REST_API_TOKEN=your_kv_rest_api_token_here
KV_REST_API_READ_ONLY_TOKEN=your_kv_rest_api_read_only_token_here
KV_URL=your_kv_redis_url_here
REDIS_URL=your_redis_url_here

# Legacy Upstash Redis Configuration (auto-injected by Vercel)
UPSTASH_REDIS_REST_URL=your_redis_url_here
UPSTASH_REDIS_REST_TOKEN=your_redis_token_here

# JWT Secret (auto-generated if not provided)
MCP_JWT_SECRET=your_jwt_secret_here
```

### Environment Variable Priority

The system will prioritize environment variables in this order:
1. **KV_REST_API_URL** and **KV_REST_API_TOKEN** (new preferred format)
2. **UPSTASH_REDIS_REST_URL** and **UPSTASH_REDIS_REST_TOKEN** (legacy format)
3. `Redis.fromEnv()` fallback

For read operations, if **KV_REST_API_READ_ONLY_TOKEN** is available, a separate read-only client will be used.

## Development

```bash
# Install dependencies
pnpm install

# Run development server
pnpm dev

# Build for production
pnpm build

# Start production server
pnpm start
```

## Deployment

### Vercel Deployment

1. Connect your repository to Vercel
2. Add Upstash Redis integration: `vercel integrations add upstash`
3. Set environment variables in Vercel dashboard
4. Deploy: `vercel deploy --prod`

### Environment Setup

1. **Upstash Redis**: Use Vercel integration for automatic setup
2. **Nylas API**: Get API key from Nylas dashboard
3. **JWT Secret**: Will be auto-generated on first use if not provided

## Usage

### 1. Connect Calendar

Navigate to `/api/auth/connect/redirect` to start OAuth flow.

### 2. Create API Key

```bash
curl -X POST https://your-domain.com/api/grants/{grant_id}/keys \
  -H "Content-Type: application/json" \
  -d '{"name": "Claude key", "ttl_days": 90}'
```

### 3. Use Calendar API

```bash
# Look up calendar_id for an email
curl -X GET "https://your-domain.com/api/directory/calendars?email=user@example.com" \
  -H "Authorization: Bearer {jwt_token}"

# Check availability
curl -X POST https://your-domain.com/api/proxy/calendars/availability \
  -H "Authorization: Bearer {jwt_token}" \
  -H "Content-Type: application/json" \
  -d '{"start_time": "2024-01-01T09:00:00Z", "end_time": "2024-01-01T17:00:00Z", "duration_minutes": 30}'
```

## Error Handling

All errors follow the format: `{"error": "error_code"}`

Common error codes:
- `oauth_url_error` - OAuth URL generation failed
- `invalid_state` - Invalid OAuth state parameter
- `exchange_failed` - OAuth token exchange failed
- `grant_not_found` - Grant ID not found
- `key_not_found` - API key not found
- `email_not_connected` - Email not connected to organization
- `unauthorized` - Invalid or expired JWT
- `path_not_allowed` - Proxy path not allowed
- `insufficient_scope` - Missing required scope

## Security

- All routes run on Edge Runtime for security isolation
- JWT tokens include revocation checking via Redis
- OAuth state parameter prevents CSRF attacks
- Path allowlist restricts proxy operations
- Scope validation ensures proper permissions
