# @nylas-labs/cli-kit

## 0.2.2

### Patch Changes

- d7c2bfa: Attribute OwnMail API requests with a fixed, non-identifying User-Agent so usage can be tracked in Coralogix.

## 0.2.1

### Patch Changes

- bb1eecb: Add secure Nylas email/password and authenticator-code login to OwnMail.

## 0.2.0

### Minor Changes

- e313840: Initial release: `npx ownmail` deploys a full mailbox + calendar app on your own
  domain, powered by Nylas Agent Accounts. Resumable provisioning (Nylas SSO device
  flow, sandbox app, free or custom domain, inbox with app password), Cloudflare
  Workers deploy, hosted-auth login with PKCE, Gmail-style mail (threads, compose,
  drafts, search, attachments, folders), calendar (month/week/day, events, RSVP),
  webhook-backed near-realtime updates, and update/eject/doctor/destroy commands.

### Patch Changes

- 0239170: Register OwnMail realtime webhooks only after the deployed app is reachable, and let `ownmail doctor --fix` retry webhook setup later.

  Fix Nylas v3 webhook creation to send the documented `webhook_url` field while still recognizing existing webhook responses that expose `callback_url`.
