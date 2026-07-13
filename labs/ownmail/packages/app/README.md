# @ownmail/app

The deployable mailbox and calendar app behind
[OwnMail](https://www.npmjs.com/package/ownmail). It runs on Cloudflare Workers
and is powered by Nylas Agent Accounts.

This is the power-user half of OwnMail: a real app codebase for people who want
their inbox to look, behave, and deploy their way.

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
pnpm --filter @ownmail/app dev:ui
```

That gives you a local mailbox and calendar UI with mock data, without Nylas
credentials, Cloudflare, or a deployment. When you are ready to use real data,
switch to the local integration flow below.

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
