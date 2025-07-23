# Clerk JWKS Demo App

A Node.js Express application demonstrating JWT validation using Clerk's JWKS (JSON Web Key Set) with the `jose` library. This app provides endpoints for testing JWT authentication and includes utilities for generating test tokens.

## Features

- ✅ JWT validation using Clerk's JWKS
- ✅ Support for both same-origin (cookie) and cross-origin (Authorization header) requests
- ✅ Test token generation via Clerk Backend SDK
- ✅ Protected and validation endpoints for testing
- ✅ TypeScript support with modern ES modules

## Prerequisites

- Node.js (v16 or higher)
- pnpm (recommended) or npm
- A Clerk account and application

## Setup Instructions

### 1. Clone and Install Dependencies

```bash
# Clone the repository (or download the files)
cd jwks-app

# Install dependencies using pnpm (recommended)
pnpm install

# Or use npm
npm install
```

### 2. Configure Environment Variables

Create a `.env.local` file in the project root with your Clerk credentials:

```bash
# .env.local
CLERK_SECRET_KEY=sk_test_your_secret_key_here
CLERK_PUBLISHABLE_KEY=pk_test_your_publishable_key_here
CLERK_FRONTEND_API=https://your-app-name.clerk.accounts.dev
```

**To get your Clerk credentials:**

1. Go to [Clerk Dashboard](https://dashboard.clerk.com)
2. Select your application
3. Navigate to **API Keys** in the sidebar
4. Copy your **Secret Key** (starts with `sk_test_` or `sk_live_`)
5. Copy your **Publishable Key** (starts with `pk_test_` or `pk_live_`)
6. Copy your **Frontend API** URL (the domain from your publishable key)

### 3. Start the Development Server

```bash
pnpm run dev
```

The server will start on `http://localhost:3999`

## API Endpoints

### Public Endpoints

- **GET /** - API documentation and endpoint information

### Protected Endpoints

- **POST /validate-jwt** - Validates JWT and returns token information
- **GET /protected** - Example protected route requiring valid JWT

## Testing the Application

### 1. Generate a Test Token

The app includes a utility to generate test tokens using the Clerk Backend SDK:

```bash
pnpm run test-token
```

This will:

- List users from your Clerk instance
- Find an active session for a user
- Generate a JWT token (valid for ~60 seconds)
- Provide ready-to-use curl commands

**Example output:**

```
🎉 SUCCESS! Here's your test JWT token:
================================================================================
eyJhbGciOiJSUzI1NiIsImNhdCI6ImNsX0I3ZDRQRDExMUFBQSIsImtpZCI6Imluc18zMEVYRjBNcEpB...
================================================================================

📋 You can now test your API with this token:
curl -X POST http://localhost:3999/validate-jwt \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -H "Content-Type: application/json"
```

### 2. Test JWT Validation

Use the generated token to test the validation endpoint:

```bash
# Test JWT validation
curl -X POST http://localhost:3999/validate-jwt \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -H "Content-Type: application/json"
```

**Expected successful response:**

```json
{
  "success": true,
  "message": "JWT is valid!",
  "user": {
    "id": "user_xxx",
    "sessionId": "sess_xxx",
    "email": "user@example.com",
    "name": "Demo User"
  },
  "tokenInfo": {
    "validatedAt": "2024-01-20T10:30:00.000Z",
    "tokenIssuer": "https://your-app.clerk.accounts.dev",
    "tokenSubject": "user_xxx",
    "sessionId": "sess_xxx",
    "authorizedParty": "https://your-app.clerk.accounts.dev",
    "tokenExpiration": "2024-01-20T10:31:00.000Z",
    "tokenNotBefore": "2024-01-20T10:29:50.000Z"
  }
}
```

### 3. Test Protected Route

```bash
# Test protected route
curl -X GET http://localhost:3999/protected \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

**Expected successful response:**

```json
{
  "success": true,
  "message": "Access granted to protected resource!",
  "user": {
    "id": "user_xxx",
    "sessionId": "sess_xxx",
    "email": "user@example.com"
  },
  "data": {
    "secretMessage": "This is protected data that only authenticated users can see",
    "timestamp": "2024-01-20T10:30:00.000Z"
  }
}
```

### 4. Test Without Token (Should Fail)

```bash
# This should return 401 Unauthorized
curl -X POST http://localhost:3999/validate-jwt \
  -H "Content-Type: application/json"
```

**Expected error response:**

```json
{
  "error": "Not signed in",
  "message": "No session token found in __session cookie or Authorization header"
}
```

## Authentication Methods

This app supports two authentication methods:

### 1. Same-Origin Requests (Cookie-based)

For requests from the same domain, include the `__session` cookie:

```javascript
// Frontend JavaScript (same domain)
fetch("/validate-jwt", {
  method: "POST",
  credentials: "include", // Include cookies
});
```

### 2. Cross-Origin Requests (Header-based)

For requests from different domains, include the JWT in the Authorization header:

```javascript
// Frontend JavaScript (different domain)
const token = await clerk.session.getToken();
fetch("http://localhost:3999/validate-jwt", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
});
```

## Development Scripts

- `pnpm run dev` - Start development server with hot reload
- `pnpm run build` - Build TypeScript to JavaScript
- `pnpm run start` - Start production server
- `pnpm run test-token` - Generate test JWT token
- `pnpm run detect-config` - Auto-detect Clerk configuration

## Project Structure

```
jwks-app/
├── src/
│   ├── index.ts              # Main Express application
│   └── middleware/
│       └── jwt.ts            # JWT validation middleware
├── generate-test-token.mjs   # Test token generator utility
├── detect-clerk-config.mjs   # Configuration detection utility
├── package.json              # Dependencies and scripts
├── tsconfig.json            # TypeScript configuration
└── .env.local               # Environment variables (not in git)
```

## Troubleshooting

### Common Issues

1. **"Missing Clerk Secret Key" error**
   - Ensure both `CLERK_SECRET_KEY` and `CLERK_PUBLISHABLE_KEY` are set in `.env.local`
   - Verify the secret key starts with `sk_test_` or `sk_live_`
   - Verify the publishable key starts with `pk_test_` or `pk_live_`

2. **"Expected 200 OK from JWKS HTTP response" error**
   - Ensure `CLERK_FRONTEND_API` is set correctly in `.env.local`
   - The URL should match your Clerk application's Frontend API URL

3. **"No active sessions found" when generating test tokens**
   - Sign in to your application in the browser first
   - Ensure you have at least one user with an active session

4. **Token expired errors**
   - Generate a fresh token using `pnpm run test-token`
   - Default tokens expire in ~60 seconds

### For Longer-Lived Tokens

For testing that requires longer-lived tokens:

1. Go to your Clerk Dashboard
2. Navigate to **JWT Templates**
3. Create a new **Blank** template
4. Set **Token Lifetime** to a longer duration (max: 10 years)
5. Use the browser console to generate tokens with your template:
   ```javascript
   await window.Clerk.session.getToken({ template: "your-template-name" });
   ```

## Security Notes

- Never commit `.env.local` to version control
- Use environment-specific keys (test keys for development, live keys for production)
- Keep your secret key secure - it provides full access to your Clerk instance
- Publishable keys can be safely used in frontend applications
- Validate the `azp` (authorized parties) claim in production
- Consider implementing rate limiting for production use

## Contributing

Feel free to submit issues and enhancement requests!

## License

ISC
