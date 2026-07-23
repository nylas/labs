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
authenticator-code MFA) or with Google, Microsoft, or GitHub. Account creation
continues through the browser-based provider flow.

## Common commands

```bash
ownmail status
ownmail update
ownmail doctor
ownmail inbox add
ownmail eject
```

Run `ownmail --help` or `ownmail <command> --help` for the complete command
reference.

## Eject when you are ready

Want to change the experience, host it differently, or turn it into something
only you would build? Copy the app into a directory you control:

```bash
ownmail eject ./my-ownmail
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
