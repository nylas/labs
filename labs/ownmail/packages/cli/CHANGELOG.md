# ownmail

## 0.6.2

### Patch Changes

- Updated dependencies [f82cdc4]
  - @nylas-labs/cli-kit@0.4.0

## 0.6.1

## 0.6.0

## 0.5.2

## 0.5.1

### Patch Changes

- 6318d8c: Fix custom-domain verification to reconcile dashboard status and let users choose, pause, or manually retry polling.
- d072fce: Make first-time `npx ownmail` startup fast by bundling the prebuilt app and downloading only the selected hosting provider CLI.

## 0.5.0

### Minor Changes

- 1290aaf: Support webhook-driven instant updates on Vercel with automatically provisioned shared storage and secure webhook-secret rotation.

### Patch Changes

- Updated dependencies [1290aaf]
  - @ownmail/app@0.5.0
  - @nylas-labs/cli-kit@0.3.0

## 0.4.1

### Patch Changes

- 4590337: Require project names in create setup, support scoped and non-blocking Vercel deployments with actionable provider errors, and produce self-contained Vercel functions.
- Updated dependencies [4590337]
  - @ownmail/app@0.4.1

## 0.4.0

### Minor Changes

- 55cf480: Add guided Vercel and Netlify deployments plus a loopback-only local web server to OwnMail.

### Patch Changes

- d7c2bfa: Attribute OwnMail API requests with a fixed, non-identifying User-Agent so usage can be tracked in Coralogix.
- f5f098d: Keep the OwnMail setup header compact in small terminals while retaining a polished full-size introduction.
- Updated dependencies [d7c2bfa]
- Updated dependencies [55cf480]
  - @ownmail/app@0.4.0
  - @nylas-labs/cli-kit@0.2.2

## 0.3.3

### Patch Changes

- bb1eecb: Add secure Nylas email/password and authenticator-code login to OwnMail.
- Updated dependencies [b3b0f23]
- Updated dependencies [bb1eecb]
  - @ownmail/app@0.3.3
  - @nylas-labs/cli-kit@0.2.1

## 0.3.2

### Patch Changes

- Updated dependencies [eba0543]
  - @ownmail/app@0.3.2

## 0.3.1

### Patch Changes

- b5cec5d: Show actionable recovery guidance when a local project is missing its organization state, and use a compact setup header that remains readable in narrow terminals.
  - @ownmail/app@0.3.1

## 0.3.0

### Patch Changes

- c6ba659: Show actionable recovery guidance when a local project is missing its organization state, and use a compact setup header that remains readable in narrow terminals.
- Updated dependencies [c6ba659]
- Updated dependencies [c6ba659]
- Updated dependencies [c6ba659]
  - @ownmail/app@0.3.0

## 0.2.2

### Patch Changes

- 70c64e2: Improve recovery guidance for OwnMail CLI errors.
- 70c64e2: Keep Cloudflare unknown-state recovery guidance visible in CLI errors.
- 70c64e2: Improve actionable CLI error recovery and deployment safety.
- 70c64e2: Preserve a newly created API key when Cloudflare cannot confirm a key rotation, and provide safe reconciliation guidance.
- 70c64e2: Keep actionable deployment and custom-domain validation guidance in CLI errors.
- 626fadd: Preserve actionable no-change Cloudflare recovery during API-key rotation and clean up the unused new key.
- Updated dependencies [70c64e2]
- Updated dependencies [b6933fc]
  - @ownmail/app@0.2.2

## 0.2.1

### Patch Changes

- 3456e01: Make Cloudflare deployment failures safe to recover from in OwnMail.
- 3456e01: Improve sign-in error handling in the OwnMail app and provisioning flow.
- 3456e01: Validate OwnMail CLI project-state boundaries before using saved state.
- 3456e01: Harden OwnMail security and input validation boundaries.
- Updated dependencies [3456e01]
- Updated dependencies [3456e01]
- Updated dependencies [3456e01]
- Updated dependencies [3456e01]
  - @ownmail/app@0.2.1

## 0.2.0

### Minor Changes

- 5da771a: Explain the OwnMail setup journey before the first prompt and show stable,
  user-facing progress and resume phases throughout provisioning.
- e313840: Initial release: `npx ownmail` deploys a full mailbox + calendar app on your own
  domain, powered by Nylas Agent Accounts. Resumable provisioning (Nylas SSO device
  flow, sandbox app, free or custom domain, inbox with app password), Cloudflare
  Workers deploy, hosted-auth login with PKCE, Gmail-style mail (threads, compose,
  drafts, search, attachments, folders), calendar (month/week/day, events, RSVP),
  webhook-backed near-realtime updates, and update/eject/doctor/destroy commands.
- fdf0e16: Collect and confirm hosting and email-domain choices, and verify provider access,
  before creating durable OwnMail resources. Existing partial projects continue to
  resume without migration loss.

### Patch Changes

- af1d6bf: Make `status` and `doctor` more actionable: status now shows human-readable project state and JSON output, while doctor is read-only by default and gates redirect repairs behind `--fix`.
- 7245f6f: Recommend browser-based Wrangler OAuth during Cloudflare setup while retaining
  least-privilege API tokens as a clearly explained advanced option.
- db67a7a: Add `ownmail delete` to remove local project records, with `--hosted` for explicit Cloudflare hosted app cleanup.
- 876016c: Prevent the temporary `ownmail login` auth context from appearing as a `__login__` project in project pickers.
- 78703af: Add package-level npm READMEs for the OwnMail CLI and deployed app, and update
  the fixed release group for the renamed app package.
- 6d2d45c: Store pending setup secrets in the OS keyring when available, require inbox-password acknowledgement, add a pending-secret cleanup command, and improve the completion screen with login, recovery, and IMAP/SMTP guidance.
- 3b17d02: Serve the package README screenshot from the public npm CDN instead of the
  private source repository.
- 6491cc5: Fix the clean-checkout build instructions, expose the CLI package version, add
  package discovery metadata, and verify packed installation in CI.
- 0239170: Register OwnMail realtime webhooks only after the deployed app is reachable, and let `ownmail doctor --fix` retry webhook setup later.

  Fix Nylas v3 webhook creation to send the documented `webhook_url` field while still recognizing existing webhook responses that expose `callback_url`.

- cb94008: Skip webhook setup locally when no public HTTPS app URL is recorded, avoiding low-level Nylas empty webhook URL errors.
- Updated dependencies [e313840]
- Updated dependencies [78703af]
- Updated dependencies [3b17d02]
- Updated dependencies [0239170]
  - @ownmail/app@0.2.0
  - @nylas-labs/cli-kit@0.2.0
