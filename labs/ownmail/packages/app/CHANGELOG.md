# @ownmail/app

## 0.12.1

### Patch Changes

- 97e7c08: Fix sign-in failing on every attempt with "could not reach the Nylas connect endpoint". The server-side credential POST asked for `redirect: 'error'`, which Cloudflare's workerd runtime rejects when the request is constructed — before any network call — so the error looked like a provider outage rather than a runtime rejection. The request now uses `redirect: 'manual'`, which hands a redirect back unfollowed for the existing status check to reject, so credentials are still never replayed at a redirect target.

## 0.12.0

### Minor Changes

- 0f4abda: Sign in from OwnMail's own login form instead of the Nylas-hosted credential screen. Credentials are posted server-side and every rejected credential returns one generic message.

  Sign-in attempts are rate-limited per mailbox and per client address, using an atomic counter on every path so a parallel burst cannot slip past: Cloudflare deployments use two new edge rate-limit bindings (`SIGNIN_EMAIL_LIMITER`, `SIGNIN_IP_LIMITER`, declared in `wrangler.jsonc` and carried through by `ownmail deploy` — no account resource to provision), and Redis-backed deployments use `INCR` with a separate `EXPIRE`. Cloudflare KV is deliberately not used for counting: it has no atomic increment and is eventually consistent. Two limitations are worth knowing: Cloudflare's binding supports only a 10s or 60s period, so the Workers budgets are per minute rather than per 15 minutes, and it is enforced per Cloudflare location rather than globally. A deployment with neither an edge limiter nor Redis falls back to per-instance counting, which bounds an attack against a single instance but not the deployment as a whole.

### Patch Changes

- a571068: Make thread attachment downloads easier to tap and clearly focus-visible.
- ac529b5: Make contact editor controls touch-friendly and visibly keyboard-focused.
- 9b38feb: Discard unsaved calendar edits when Cancel is selected.
- 076b781: Make settings saves single-flight, no-op aware, focus-safe, and revision-safe.
- e1f4867: Make error recovery actions touch-friendly and visibly keyboard-focused.
- 9b3f29f: Help browsers autofill contact names, organizations, email addresses, and phone numbers.
- c5777fc: Keep signed-in mailboxes signed in: on deployments with shared storage (Cloudflare KV, or Vercel with its Upstash Redis resource) the session deadline now slides forward on activity instead of expiring 14 days after the first login. Netlify and local deployments keep sessions in a signed cookie with nothing server-side to revoke, so a refreshed cookie could outlive a sign-out; they keep the fixed 14-day window running from the last sign-in. Configure `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` to enable sliding sessions there.
- 458768f: Make contact saves single-flight, lock pending edits, and clear announced errors on retry.

## 0.11.4

### Patch Changes

- 1deddc8: Dismiss message details when keyboard focus moves outside the disclosure.
- a5a833b: Make password updates single-flight, focus-safe, and retryable.
- 043616d: Make settings text and select fields easier to use on touch devices.
- 87c34e7: Start provider sign-in without an artificial delay while preserving a focus-safe single-flight state.
- 0dd6459: Improve keyboard focus contrast for thread display controls in light and forced-colors themes.
- d07bcae: Make search-detail thread actions single-flight, visible, and recoverable.
- c3fc5bb: End the active session before the root error screen starts sign-in recovery.
- 89485ff: Make calendar event actions easier to tap and clearly focus-visible.
- c8635a2: Make multi-message display controls touch-friendly and announce their message count.
- 4657b68: Provide actionable recipient validation before sending messages.
- fb6f19a: Make contact pagination discoverable, focus-safe, and recoverable across failures and list changes.
- dfce5d2: Protect unsaved contact changes with an accessible discard confirmation across every dismissal path.
- afab1d6: Make compose-backdrop archive, restore, delete, and star actions single-flight with clear pending, failure, and retry feedback.
- aeb6719: Allow keyboard users to open month-calendar days with Enter or Space.
- afbaad9: Keep folder pagination available on empty pages and provide safe, recoverable feedback when loading more mail fails.

## 0.11.3

### Patch Changes

- 00240cb: Expose Reply all and Forward on mobile thread readers.
- f9b1302: Let users load all pages of mail search results.

## 0.11.2

### Patch Changes

- 4bcbb2b: Confirm intent before deleting calendar events.
- dac9e9d: Synchronize theme controls across OwnMail.
- 24ec05e: Provide actionable contact form validation.
- 3376d8b: Make the minimized composer restore action accurate and accessible.
- 1281e5f: Clear stale password feedback when either password field changes.
- d796a5d: Clarify unscoped mail search results and no-match recovery.
- 50edf32: Hide raw email download for unsent OwnMail drafts.

## 0.11.1

## 0.11.0

## 0.10.2

### Patch Changes

- 40fe468: Prevent mail threads from flashing a collapsed state while switching conversations.
- 5cf11b7: Prevent compose edits from being lost while close persistence is in progress.
- 2b60637: Prevent thread content flashes by stabilizing client-rendered email, timestamps, and navigation progress.
- b7667f9: Prevent draft, attachment, and event actions from crossing unfinished async work.

## 0.10.1

### Patch Changes

- e62f266: Show immediate progress feedback during loader-backed navigation.
- a60ba58: Improve message reading hierarchy with anchored details and responsive full-width content.

## 0.10.0

### Minor Changes

- 190d8e8: Replace OwnMail's custom authorization URL and PKCE flow with the supported @nylas/connect backend flow while preserving server-owned grant sessions.

### Patch Changes

- b761c7f: Pin OwnMail authorization to the Nylas connector so reused applications cannot authenticate through an unrelated configured provider.
- 8c397af: Polish mail reading and navigation with native composer HTML, reliable dark rendering, clean snippets, thread shortcuts, and accessible app rail interactions.
- 5bcc2a0: Improve thread reading with faithful sender rendering, full message details, thread controls, readable plain text, and sticky context.
- 40c902e: Make composer initial focus follow reply and prefilled message context.
- 2237b74: Prevent unintended iOS Safari zoom when focusing inputs: the touch-device 16px minimum now covers every contenteditable variant (not just `contenteditable="true"`) and inline code spans inside the compose markdown editor. Desktop type scale is unchanged.
- Updated dependencies [16886e9]
  - @nylas-labs/cli-kit@0.7.0

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
