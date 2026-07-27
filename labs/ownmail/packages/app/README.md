# @ownmail/app

The ready-to-use mail, calendar, and contacts web app behind
[OwnMail](https://www.npmjs.com/package/ownmail). OwnMail creates an email
address on a domain you control—or a Nylas-provided `nylas.email` trial
subdomain—then deploys this app to your Cloudflare, Vercel, or Netlify account,
or runs it on a local Node server. Nylas hosts the mailbox service through
Agent Accounts.

This is the customizable half of OwnMail: a complete app codebase for
developers who want their inbox to look, behave, and deploy their way.

![OwnMail's local mock inbox with The Dispatch open, divided diagonally between light and dark modes](https://cdn.jsdelivr.net/npm/ownmail@0.2.0/assets/screenshots/ownmail-mail-modes.png)

Most people should start with the CLI:

```bash
npx ownmail
```

The CLI provisions the required Nylas resources, configures the chosen runtime,
then deploys or starts this app. Reach for this package directly when you want
to develop, customize, or host an ejected OwnMail app yourself.

Cloudflare uses its bound KV namespace for sessions and realtime counters.
Guided Vercel deployments use an Upstash Redis resource connected through the
Vercel Marketplace. Other Node deployments remain stateless unless both
`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are configured.

Sign-in uses `@nylas/connect` to start the authorization flow. OwnMail exchanges
the callback code and stores the verified grant in its server-owned session, so
API credentials and bearer tokens are never persisted in browser storage.

## Start simple, then take control

```bash
ownmail eject ./my-ownmail
cd my-ownmail
pnpm install
pnpm dev
```

That starts the ejected project's own development server. Configure the
environment values in `.env.example` before exercising the real Nylas flow.
The repository-only mock UI is available from the repository root below.

## Documentation

- [OwnMail quickstart](https://github.com/nylas/labs/tree/main/labs/ownmail/docs/quickstart.md)
- [Source and local-development guidance](https://github.com/nylas/labs/tree/main/labs/ownmail#local-development)
- [Changelog](https://github.com/nylas/labs/blob/main/labs/ownmail/packages/app/CHANGELOG.md)

## Local development

From the repository root, start the UI with local mock data:

```bash
pnpm --filter @ownmail/app dev:ui
```

For a real Nylas integration, configure the environment variables documented
in the quickstart and run:

```bash
pnpm --filter @ownmail/app dev:local
```

Do not commit credentials or deployment secrets. Production secrets belong in
your hosting provider's secret manager.

## License

[MIT](https://github.com/nylas/labs/blob/main/LICENSE)
