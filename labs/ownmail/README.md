<img src="./assets/banner.svg" alt="OwnMail — your inbox, your domain, no per-seat fees" width="100%" />

# OwnMail

**Your inbox. Your domain. No per-seat fees.**

> Experiment — try it, share feedback, and expect APIs or workflows to change
> while the project develops.

OwnMail deploys a mailbox and calendar app to your Cloudflare account, powered by
[Nylas Agent Accounts](https://developer.nylas.com/docs/v3/agent-accounts/).

From this repository:

```bash
pnpm install
pnpm --filter ownmail build
node labs/ownmail/packages/cli/dist/index.js
```

After the CLI is published to npm, you can run the same setup flow with:

```bash
npx ownmail
```

The setup wizard walks you through sign-in, inbox creation, domain setup, and
deployment. You can re-run the CLI at any time; setup steps are resumable.

## What You Need

- Node.js 20+
- A Nylas account
- A Cloudflare account
- A domain you control, or a free `nylas.email` subdomain created during setup

## What Gets Created

1. A Nylas application and API key for your mailbox app
2. A mailbox address, such as `contact@your-domain.com`
3. A generated inbox password, shown once during setup
4. A Cloudflare Workers deployment for the web app
5. The required callback and app configuration for sign-in

## Commands

| Command | What it does |
|---|---|
| `ownmail` | Create or resume an OwnMail deployment |
| `ownmail status` | Show your OwnMail projects |
| `ownmail update` | Redeploy the latest app version |
| `ownmail doctor` | Check configuration and repair common issues |
| `ownmail grants` | List inboxes connected to your Nylas app |
| `ownmail eject [dir]` | Copy the app source into a directory you control |
| `ownmail inbox add` | Add another address on your domain |
| `ownmail inbox reset-password [email]` | Reset an inbox password |
| `ownmail rotate-key` | Rotate the API key used by the app |
| `ownmail app-domain mail.example.com` | Serve the app on your own domain |
| `ownmail destroy` | Remove the deployed app without deleting mail data |

When running from source, replace `ownmail` with
`node labs/ownmail/packages/cli/dist/index.js`.

## Packages

| Package | What it contains |
|---|---|
| `packages/cli` (`ownmail`) | The command-line setup and deployment workflow |
| `packages/template` (`@ownmail/template`) | The mailbox and calendar app deployed by the CLI |

## Security And Data Handling

- OwnMail uses browser-based sign-in for Nylas and Cloudflare setup.
- App secrets, including the Nylas API key and session secret, are stored as
  Cloudflare Worker secrets.
- The deployed app resolves the active inbox from the server-side session,
  not from client-provided identifiers.
- Email HTML is rendered in sandboxed frames.
- Do not commit generated secrets, inbox passwords, `.env` files, or exported
  deployment credentials.

## Deploying To Vercel

The app template also includes a Vercel build target. From an ejected project:

```bash
pnpm build:vercel
vercel deploy --prebuilt
```

Set the environment variables from `template.json` in your Vercel project. Add
your deployed Vercel callback URL to your Nylas application before using sign-in.

## Local Development

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
```

Node.js 20+ and pnpm 10+ are required.

### Develop The App UI Locally

For fast UI work without Nylas credentials, Cloudflare, or a deploy:

```bash
pnpm --filter @ownmail/template dev:ui
```

Open the printed localhost URL and go to `/mail`. This runs the TanStack Start
app with local in-memory mail, draft, contact, and calendar data.

The local UI mock is intentionally limited to the same grant-scoped Nylas v3
resources the app uses in production:

- Mail: threads, messages, drafts, folders, send with small JSON attachments,
  and attachment downloads.
- Calendar: calendars, events, create/update/delete event, and RSVP.
- Contacts: contact lookup for compose autocomplete.
- Realtime refresh: Nylas webhooks in Cloudflare deployments; local UI mocks and
  Vercel deployments fall back to navigation/focus refresh.

Those capabilities map to the public
[Nylas API reference](https://developer.nylas.com/docs/reference/api/). Features
outside that wired surface, such as free/busy, availability, scheduling,
notetaker, templates, or workflows, should be proven against `dev:local` before
they are added to the UI.

To test the real hosted-auth and Nylas API flow locally, export the template
environment variables and run the Node SSR target:

```bash
export SESSION_SECRET="..."
export NYLAS_API_KEY="..."
export NYLAS_CLIENT_ID="..."
export NYLAS_REGION="us"
export APP_NAME="ownmail-local"
export INBOX_EMAIL="you@example.com"
export TEMPLATE_VERSION="0.1.0"
pnpm --filter @ownmail/template dev:local
```

Register `http://localhost:5173/auth/callback` as a callback URI on the Nylas
application before using `dev:local`.
