<img src="./assets/backoffice-banner.svg" alt="Nylas Backoffice — operations for every workspace" width="100%" />

# Nylas Backoffice

Nylas Backoffice is an internal operations workspace for inspecting and managing
the accounts, integrations, and workflows that power Nylas products. This
repository contains the project source, shared tooling, and supporting labs.

## Current Projects

| Project | Description | Stage |
|---|---|---|
| [OwnMail](./labs/ownmail) | Launch an inbox on your domain with an app and source you control | Experiment |

## Launch an inbox on your domain

With one guided command, OwnMail creates an email address and a ready-to-use web
app for mail, calendar, and contacts. Use a domain you control or a
Nylas-provided `nylas.email` trial subdomain, then deploy the app to your
Cloudflare, Vercel, or Netlify account—or run it locally.

Nylas hosts the mailbox service through Agent Accounts. Hosted deployments run
in your provider account, and you can export the complete app source whenever
you are ready to customize it.

Start from your terminal:

```bash
npx ownmail
```

<img src="./labs/ownmail/assets/screenshots/ownmail-mail-modes.png" alt="OwnMail's local mock inbox with The Dispatch open, divided diagonally between light and dark modes" width="100%" />

See the [OwnMail quickstart](./labs/ownmail/docs/quickstart.md) for the setup
flow, commands, and the power-user `eject` path.

## Repository Layout

```text
shared/            Shared packages used by projects in this repository
labs/<name>/       Individual project source, packages, docs, and README
```

## Get Involved

- Try a project and [start a discussion](https://github.com/nylas/labs/discussions)
- File bugs with the [issue templates](https://github.com/nylas/labs/issues/new/choose)
- Contribute through [CONTRIBUTING.md](./CONTRIBUTING.md)

Labs are experimental and may change without notice. Community feedback helps
decide which ideas continue to develop.

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
```

Node.js 22.18+ (22.x) or 24.11+, and pnpm 11+ are required.

## Security

Never commit API keys, inbox passwords, session secrets, `.env` files, or other
credentials. Keep deployment secrets in your hosting provider's secret manager
or environment variable system.

## License

[MIT](./LICENSE)
