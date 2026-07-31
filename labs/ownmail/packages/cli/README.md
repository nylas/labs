# OwnMail

**Launch an inbox on your domain—with one guided command.**

OwnMail creates an email address on a domain you control—or a Nylas-provided
`nylas.email` trial subdomain—and deploys a ready-to-use web app for mail,
calendar, and contacts. Run the app in your Cloudflare, Vercel, or Netlify
account, or on your own machine.

The guided setup handles inbox creation, sign-in configuration, and deployment,
and walks you through DNS when you use your own domain. Nylas hosts the mailbox
service through Agent Accounts; hosted deployments run in your provider
account, and you can export the complete app source whenever you want to
customize it.

![OwnMail's local mock inbox with The Dispatch open, divided diagonally between light and dark modes](https://cdn.jsdelivr.net/npm/ownmail@0.2.0/assets/screenshots/ownmail-mail-modes.png)

## Put your inbox to work

```bash
npx ownmail
```

The setup wizard signs you in, creates an inbox, configures a domain, and
deploys the app. You can safely re-run it to resume an incomplete setup.
Existing Nylas users can sign in with their Nylas email/password (including
authenticator-code MFA), Google, Microsoft, GitHub, or their organization’s
Enterprise SAML provider. Enterprise SAML sign-in uses a work email to discover
the organization, then completes securely in the browser. Account creation
continues through the browser-based provider flow.

Setup proposes the name shown in the app from your email domain—for example,
`acme.nylas.email` becomes **Acme Mail** and `mail.your-company.com` becomes
**Your Company Mail**—and lets you edit it before anything is deployed. For a
non-interactive setup, pass `--site-name "Acme Inbox"`.

## Common commands

```bash
ownmail project status
ownmail app name "Acme Mail"
ownmail app update
ownmail project doctor
ownmail inbox add
ownmail app domain mail.example.com --primary
ownmail app eject
```

Run `ownmail --help` to discover the `app`, `inbox`, `project`, and `auth`
groups, then explore a group with commands such as `ownmail app --help` or
`ownmail project doctor --help`. The earlier flat command names remain available
as compatibility aliases for scripts.

## Customize the app name

Show the configured name (and a domain-derived suggestion for older projects):

```bash
ownmail app name --name acme
```

Change the name and redeploy the recorded Cloudflare, Vercel, Netlify, or local
app:

```bash
ownmail app name "Acme Inbox" --name acme
```

The name is used in the app navigation, sign-in screen, browser title, and
install metadata. It does not rename the CLI project, provider project, worker,
email domain, or inbox address.

## Custom app domains

An app domain is the browser hostname for the hosted mailbox; it is separate
from the email domain used after `@` in mailbox addresses. Attach the canonical
sign-in and realtime-update hostname with:

```bash
ownmail app domain mail.example.com --primary
```

Attach another working sign-in hostname without moving Nylas instant updates:

```bash
ownmail app domain inbox.example.com --secondary
```

OwnMail updates the recorded Cloudflare, Vercel, or Netlify project, registers
the Nylas Connect callback, and reconciles a single Nylas webhook on the primary
domain. If provider DNS verification or TLS is pending, follow the Domain
settings guidance and retry the exact resume command shown by OwnMail. The
previous app URL stays active until promotion completes.

## Eject when you are ready

Want to change the experience, host it differently, or turn it into something
only you would build? Copy the app into a directory you control:

```bash
ownmail app eject ./my-ownmail
```

From there, the source and local-development workflow are yours to shape.

## Requirements

- Node.js 22.12 or later
- A Nylas account
- A Cloudflare, Vercel, or Netlify account for hosted deployment
- A domain you control, or a Nylas-provided `nylas.email` trial subdomain

## Documentation

- [Quickstart](https://github.com/nylas/labs/tree/main/labs/ownmail/docs/quickstart.md)
- [Source repository](https://github.com/nylas/labs/tree/main/labs/ownmail)
- [Changelog](https://github.com/nylas/labs/blob/main/labs/ownmail/packages/cli/CHANGELOG.md)

Do not commit generated passwords, API keys, session secrets, or deployment
credentials. OwnMail stores hosted app secrets with the selected provider and
keeps local runtime secrets in the OS credential store.

## License

[MIT](https://github.com/nylas/labs/blob/main/LICENSE)
