# OwnMail quickstart

## What you need

- Node.js 20+ (`node -v`)
- A Google, Microsoft, or GitHub account (to create your free Nylas account)
- A Cloudflare account (you can create one during browser sign-in)

## Create your inbox + app

From this repository:

```bash
pnpm install
pnpm --filter ownmail build
node labs/ownmail/packages/cli/dist/index.js
```

If the CLI is installed from npm, run:

```bash
npx ownmail
```

The wizard walks you through everything:

1. **Sign in to Nylas** — your browser opens; approve and come back. New here?
   Pick "create one (free)".
2. **Pick your address** — a free `you.nylas.email` subdomain (instant), or
   your own domain (you'll add a few DNS records; the wizard waits and verifies).
3. **Name your inbox** — e.g. `contact@you.nylas.email`, and save the
   generated password (shown exactly once).
4. **Connect Cloudflare** — recommended browser OAuth via Wrangler; no tokens
   to paste. A least-privilege API token is available as an advanced option.
5. Done — your mailbox app is live at `https://<name>-ownmail.<account>.workers.dev`.

Log in with your inbox email + password. That's it.

## Everyday commands

| Command | What it does |
|---|---|
| `ownmail` | Create — or resume — a project (safe to re-run any time) |
| `ownmail status` | Show your projects |
| `ownmail update` | Redeploy with the latest app version (settings survive) |
| `ownmail doctor` | Health-check everything and fix what it can |
| `ownmail grants` | List the inboxes on your Nylas app |
| `ownmail eject [dir]` | Get the full source code and own it from there |
| `ownmail inbox add` | Add another address on your domain (up to 5 on sandbox) |
| `ownmail inbox reset-password [email]` | Reset an inbox password |
| `ownmail rotate-key` | Rotate the API key your app uses, zero downtime |
| `ownmail app-domain mail.you.com` | Serve the app on your own domain (zone on your Cloudflare) |
| `ownmail destroy` | Delete the deployed app (mail and inbox are kept) |

When running from source, replace `ownmail` with
`node labs/ownmail/packages/cli/dist/index.js`.

## Mail apps (IMAP/SMTP)

Your inbox also works in Apple Mail, Outlook, or Thunderbird:

- IMAP: `imap.nylas.email`, port 993 (SSL)
- SMTP: `smtp.nylas.email`, port 465 (SSL) or 587 (STARTTLS)
- Username: your inbox email · Password: your inbox password

## Deploying to Vercel instead

The template ships a Vercel build target. From an ejected project (or the
template source):

```bash
pnpm build:vercel          # produces .vercel/output (Build Output API v3)
vercel deploy --prebuilt   # deploy with the Vercel CLI
```

Set the env vars from `template.json` (`NYLAS_API_KEY`, `SESSION_SECRET`,
`NYLAS_CLIENT_ID`, `NYLAS_REGION`, `APP_NAME`, `INBOX_EMAIL`) in the Vercel
project. On Vercel the app runs with **stateless signed-cookie sessions** (no
KV needed); webhook-driven instant updates are a Cloudflare-only feature —
Vercel deployments refresh on navigation/focus instead. Register
`https://<your-app>.vercel.app/auth/callback` as a callback URI on your Nylas
application (`npx ownmail doctor` can do this once the URL exists).

## Local UI development

To work on the OwnMail UI without deploying or configuring real accounts:

```bash
pnpm --filter @ownmail/template dev:ui
```

This starts the app locally with in-memory mock mail and calendar data.

The mock mailbox mirrors only the Nylas v3 resources OwnMail actually calls:
mail threads/messages/drafts/folders/send with small JSON attachments/attachment
downloads, calendar calendars/events/RSVP, contact lookup for compose
autocomplete, and the Cloudflare webhook refresh model. For anything outside
that wired surface, such as free/busy, availability, scheduling, notetaker,
templates, or workflows, use a real local integration pass before wiring the UI.

For a local real-integration pass, export `SESSION_SECRET`, `NYLAS_API_KEY`,
`NYLAS_CLIENT_ID`, `NYLAS_REGION`, `APP_NAME`, `INBOX_EMAIL`, and
`TEMPLATE_VERSION`, then run:

```bash
pnpm --filter @ownmail/template dev:local
```

Add `http://localhost:5173/auth/callback` to the Nylas application's callback
URIs first.

## Free plan limits

200 sends/day per inbox, 3 GB storage per organization, 50 MB per message,
10 attachments per message. The app shows a friendly banner if you hit one.
