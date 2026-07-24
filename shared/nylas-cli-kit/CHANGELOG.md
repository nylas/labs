# @nylas-labs/cli-kit

## 0.6.0

### Minor Changes

- 2e40eb4: Add provider-aware primary and additional custom app domains with resumable Nylas webhook reconciliation.

## 0.5.1

### Patch Changes

- e128a6d: Make OwnMail CLI failures actionable and include upstream request IDs when available.

## 0.5.0

### Minor Changes

- 7cd3ca4: Allow users to download the original raw email for an individual message.

## 0.4.0

### Minor Changes

- f82cdc4: Fix OwnMail email rendering, account switcher layout, and persistent account display names.

## 0.3.0

### Minor Changes

- 1290aaf: Support webhook-driven instant updates on Vercel with automatically provisioned shared storage and secure webhook-secret rotation.

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
