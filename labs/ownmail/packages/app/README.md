# @ownmail/app

The deployable mailbox and calendar app used by [OwnMail](https://www.npmjs.com/package/ownmail).
It runs on Cloudflare Workers and is powered by Nylas Agent Accounts.

Most people should start with the CLI:

```bash
npx ownmail
```

The CLI provisions the required Nylas and Cloudflare resources, then deploys
this app. You only need this package directly when you want to develop or
eject the app source.

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
