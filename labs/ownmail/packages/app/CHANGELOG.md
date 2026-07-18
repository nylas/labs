# @ownmail/app

## 0.5.1

### Patch Changes

- d072fce: Make first-time `npx ownmail` startup fast by bundling the prebuilt app and downloading only the selected hosting provider CLI.

## 0.5.0

### Minor Changes

- 1290aaf: Support webhook-driven instant updates on Vercel with automatically provisioned shared storage and secure webhook-secret rotation.

### Patch Changes

- Updated dependencies [1290aaf]
  - @nylas-labs/cli-kit@0.3.0

## 0.4.1

### Patch Changes

- 4590337: Require project names in create setup, support scoped and non-blocking Vercel deployments with actionable provider errors, and produce self-contained Vercel functions.

## 0.4.0

### Minor Changes

- 55cf480: Add guided Vercel and Netlify deployments plus a loopback-only local web server to OwnMail.

### Patch Changes

- d7c2bfa: Attribute OwnMail API requests with a fixed, non-identifying User-Agent so usage can be tracked in Coralogix.
- Updated dependencies [d7c2bfa]
  - @nylas-labs/cli-kit@0.2.2

## 0.3.3

### Patch Changes

- b3b0f23: Show contextual scroll indicators in thread lists and reveal the scrollbar while scrolling.
- Updated dependencies [bb1eecb]
  - @nylas-labs/cli-kit@0.2.1

## 0.3.2

### Patch Changes

- eba0543: Fix mobile calendar controls, navigation, and input layouts.

## 0.3.1

## 0.3.0

### Minor Changes

- c6ba659: Add flexible event scheduling, all-day events, live calendar previews, conflict warnings, and recurring events.
- c6ba659: Add configurable deployment branding for document titles, navigation, and sign-in.

### Patch Changes

- c6ba659: Add account settings, timezone preferences, and compose and mail interaction fixes.

## 0.2.2

### Patch Changes

- 70c64e2: Fix contacts empty state and PWA metadata.
- b6933fc: Add actionable OwnMail app recovery messages and prevent malformed provider lists from crashing views.

## 0.2.1

### Patch Changes

- 3456e01: Improve sign-in error handling in the OwnMail app and provisioning flow.
- 3456e01: Prevent stale recipient autocomplete suggestions in OwnMail.
- 3456e01: Harden OwnMail security and input validation boundaries.
- 3456e01: Restore keyboard navigation in OwnMail mail threads.

## 0.2.0

### Minor Changes

- e313840: Initial release: `npx ownmail` deploys a full mailbox + calendar app on your own
  domain, powered by Nylas Agent Accounts. Resumable provisioning (Nylas SSO device
  flow, sandbox app, free or custom domain, inbox with app password), Cloudflare
  Workers deploy, hosted-auth login with PKCE, Gmail-style mail (threads, compose,
  drafts, search, attachments, folders), calendar (month/week/day, events, RSVP),
  webhook-backed near-realtime updates, and update/eject/doctor/destroy commands.

### Patch Changes

- 78703af: Add package-level npm READMEs for the OwnMail CLI and deployed app, and update
  the fixed release group for the renamed app package.
- 3b17d02: Serve the package README screenshot from the public npm CDN instead of the
  private source repository.
- Updated dependencies [e313840]
- Updated dependencies [0239170]
  - @nylas-labs/cli-kit@0.2.0
