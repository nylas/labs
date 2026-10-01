# @nylas-labs/cli-kit

## 0.9.0

### Minor Changes

- d670e21: Sign in to Nylas on the dashboard login page. `npx ownmail` and `ownmail auth login` now open the Nylas dashboard in your browser instead of asking how you sign in: log in with any method the dashboard offers (email and password, Google, Microsoft, GitHub or Enterprise SAML, with MFA if you use it) or create a free account there, then approve OwnMail. The terminal no longer asks for your Nylas password or authenticator code. If you belong to several organizations, you choose the one that owns the mailbox on that page; to use a different one later, run `ownmail auth login` again. A session saved by an earlier version keeps working until it ends. `@nylas-labs/cli-kit` adds `createOAuthPkcePair`, `DASHBOARD_SESSION_OAUTH_SCOPE` and the `oauthAuthorizeUrl`, `oauthToken`, `oauthRefresh` and `oauthExchange` methods on `DashboardAccountClient`.

## 0.8.0

### Minor Changes

- ea0b189: "Meet with…" in the calendar. Search for people in the calendar sidebar and their busy times appear on the day and week grid as hatched blocks beside your own events, each labelled with the person's name, so you can see when everyone is free. A legend lists each person with a swatch and says in words whether they have busy times, none, or have not shared their availability. Only busy and free times are requested: event titles, guests and locations are never fetched or shown, and the people you pick are not saved. Up to five people can be shown at once, and if availability cannot be loaded or is rate limited the calendar says so and offers to try again.

  `@nylas-labs/cli-kit` adds `getFreeBusy` to the grant-scoped v3 client, with the `FreeBusyRequest`, `FreeBusy` and `FreeBusyTimeSlot` types.

### Patch Changes

- b45f887: Calendar events now open beside the grid and can be rearranged by dragging. On desktop, clicking an event shows its details in a pane on the right, with a button in the top bar to show or hide it, so the week stays visible; Edit opens the editor as before, and phones keep the bottom sheet. In the day and week views you can drag across empty time to start a new event, drag an event to move it, and drag its top or bottom edge to resize it, all in 15-minute steps. Dropping outside the grid or pressing Escape cancels, and an event is put back with a message if the change cannot be saved. The same is available from the keyboard: Alt with an arrow key moves the focused event, Shift and Alt with Up or Down changes when it ends, and Enter saves. Read-only events cannot be moved, and moving one occurrence of a repeating event changes only that occurrence. The editor now offers times in 15-minute steps, keeps an event's real length when you edit it, and lets you change the date of an existing timed event.

  `@nylas-labs/cli-kit` adds the optional `master_event_id` field to the v3 `Event` type.

## 0.7.3

### Patch Changes

- c325e0d: Remove OwnMail-imported calendar events when a matching organizer cancellation is opened, without notifying participants.

## 0.7.2

### Patch Changes

- 898c3f0: Recover calendar invitation cards from delayed provider synchronization and let users explicitly add a strictly matched, losslessly supported invitation when the deployment can claim creation atomically.

## 0.7.1

### Patch Changes

- df6410e: Add folder and calendar management with secure create, rename, and delete flows.

## 0.7.0

### Minor Changes

- 16886e9: Add Enterprise SAML authentication to the OwnMail CLI using the dashboard device flow.

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
