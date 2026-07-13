# OwnMail

**Email that answers to you.**

OwnMail helps independent builders put a mailbox and calendar app on a domain
they control. It provisions and deploys the app to your Cloudflare account,
powered by Nylas Agent Accounts.

Start with the guided path. Eject to the source when you want the power-user
path.

![OwnMail's local mock inbox, with folders, message list, search, and compose controls](https://raw.githubusercontent.com/nylas/labs/main/labs/ownmail/assets/screenshots/ownmail-inbox.png)

## Put your inbox to work

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

## Eject when you are ready

Want to change the experience, host it differently, or turn it into something
only you would build? Copy the app into a directory you control:

```bash
ownmail eject ./my-ownmail
```

From there, the source and local-development workflow are yours to shape.

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
