# OwnMail

**Your inbox. Your domain. No per-seat fees.**

OwnMail provisions and deploys a mailbox and calendar app to your Cloudflare
account, powered by Nylas Agent Accounts.

## Get started

```bash
npx ownmail
```

The setup wizard signs you in, creates an inbox, configures a domain, and
deploys the app. You can safely re-run it to resume an incomplete setup.

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

## Requirements

- Node.js 20 or later
- A Nylas account
- A Cloudflare account
- A domain you control, or a free `nylas.email` subdomain created during setup

## Documentation

- [Quickstart](https://github.com/nylas/labs/tree/main/labs/ownmail/docs/quickstart.md)
- [Source repository](https://github.com/nylas/labs/tree/main/labs/ownmail)

Do not commit generated passwords, API keys, session secrets, or deployment
credentials. OwnMail stores deployed app secrets in Cloudflare Worker secrets.

## License

[MIT](https://github.com/nylas/labs/blob/main/LICENSE)
