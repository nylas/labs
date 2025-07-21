# Nylas Clerk Integration

A comprehensive SDK for integrating Nylas with Clerk authentication in Next.js applications, including a CLI tool for easy setup.

## Features

- 🔐 **Seamless Authentication**: Integrate Nylas with Clerk authentication
- 🚀 **Easy Setup**: CLI tool to create Clerk OAuth applications directly
- 📧 **Email & Calendar**: Access to Nylas email and calendar APIs
- 🔧 **TypeScript Support**: Full TypeScript support with proper types
- 🎯 **Next.js Optimized**: Built specifically for Next.js applications
- ✨ **Smart Detection**: Automatically detects existing Nylas OAuth applications

## Installation

```bash
npm install nylas-clerk-integration
# or
yarn add nylas-clerk-integration
# or
pnpm add nylas-clerk-integration
```

## CLI Usage

The package includes a CLI tool that directly creates Clerk OAuth applications with Nylas as the provider using the Clerk Backend API.

### Setup Command

Create a new Clerk OAuth application for Nylas:

```bash
# Interactive setup (recommended)
npx nylas-clerk-integration setup

# Non-interactive setup
npx nylas-clerk-integration setup \
  --clerk-secret-key sk_test_your_clerk_secret_key \
  --nylas-client-id your_nylas_client_id \
  --nylas-client-secret your_nylas_client_secret \
  --redirect-url http://localhost:3000/auth/callback
```

### What the CLI Does

1. **Checks for existing applications**: Scans your Clerk instance for existing Nylas OAuth applications
2. **Smart prompting**: If an existing application is found, asks whether to update or create new
3. **Direct API integration**: Uses the Clerk Backend API to create OAuth applications
4. **Provides integration instructions**: Shows you exactly how to configure the OAuth provider in your Clerk Dashboard

### CLI Options

| Option | Description | Default |
|--------|-------------|---------|
| `--clerk-secret-key` | Your Clerk secret key (starts with `sk_`) | Interactive prompt |
| `--nylas-client-id` | Your Nylas application client ID | Interactive prompt |
| `--nylas-client-secret` | Your Nylas application client secret | Interactive prompt |
| `--redirect-url` | OAuth redirect URL for your application | `http://localhost:3000/auth/callback` |
| `--environment` | Environment (development/production) | `development` |

## SDK Usage

After setting up the OAuth application with the CLI, use the SDK in your Next.js application:

```typescript
import { createNylasGrant } from 'nylas-clerk-integration'

// In your API route or server component
const grantResult = await createNylasGrant({
  clerkUserId: 'user_123',
  accessToken: 'clerk_access_token',
  // ... other options
})

if (grantResult.success) {
  console.log('Nylas grant created:', grantResult.data)
} else {
  console.error('Failed to create grant:', grantResult.error)
}
```

## Required Environment Variables

After running the CLI setup, make sure to add these environment variables to your application:

```bash
# From your Clerk Dashboard
CLERK_SECRET_KEY=sk_test_your_clerk_secret_key
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_your_clerk_publishable_key

# From your Nylas Dashboard
NYLAS_CLIENT_ID=your_nylas_client_id
NYLAS_CLIENT_SECRET=your_nylas_client_secret
```

## Manual Setup (Alternative)

If you prefer manual setup, you can configure the OAuth provider directly in your Clerk Dashboard:

1. Go to your Clerk Dashboard
2. Navigate to "User & Authentication" → "Social Connections"
3. Add a new "Custom OAuth" provider
4. Configure with the following settings:
   - **Provider Name**: Nylas
   - **Client ID**: Your Nylas Client ID
   - **Client Secret**: Your Nylas Client Secret
   - **Authorization URL**: `https://api.us.nylas.com/v3/connect/auth`
   - **Token URL**: `https://api.us.nylas.com/v3/connect/token`
   - **User Info URL**: `https://api.us.nylas.com/v3/grants/me`
   - **Scopes**: `calendar email`

## Error Handling

The CLI provides detailed error messages and handles common issues:

- **Invalid Clerk credentials**: Clear error messages for authentication failures
- **Existing applications**: Smart detection and user choice for existing OAuth apps
- **Network issues**: Graceful handling of API connection problems
- **Validation errors**: Input validation with helpful error messages

## Development

```bash
# Build the package
npm run build

# Test the CLI locally
node dist/cli/index.js setup --help
```

## Support

For issues and questions:
- Check the [Nylas Documentation](https://docs.nylas.com/)
- Check the [Clerk Documentation](https://clerk.com/docs)
- Create an issue in this repository

## License

MIT License - see LICENSE file for details 