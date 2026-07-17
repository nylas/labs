# @ownmail/app

The deployable mailbox and calendar app behind
[OwnMail](https://www.npmjs.com/package/ownmail). It runs on Cloudflare Workers,
Vercel, Netlify, or a local Node server and is powered by Nylas Agent Accounts.

This is the power-user half of OwnMail: a real app codebase for people who want
their inbox to look, behave, and deploy their way.

![OwnMail's local mock inbox with The Dispatch open, divided diagonally between light and dark modes](https://cdn.jsdelivr.net/npm/ownmail@0.2.0/assets/screenshots/ownmail-mail-modes.png)

Most people should start with the CLI:

```bash
npx ownmail
```

The CLI provisions the required Nylas resources, configures the chosen runtime,
then deploys or starts this app. Reach for this package directly when you want
to develop, customize, or host an ejected OwnMail app yourself.

Shared storage is optional on every runtime. Without it, sessions and OAuth state
use HMAC-signed cookies and mailbox refresh falls back to polling. Cloudflare can
use a bound KV namespace; guided Vercel deployments can use an Upstash Redis
resource connected through the third-party Vercel Marketplace. Other Node
deployments can opt in by setting `OWNMAIL_SHARED_STORAGE=enabled` together with
`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.

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
