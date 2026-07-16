<img src="./assets/banner.svg" alt="OwnMail — your inbox, your domain, no per-seat fees" width="100%" />

# OwnMail

**Email that answers to you.**

> Experiment — try it, share feedback, and expect APIs or workflows to change
> while the project develops.

OwnMail gives independent builders a mailbox and calendar app on a domain they
control. Deploy it to Cloudflare, Vercel, or Netlify, or run it on your own
machine. It is powered by
[Nylas Agent Accounts](https://developer.nylas.com/docs/v3/agent-accounts/).

Start with a friendly setup wizard. Keep the deployment in your own account.
When the defaults are no longer enough, eject the app source and make it
entirely yours.

## Start with one command

```bash
npx ownmail
```

The setup wizard walks you through sign-in, inbox creation, domain setup, and
deployment. You can re-run the CLI at any time; setup steps are resumable.

![OwnMail's local mock inbox with The Dispatch open, divided diagonally between light and dark modes](./assets/screenshots/ownmail-mail-modes.png)

## Beyond the inbox

| Calendar | Contacts |
|---|---|
| ![OwnMail's week calendar view with scheduled events](./assets/screenshots/ownmail-calendar.png) | ![OwnMail's contacts view with contact list and create control](./assets/screenshots/ownmail-contacts.png) |

## Built to be yours

| You bring | OwnMail handles |
|---|---|
| A domain you control, or a `nylas.email` subdomain | Inbox creation, sign-in configuration, and deployment setup |
| A Cloudflare, Vercel, or Netlify account — or just your machine | A deployed or local mailbox and calendar app |
| Your next idea | An ejected app codebase when you want to customize the experience |

## Power-user move: eject

OwnMail is deliberately easy to start and straightforward to outgrow. Copy the
app source into a directory you control whenever you want to tune the UI, add a
feature, or choose a different deployment path:

```bash
ownmail eject ./my-ownmail
```

The ejected project includes the deployable app and its local-development
workflow. You stay in charge of the code from there.

## What you need

- Node.js 20+
- A Nylas account
- A Cloudflare, Vercel, or Netlify account if you want hosted deployment
- A domain you control, or a free `nylas.email` subdomain created during setup

## What gets created

1. A Nylas application and API key for your mailbox app
2. A mailbox address, such as `contact@your-domain.com`
3. A generated inbox password, shown once during setup
4. A Cloudflare Workers, Vercel, Netlify, or loopback-only local web app
5. The required callback and app configuration for sign-in

## Keep building

| Command | What it does |
|---|---|
| `ownmail` | Create or resume an OwnMail deployment |
| `ownmail status` | Show your OwnMail projects |
| `ownmail update` | Redeploy the latest app version |
| `ownmail doctor` | Check configuration and repair common issues |
| `ownmail grants` | List inboxes connected to your Nylas app |
| `ownmail eject [dir]` | Copy the app source into a directory you control and customize it freely |
| `ownmail inbox add` | Add another address on your domain |
| `ownmail inbox reset-password [email]` | Reset an inbox password |
| `ownmail rotate-key` | Rotate the API key used by the app |
| `ownmail app-domain mail.example.com` | Serve the app on your own domain |
| `ownmail destroy` | Remove a Cloudflare deployment without deleting mail data |

## What is in the box

| Package | What it contains |
|---|---|
| `packages/cli` (`ownmail`) | The command-line setup and deployment workflow |
| `packages/app` (`@ownmail/app`) | The mailbox and calendar app deployed by the CLI |

## Security and data handling

- OwnMail supports existing Nylas accounts that use email/password (including
  authenticator-code MFA) and browser-based Google, Microsoft, or GitHub sign-in.
  New Nylas accounts are created through the browser flow. Cloudflare setup
  recommends browser OAuth, with a least-privilege API token available as an
  advanced option.
- Hosted app secrets are stored through the selected provider's secret manager.
  Local runtime secrets stay in the OS credential store and are passed only to
  the loopback server process.
- The deployed app resolves the active inbox from the server-side session,
  not from client-provided identifiers.
- Email HTML is rendered in sandboxed frames.
- Do not commit generated secrets, inbox passwords, `.env` files, or exported
  deployment credentials.

## Choose where it runs

`npx ownmail` offers four guided targets:

- **Cloudflare Workers** — Wrangler deploy with KV-backed sessions and realtime
  webhook refresh.
- **Vercel** — prebuilt Node function deploy with settings sent to Vercel over
  stdin.
- **Netlify** — Node function deploy with static assets served from its CDN.
- **Run locally** — production Node build bound only to `localhost`; keep the
  terminal open and press Ctrl+C to stop it.

Vercel, Netlify, and local targets use stateless signed-cookie sessions and
poll for new mail. The CLI registers each resulting callback URL automatically.
Provider CLIs may open a browser the first time you sign in.

## Local development

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
```

Node.js 20+ and pnpm 10+ are required.

### Develop the app UI locally

For fast UI work without Nylas credentials, Cloudflare, or a deploy:

```bash
pnpm --filter @ownmail/app dev:ui
```

Open the printed localhost URL and go to `/mail`. This runs the TanStack Start
app with local in-memory mail, draft, contact, and calendar data.

### Refresh the README screenshots

The checked-in product screenshots come from that same local mock UI. Regenerate
the mail light/dark composite and the calendar and contacts captures with:

```bash
pnpm --filter @ownmail/app capture:readme
```

The local UI mock is intentionally limited to the same grant-scoped Nylas v3
resources the app uses in production:

- Mail: threads, messages, drafts, folders, send with small JSON attachments,
  and attachment downloads.
- Calendar: calendars, events, create/update/delete event, and RSVP.
- Contacts: contact lookup for compose autocomplete.
- Realtime refresh: Nylas webhooks in Cloudflare deployments; local UI mocks,
  Vercel, Netlify, and local deployments fall back to navigation/focus refresh.

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
export OWNMAIL_SITE_NAME="My Mail"
export INBOX_EMAIL="you@example.com"
export TEMPLATE_VERSION="0.1.2"
pnpm --filter @ownmail/app dev:local
```

Register `http://localhost:5173/auth/callback` as a callback URI on the Nylas
application before using `dev:local`.
