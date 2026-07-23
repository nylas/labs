# OwnMail quickstart

## What you need

- Node.js 20.12+ (`node -v`)
- A Nylas account, or a Google, Microsoft, or GitHub account to create one
- A Cloudflare, Vercel, or Netlify account for hosted deployment; no provider
  account is needed to run locally

## Create your inbox + app

Run the setup wizard directly from npm:

```bash
npx ownmail
```

The wizard walks you through everything:

1. **Sign in to Nylas** — use your existing Nylas email/password or approve a
   Google, Microsoft, or GitHub browser sign-in. Authenticator-code MFA is
   supported. New here? Pick "create one (free)" and use the browser flow.
2. **Pick your address** — a free `you.nylas.email` subdomain (instant), or
   your own domain (you'll add a few DNS records; the wizard waits and verifies).
3. **Name your inbox** — e.g. `contact@you.nylas.email`, and save the
   generated password (shown exactly once).
4. **Choose hosting** — Cloudflare Workers, Vercel, Netlify, or a loopback-only
   local web server. The hosted options guide you through provider sign-in.
5. Done — the CLI reports the hosted URL or `http://localhost:<port>`.

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
| `ownmail destroy` | Delete a Cloudflare deployment (mail and inbox are kept) |

## Mail apps (IMAP/SMTP)

Your inbox also works in Apple Mail, Outlook, or Thunderbird:

- IMAP: `imap.nylas.email`, port 993 (SSL)
- SMTP: `smtp.nylas.email`, port 465 (SSL) or 587 (STARTTLS)
- Username: your inbox email · Password: your inbox password

## Hosting choices

The wizard automates all supported targets:

- Cloudflare uses Workers plus KV-backed sessions and supports webhook-driven
  instant updates.
- Vercel deploys the bundled Build Output API target and provisions a free
  Upstash Redis resource for durable sessions and webhook-driven instant updates.
- Netlify deploys static client assets plus a Node fetch function.
- Local mode starts the same production Node build on loopback. Keep that
  terminal open; press Ctrl+C to stop it. Run `npx ownmail update` after it has
  stopped to restart on the latest version.

Netlify and local mode use stateless signed-cookie sessions and refresh on
navigation/focus. OwnMail stores hosted settings with the provider and keeps
local runtime secrets in the OS credential store. Callback URIs and Nylas
webhooks are registered automatically after the deployment URL is known.

## Local UI development

To work on the OwnMail UI without deploying or configuring real accounts:

```bash
pnpm --filter @ownmail/app dev:ui
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
pnpm --filter @ownmail/app dev:local
```

Add `http://localhost:5173/auth/callback` to the Nylas application's callback
URIs first.

Set `OWNMAIL_SITE_NAME` to customize the user-facing name shown in the browser
title, sign-in screen, and app navigation. It is optional and defaults to
`ownmail`; `APP_NAME` remains the deployment/project identifier.

## Free plan limits

200 sends/day per inbox, 3 GB storage per organization, 50 MB per message,
10 attachments per message. The app shows a friendly banner if you hit one.
