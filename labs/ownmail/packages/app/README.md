# @ownmail/app

The deployable mailbox and calendar app behind
[OwnMail](https://www.npmjs.com/package/ownmail). It runs on Cloudflare Workers
and is powered by Nylas Agent Accounts.

This is the power-user half of OwnMail: a real app codebase for people who want
their inbox to look, behave, and deploy their way.

![OwnMail's local mock inbox with The Dispatch open, divided diagonally between light and dark modes](https://raw.githubusercontent.com/nylas/labs/main/labs/ownmail/assets/screenshots/ownmail-mail-modes.png)

Most people should start with the CLI:

```bash
npx ownmail
```

The CLI provisions the required Nylas and Cloudflare resources, then deploys
this app. Reach for this package directly when you want to develop, customize,
or host an ejected OwnMail app yourself.

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
