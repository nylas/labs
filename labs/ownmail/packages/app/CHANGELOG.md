# @ownmail/app

## 0.9.0

### Minor Changes

- 2e40eb4: Add provider-aware primary and additional custom app domains with resumable Nylas webhook reconciliation.

### Patch Changes

- Updated dependencies [2e40eb4]
  - @nylas-labs/cli-kit@0.6.0

## 0.8.0

### Patch Changes

- 03f5231: Clarify OwnMail positioning across public package copy and the CLI setup experience.
- ec0cee0: Upgrade runtime and deployment dependencies to their latest stable releases, including TypeScript 7 compatibility.

## 0.7.5

### Patch Changes

- 196bd02: Surface the OwnMail release version in Settings and include it in Nylas request User-Agent attribution.

## 0.7.4

### Patch Changes

- 8a424ec: Add an account setting for automatic HTML email dark mode.
- 4fe6289: Let expanded email content use the full thread width.
- b43b82e: Limit star loading feedback to the star toolbar control.

## 0.7.3

### Patch Changes

- a0e728f: Keep the create-event composer and its actions within the available viewport height.

## 0.7.2

### Patch Changes

- Updated dependencies [e128a6d]
  - @nylas-labs/cli-kit@0.5.1

## 0.7.1

### Patch Changes

- ed5de4c: Keep shadcn component generation aligned with OwnMail's shared UI paths in source exports.

## 0.7.0

### Minor Changes

- 7cd3ca4: Allow users to download the original raw email for an individual message.

### Patch Changes

- Updated dependencies [7cd3ca4]
  - @nylas-labs/cli-kit@0.5.0

## 0.6.2

### Patch Changes

- f82cdc4: Fix OwnMail email rendering, account switcher layout, and persistent account display names.
- Updated dependencies [f82cdc4]
  - @nylas-labs/cli-kit@0.4.0

## 0.6.1

### Patch Changes

- 1072c27: Prevent Cloudflare-backed inbox session rotations from failing during the final minute.

## 0.6.0

### Minor Changes

- 4a23d91: Support securely adding and switching between multiple verified inboxes.

### Patch Changes

- 0028cf6: Keep server-state refreshes scoped to changed domains and start version polling after in-app navigation.
- 2d37aef: Give light-mode email threads a neutral background while preserving contrast for nested sender and attachment affordances.
- 6ebd49e: Render saved OwnMail Markdown drafts as their final formatted HTML in the reading preview.
- c3b0923: Align folder-thread overflow fades with the muted conversation surface while preserving other scroll areas and dark mode.

## 0.5.2

### Patch Changes

- e73437b: Keep mail, contact, and calendar state synchronized after optimistic and server-side changes.

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
