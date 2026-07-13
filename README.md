<img src="./assets/banner.svg" alt="Nylas Labs — tomorrow's products, shipped in public" width="100%" />

# Nylas Labs

Nylas Labs contains experimental, open-source projects built on Nylas APIs.
Projects in this repository are intended for developers and customers who want
to try early ideas, inspect the code, and adapt the examples for their own use.

## Current Projects

| Project | Description | Stage |
|---|---|---|
| [OwnMail](./labs/ownmail) | Deploy a mailbox and calendar app on your own domain, powered by Nylas Agent Accounts | Experiment |

## Try OwnMail

Start the setup flow directly from npm:

```bash
npx ownmail
```

See the [OwnMail quickstart](./labs/ownmail/docs/quickstart.md) for the full
setup flow and command reference.

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

Node.js 20+ and pnpm 10+ are required.

## Security

Never commit API keys, inbox passwords, session secrets, `.env` files, or other
credentials. Keep deployment secrets in your hosting provider's secret manager
or environment variable system.

## License

[MIT](./LICENSE)
