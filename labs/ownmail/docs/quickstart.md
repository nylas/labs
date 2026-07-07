# OwnMail quickstart

## What you need

- Node.js 20+ (`node -v`)
- A Google, Microsoft, or GitHub account (to create your free Nylas account)
- A Cloudflare account (free tier — created during setup if you don't have one)

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
4. **Connect Cloudflare** — browser OAuth via wrangler; no tokens to paste.
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

## Free plan limits

200 sends/day per inbox, 3 GB storage per organization, 50 MB per message,
10 attachments per message. The app shows a friendly banner if you hit one.
