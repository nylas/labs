# OwnMail quickstart

## What you need

- Node.js 22.12+ (`node -v`)
- A Nylas account, an organization with Enterprise SAML configured, or a
  Google, Microsoft, or GitHub account to create one
- A Cloudflare, Vercel, or Netlify account for hosted deployment; no provider
  account is needed to run locally

## Create your inbox + app

Run the setup wizard directly from npm:

```bash
npx ownmail
```

The wizard walks you through everything:

1. **Sign in to Nylas** — use your existing Nylas email/password or approve a
   Google, Microsoft, GitHub, or Enterprise SAML browser sign-in.
   Authenticator-code MFA is supported. Enterprise SAML asks for your work
   email to find your organization. New here? Pick "create one (free)" and use
   the Google, Microsoft, or GitHub browser flow.
2. **Choose hosting** — Cloudflare Workers, Vercel, Netlify, or a loopback-only
   local web server. The hosted options guide you through provider sign-in.
3. **Pick your address** — a Nylas-provided `you.nylas.email` trial subdomain
   (instant), or your own domain (you'll add a few DNS records; the wizard waits
   and verifies).
4. **Name your app** — accept the friendly name inferred from the domain (for
   example, `you.nylas.email` becomes **You Mail**) or enter your own.
5. **Name your inbox** — e.g. `contact@you.nylas.email`, and save the
   generated password (shown exactly once).
6. Done — the CLI reports the hosted URL or `http://localhost:<port>`.

Log in with your inbox email + password. That's it.

## Everyday commands

| Command | What it does |
|---|---|
| `ownmail` | Create — or resume — a project (safe to re-run any time) |
| `ownmail app name [name]` | Show or change the name displayed in the app |
| `ownmail app update` | Redeploy with the latest app version (settings survive) |
| `ownmail app eject [dir]` | Get the full source code and own it from there |
| `ownmail project status` | Show your projects |
| `ownmail project doctor` | Health-check everything and fix what it can |
| `ownmail inbox list` | List the inboxes on your Nylas app |
| `ownmail inbox add` | Add another address on your domain (up to 5 on sandbox) |
| `ownmail inbox reset-password [email]` | Reset an inbox password |
| `ownmail auth rotate-key` | Rotate the API key your app uses, zero downtime |
| `ownmail app domain mail.you.com --primary` | Attach a primary app domain to Cloudflare, Vercel, or Netlify |
| `ownmail app destroy` | Delete a Cloudflare deployment (mail and inbox are kept) |

Use `ownmail --help` to see command groups and `ownmail app --help`,
`ownmail inbox --help`, `ownmail project --help`, or `ownmail auth --help` to
explore a group. Existing flat command names remain available for compatibility.

OwnMail deployment API keys expire after one year. The CLI keeps the installed
key only in your OS credential store, validates it when setup is resumed, and
reuses it while it is active with more than 30 days remaining. When rotation is
needed, OwnMail installs the replacement before revoking the previous key.
One-off diagnostic keys expire after one day. You can rotate early with
`ownmail auth rotate-key`.

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
  terminal open; press Ctrl+C to stop it. Run `npx ownmail app update` after it has
  stopped to restart on the latest version.

Netlify and local mode use stateless signed-cookie sessions and refresh on
navigation, focus, and a low-frequency active-query fallback. Sessions last 14
days. On Cloudflare and Upstash-backed Vercel that window *slides*: it moves
forward while you keep using the app, so an active mailbox stays signed in.
Stateless targets have no server-side record to revoke, so a refreshed cookie
could outlive a sign-out — they keep a fixed 14-day window running from the last
sign-in instead. Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` on a
Netlify or local deployment to get sliding sessions there too. OwnMail stores
hosted settings with the provider and keeps local runtime secrets in the OS
credential store. Callback URIs and Nylas webhooks are registered automatically
after the deployment URL is known.

## Add a custom app domain

Your email domain and app domain serve different purposes. The email domain is
the part after `@` in the hosted mailbox address. The app domain is the browser
hostname. One app domain is primary: OwnMail uses it for sign-in, status, and
the single Nylas realtime webhook. Additional app domains do not create
duplicate event deliveries.

Make a hostname primary:

```bash
ownmail app domain mail.example.com --primary
```

Or attach another hostname while keeping the current primary:

```bash
ownmail app domain inbox.example.com --secondary
```

OwnMail updates the recorded Cloudflare, Vercel, or Netlify project, waits for
HTTPS, registers the login callback, and reconciles the primary Nylas webhook.
The provider URL remains available as a fallback. If DNS or TLS is still
provisioning, check the recorded provider project's Domain settings for required
DNS records or verification, then retry the exact command OwnMail prints.
OwnMail resumes the pending setup without creating duplicate routes or webhooks.

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
