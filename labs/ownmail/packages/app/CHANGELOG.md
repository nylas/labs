# @ownmail/app

## 0.21.2

### Patch Changes

- 6c77cb1: Make navigation feel continuous with restrained pane transitions, matched navigation-sheet dismissal, and reduced-motion support without delaying content or retaining outgoing mailbox data.

## 0.21.1

### Patch Changes

- b4d5b1b: Stream authenticated mailbox startup, remove redundant session work, and add anonymous performance diagnostics.
- c2d85c6: Prevent previous-account content from reappearing after switching inboxes by retiring router caches and awaiting replacement loaders.
- d3d4607: Add finger-following mobile back feedback and restore warm inbox interaction immediately on history navigation.
- a466a24: Diagnose image proxy failures safely and bound remote image and attachment transfers.

## 0.21.0

### Minor Changes

- 1dd9c88: Compose is no longer a page. One composer opens over whatever is on screen, from any module, and a reply is written inline under the last message of its thread. Opening another composer saves and closes the current one, sending confirms with a toast instead of leaving for Sent, and focus returns to whatever opened it. Old `/mail/compose` links still open the composer.
- 8e01fbc: Set OwnMail in Manrope throughout, with Inter for times, dates, counts and calendar numbers. Poppins is no longer shipped, so each page loads three fewer font files. Unread mail no longer uses a dot: unread rows show the time in the green accent, and the sender and subject in semibold. The star now sits clear of the sender instead of crowding it.
- 1dd9c88: Refresh the OwnMail interface. Each module's sidebar now opens with one quiet create action (Compose, New event, New contact) in an inset column, icon buttons share one size, and the dark theme gains a slight green tint. Unread mail is marked with an 8px accent dot, the reader toolbar is grouped with a labelled Reply, and archive or delete is confirmed in a toast with Undo while the rows below slide into the gap. Motion follows new press and spring tokens and respects reduced motion. The calendar labels time zones by city, shades the second zone's off-hours, shows the current time in both, and keeps short and past events readable. Contacts are grouped by letter, and Settings uses one heading style.

### Patch Changes

- 8e01fbc: Pressing j or k with a conversation open now moves the list highlight at once, and the conversation opens right after. Long or heavily designed emails no longer delay the key press. Holding j skims the list and opens only the conversation you stop on.
- 8e01fbc: Fix arrow-key navigation in Contacts, which reset on every re-render and did nothing. Typing in mail search now re-renders only the search box, Contacts rows re-render only when their own state changes, and dragging a calendar event re-renders only when it crosses into a new time slot. The mail and contacts screens are now loaded only on the pages that show them.
- f1fbd93: Make OwnMail respond faster. Moving through a long inbox with j and k, opening a conversation, and opening the composer now each paint within 100 ms on a 4× slowed CPU. Each page loads about a quarter less JavaScript at startup, because the calendar screen and the composer are fetched only when needed, and the composer is warmed while the browser is idle. Opening the calendar no longer blocks input for a quarter of a second.

## 0.20.2

### Patch Changes

- 4b55793: Release minified server bundles so the packed OwnMail CLI stays below its 3.5 MB deployment budget.

## 0.20.1

### Patch Changes

- cf79bdd: Upgrade TanStack dependencies to fix CVE-2026-102989

## 0.20.0

### Patch Changes

- e85d99c: Fix three reading issues: a message header now keeps clear space from the body beneath it, the Conversation view keeps every message on its sender's side at chat width and shows a personal email with a table signature as a bubble, and a message shown on light paper in the dark theme no longer flickers while its images reload.
- Updated dependencies [d670e21]
  - @nylas-labs/cli-kit@0.9.0

## 0.19.0

### Minor Changes

- b45f887: Calendar events now open beside the grid and can be rearranged by dragging. On desktop, clicking an event shows its details in a pane on the right, with a button in the top bar to show or hide it, so the week stays visible; Edit opens the editor as before, and phones keep the bottom sheet. In the day and week views you can drag across empty time to start a new event, drag an event to move it, and drag its top or bottom edge to resize it, all in 15-minute steps. Dropping outside the grid or pressing Escape cancels, and an event is put back with a message if the change cannot be saved. The same is available from the keyboard: Alt with an arrow key moves the focused event, Shift and Alt with Up or Down changes when it ends, and Enter saves. Read-only events cannot be moved, and moving one occurrence of a repeating event changes only that occurrence. The editor now offers times in 15-minute steps, keeps an event's real length when you edit it, and lets you change the date of an existing timed event.

  `@nylas-labs/cli-kit` adds the optional `master_event_id` field to the v3 `Event` type.

- 7fc352b: Three new calendar controls. You can zoom the day and week grid in four steps from the control at the right of the day header, and the grid keeps your place as it resizes. The time-zone label at the top of the time column now opens a small picker to add, change, or remove a second time zone without leaving the calendar. On desktop, a button at the start of the top bar hides the calendar sidebar to give the grid more room. Each choice is remembered on the device.
- ea0b189: "Meet with…" in the calendar. Search for people in the calendar sidebar and their busy times appear on the day and week grid as hatched blocks beside your own events, each labelled with the person's name, so you can see when everyone is free. A legend lists each person with a swatch and says in words whether they have busy times, none, or have not shared their availability. Only busy and free times are requested: event titles, guests and locations are never fetched or shown, and the people you pick are not saved. Up to five people can be shown at once, and if availability cannot be loaded or is rate limited the calendar says so and offers to try again.

  `@nylas-labs/cli-kit` adds `getFreeBusy` to the grant-scoped v3 client, with the `FreeBusyRequest`, `FreeBusy` and `FreeBusyTimeSlot` types.

- 3113a45: A clearer calendar week. Events that overlap now sit side by side instead of covering each other, and each event takes the colour of its own calendar. Tentative and unanswered invitations show a dashed outline, declined ones are struck through, and meetings that have ended fade back; each state is also announced to screen readers. The current time runs across the whole week with the time shown in the gutter, today's date gets its own marker, and the time column shows the short zone name (for example "EDT"). The all-day band shows three rows with a control to see the rest and marks events that continue beyond the visible days. The sidebar highlights the current week, groups calendars under your account, tags the default calendar, and labels hidden ones. The header shows the month and year with a single view dropdown. Busy calendars now load every event in the visible range rather than stopping at the first page, hidden calendars are no longer fetched, and the calendar says so if some events could not be loaded.
- 3694ef6: Newsletters, receipts and notifications read as clean articles in the Conversation view. Instead of the sender's layout, designed mail is shown in the app's own type at a comfortable line length: headings, paragraphs, lists, images with their descriptions, links, and buttons for the main action. Hidden preview text, tracking pixels, spacer images and duplicated mobile copies are left out, and a thread that contains only designed mail opens as an article rather than a chat. When the clean version cannot be trusted, for example an email that is mostly images or a receipt with a table of line items, the message is shown exactly as before. "Show original" is on every article, and the thread display menu lets you choose Clean or Original for designed mail in this view. The standard reader is unchanged.
- 608cd3d: Tidier clean articles in the Conversation view. Navigation rows, social links and footers now fold into a single "Footer" line at the end of an article that says how many links it holds and whether Unsubscribe is among them; open it to see everything, nothing is removed. Receipts, itineraries and reports keep their tables, so each price still sits next to its item instead of being flattened into a list. A one-time code is never folded away, even when it sits in the small print. Mailing-list mail is recognised more reliably: while the Conversation view is showing a thread, OwnMail checks which of its messages carry the standard List-Unsubscribe header and treats those as newsletters. Only that yes-or-no answer is used; header contents are not stored or shown, and the standard reader does not request them.
- df28eb9: Right-click menus for mail, calendar and contacts. Right-click a conversation in a folder or in search results to open it, reply, reply all or forward, mark it read or unread, star it, archive it or move it to Trash without opening it first; drafts can be opened or discarded the same way. A message header in the reader offers collapse and "Download raw email", a message in the Conversation view offers "Show original" and the raw download, and a label in the sidebar offers rename and delete. In the calendar, right-click an event to open, edit, answer or delete it, an empty time slot to start an event there, and a calendar in the list to hide, rename or delete it. Contacts offer open, edit, new email, copy email address and delete. Deleting an event, a label, a calendar or a contact still asks for confirmation first, and actions that are not available for an item are shown greyed out. If an action from a menu fails, the row or the calendar says so and names the item. The menus also open with the keyboard menu key or Shift+F10 and with a long press on touch screens. Email content, text fields and selected text keep the browser's own menu, so links, images and copying work as before.
- c0032be: Cleaner bubbles in the Conversation view. Each bubble now leaves out anything an earlier message in the thread already showed, even when the sender's mail app did not mark it as a quote, and drops signatures. When someone answers point by point between quoted lines, or writes below a quote, each answer appears under a short reference to the line it answers, with the name of the person who wrote that line. Small system lines in the stream show what email normally hides in headers: a person added to the thread, someone moved from To to Cc, or a changed subject. Quoted text the thread has not shown before stays available in the bubble, and "Show original" is still on every message.
- 755e870: Read a thread as a conversation. A new, optional Conversation view turns a thread into a chat transcript: each email becomes a bubble with only what that person newly wrote, your messages sit on the right, group threads show names and initials, emails sent minutes apart are grouped, and days are separated. Attachments appear as chips, calendar invitations stay in the stream with their actions, and "Show original" on any message brings back the full email. Switch a single thread with the Messages / Conversation buttons in the thread toolbar, or make it your default with "Thread view" in the command palette. Nothing changes unless you turn it on: the standard reader remains the default. When the view cannot be sure what is new in a message (a forward, text written below a quote, or replies typed between quoted lines), it shows the whole message rather than hide anything. Replying from the view names everyone who will receive the message, defaults to reply-all in a group, and opens the usual composer.
- 1583866: Add a glass layer for surfaces that float over content. Mail and reader toolbars, the calendar day header and the mobile tab bar are now lightly translucent, so the list, the message or the calendar grid scrolls beneath them. Menus, popovers, select lists, the command palette and the new-event composer share one translucent panel style with a single soft shadow and a 12px radius, in place of the assorted shadows they used before. Everything in the flow of a page stays flat and opaque, and so do modal dialogs, the compose window, mobile sheets and tooltips. Glass turns solid when the browser cannot blur, and when you prefer reduced transparency, more contrast or forced colours.
- 7666271: Read email the way it was designed, in dark mode too. Light-only messages are now adapted color by color instead of inverted: the sender's canvas blends into the dark reader, cards lift onto a surface, brand colors and dark sections keep their colors, and text stays readable. Messages whose logos sit on a white matte stay on a light sheet that runs edge to edge. Threads drop the boxed cards for one aligned column with the sender's canvas extending across the reading pane. Tables keep their rows on narrow screens, original layouts never shrink text below 80% (they scroll sideways instead), button links are no longer underlined, reopened messages keep their height, and "Always use original colors" can be remembered per sender from the thread display menu.
- 96bf1d4: Choose how dense your mail list is. A new list density control beside the reading pane menu, also available from the command palette, switches between Default (three lines, as before), Compact (sender and date, then subject and snippet on one line), and Condensed (everything on a single line, with a wider list in the vertical split). The choice applies to folders, drafts, and search results and is remembered on the device. Compact and Condensed apply when you use a mouse or trackpad on a desktop-width window; phones, tablets, and other touch screens keep the roomier Default rows so every row stays easy to tap. The unread dot now sits in front of the sender instead of over the subject line.
- 62e4470: More of the message, less chrome around it. The subject is now the first line of the conversation at body size and scrolls away with it instead of staying pinned, so on desktop only the toolbar stays in place. The thread display menu and expand/collapse-all moved into that toolbar, each message header is a single compact row with download and collapse behind one "more" button, and the pinned "Write a reply…" bar became a field after the last message that you can jump to with `r`. Message text has a consistent 16px size and comfortable line spacing unless the sender chose their own, ordinary replies with signatures, images or quoted text now keep a readable line length, dates and recipients are slightly larger, and designed emails start closer to the top. Phones keep their toolbar and bottom reply bar.

### Patch Changes

- 03b8dc2: OwnMail keeps each inbox's data and choices separate. Mail, calendar and contact data is stored per inbox, and if you switch inbox in another tab or sign in again, the open tab notices and reloads into the new inbox instead of mixing the two. The display name you save, the senders whose images you chose to load and the senders you keep in their original colours now apply only to the inbox you set them in; a name or sender list saved before this update is not carried over, so you may need to choose those senders once more. Your reading pane, email display, timezone and hidden-calendar choices are in place the moment the app opens, without first showing the defaults. When an action such as starring or archiving fails, only that change is undone and the list is refreshed, so mail that arrived in the meantime stays on screen. The mail search box, the contact list and the keyboard cursor in lists now show the right state the instant you move to another search, list or inbox, instead of briefly showing the previous one.
- 268dd73: OwnMail no longer shows one inbox, folder or item while another is loading. Switching inbox replaces the whole app with a loader instead of blurring the previous inbox behind a cover. Opening another folder, search, contact or calendar range shows a skeleton that already names where you are going, rather than leaving the previous list under the new title. A delete confirmation, a failed-action message or a failed event draft no longer carries over to the next contact, conversation or event, and a folder no longer opens at the scroll position of the one before it. A conversation now opens at its top rather than at the scroll position of the one read before it, and the loading rows match the list density you chose, so nothing shifts when mail arrives.
- 608cd3d: Your own messages stand out in the Conversation view. Bubbles you sent now have a quiet green tint in both light and dark themes, while everyone else's stay neutral; they still sit on the right, so colour is never the only cue, and text, links and reply references inside them keep full reading contrast.
- 0bfafb3: The Conversation view no longer loses things people wrote. A plain-text reply that continues below a quoted line now shows that text; an answer that happens to begin with "From:", "Date:" or "Subject:" is no longer mistaken for a mail header; a closing list of links or addresses is kept unless it really is a signature; and a receipt or report table that uses merged cells is shown in its original layout so its numbers stay under the right columns. A postscript written below a plain-text signature is shown instead of being removed with the signature. A one-time code written in groups, such as 123-456 or 123 456, is never folded into an article's footer. An answer typed below the quoted original in an Outlook-style reply, where nothing marks the quote, is shown with the whole message instead of being folded away. A closing list of contacts under a title is kept; only a block that starts with the sender's own name is treated as their signature. Side-by-side columns in designed mail are no longer mistaken for hidden text, and an article that would lose text that way is shown in its original layout instead.
- 0411d22: Selected and highlighted items no longer use a coloured bar along one edge. Calendar invitation cards drop the heavy left stripe, the open conversation and current folder are marked with a fill, the keyboard cursor draws a full outline around its row, search errors show an alert icon inside a tinted box, quoted text in the composer is indented and muted, and the active mobile tab sits on a filled pill. The search field outlines an invalid query on all sides, the desktop navigation marks the current section with a fill instead of a side bar, and event dialogs show the calendar's colour as a small swatch beside the title instead of a strip across the top. Each state is also announced to assistive technology rather than conveyed by colour alone.
- 755e870: Replies that quote an earlier message keep the comfortable reading width. A reply whose quoted text was folded behind "Show quoted text" was being treated as a designed email and stretched across the full column; it is now measured like any other plain message.
- af982f0: Fix a crash in the conversation reader ("Cannot destructure property 'thread'"). When the reader's cached data was replaced by a background load, one render could see no data and the screen failed. The reader, mail lists, folders, calendar and contacts now keep showing what they already loaded until the new data arrives.
- 158f03b: Spacing is now consistent across OwnMail. Attachments at the end of a message no longer sit directly on the line above the next message, and the gap is the same whether a message is open or collapsed. Composer attachment pills are slimmer with more room around them, mail toolbars match the 44px height used elsewhere on desktop, the conversation no longer shifts sideways when it finishes loading, the reply bar and mail list titles line up with the content beside them, and dialog headers, dividers and sidebar sections use the same spacing throughout.
- Updated dependencies [b45f887]
- Updated dependencies [ea0b189]
  - @nylas-labs/cli-kit@0.8.0

## 0.18.0

## 0.17.0

## 0.16.0

### Minor Changes

- 3fbd03b: Keep the calendar current and fast: the time grid opens at the current time, "Up next today" drops meetings that have ended and marks the one in progress, today's highlight follows your primary timezone and rolls over at midnight, previously viewed and adjacent weeks open instantly from cache, and hidden calendars stay hidden between visits for each inbox.
- 6ab5495: Keep triage flowing: archiving or deleting a conversation on wide screens opens the next one, `j`/`k` move straight between conversations while one is open, and tapping a conversation shows its subject immediately while it loads.
- 96b95ca: Choose how conversations open on wide screens: no split, vertical split, or horizontal split. Pick it from the mail list toolbar or the command palette; closing a conversation returns focus to its row.

### Patch Changes

- b90ed36: Refresh mail again when returning from Settings after a mail change, so an earlier stale refresh no longer lingers for up to a minute.
- 51e9c4d: Switch between inboxes without a full page reload: the app shows a switching overlay, clears the previous inbox's cached mail, calendar, and contact state, and stays in the current section. Switching waits for in-flight saves, and plain form posts keep working as a fallback.
- b9bc759: Offer "Add to calendar" for invitations on Cloudflare deployments by backing invitation creation claims with a Durable Object, and stop describing invitations OwnMail cannot add as "still syncing".
- f5aeac1: Keep a search result's reader unread when marking it read fails while the search is still loading.
- 49b72b3: Mark threads read the moment you open them: the list row, folder unread badge, and reader update instantly, hovering a row no longer marks it read, and a failed read quietly restores the unread state.
- 352f2c3: Keep background sync stable while navigating, so opening threads no longer refetches every mailbox view, and check for new changes as soon as the tab becomes visible again.
- 32ece5b: Keep read state consistent when marking a conversation read fails, and mark conversations read when you select them behind the composer.

## 0.15.5

### Patch Changes

- b4057de: Standardize mobile touch targets, focus behavior, and responsive interaction surfaces across mail, calendar, contacts, settings, and shared controls.

## 0.15.4

### Patch Changes

- 648bb6d: Use one contextual mobile bottom bar and thread-wide email display controls.

## 0.15.3

### Patch Changes

- 6761131: Restore reliable proxied email images and persist Layout and Message colors choices.
- 5f50fe1: Preserve readable text contrast on nested email surfaces after automatic color adaptation.

## 0.15.2

### Patch Changes

- 227946f: Keep transparent branded artwork readable in dark mode by adapting low-color artwork palettes without adding pale rectangular backings.
- 7126bd9: Allow valid CDN-hosted email images to load when public DNS address pools rotate.
- a449fff: Preserve readable table columns around small media while constraining only genuinely oversized content.
- 02bef6c: Evaluate responsive email breakpoints against the reading pane in Original and Readable layouts.

## 0.15.1

### Patch Changes

- b3cc00c: Preserve original email colors and recover gracefully when protected images fail to load.

## 0.15.0

### Minor Changes

- 3005c3b: Add adaptive mobile sheets, dialogs, and full-screen editors.
- 3005c3b: Add pull-to-refresh and accessible route feedback for mobile mail, contacts, and calendar.
- 3005c3b: Improve touch targets, thread-row semantics, and mobile calendar readability.
- 3005c3b: Add safe-area-aware mobile app chrome, persistent primary tabs, and responsive navigation sheets.

### Patch Changes

- 5b7f4ff: Streamline email display controls and persist remote-image choices.
- 6cef7bb: Add persistent mobile navigation, touch-safe mail and calendar controls, a full-screen mobile composer, readable week columns, and responsive contact editing across OwnMail.

## 0.14.1

### Patch Changes

- c787f4f: Improve mobile HTML email reflow and dark-mode image and link rendering.
- 3349df1: Proxy remote email images securely and add dark-aware color treatment with automatic and original modes.

## 0.14.0

### Minor Changes

- f387f16: Collapse repeated quoted history, resolve inline CID media, and improve thread reading hierarchy.
- 8d762d3: Make email dark mode follow the app theme, preserve image fidelity, and block remote media until consent.

## 0.13.0

### Minor Changes

- 5bbf19e: Add readable and original email layout modes with pane-aware reflow for legacy HTML.
- f1e7d54: Preserve native pinch zoom while keeping deliberate single-finger thread swipe navigation.

### Patch Changes

- 1a689ef: Refresh invalidated cached drafts before initializing compose, and keep mutable mailbox information current after settings changes.

## 0.12.9

### Patch Changes

- 71cbac7: Fix authenticated mailbox server rendering and isolate compose state when switching backdrop drafts.

## 0.12.8

### Patch Changes

- 4b01ef3: Make compose and mailbox history navigation render from the client cache without waiting for redundant server requests.

## 0.12.7

### Patch Changes

- e9fb90f: Fix mobile navigation, realtime thread refreshes, and unread counts.

## 0.12.6

### Patch Changes

- c325e0d: Remove OwnMail-imported calendar events when a matching organizer cancellation is opened, without notifying participants.
- Updated dependencies [c325e0d]
  - @nylas-labs/cli-kit@0.7.3

## 0.12.5

### Patch Changes

- 898c3f0: Recover calendar invitation cards from delayed provider synchronization and let users explicitly add a strictly matched, losslessly supported invitation when the deployment can claim creation atomically.
- Updated dependencies [898c3f0]
  - @nylas-labs/cli-kit@0.7.2

## 0.12.4

### Patch Changes

- 3608665: Make mobile thread headers compact and easier to read.
- 61b2083: Improve the OwnMail mobile navigation with clearer groups and larger touch targets.
- b2b8f83: Restore the continuous bottom border on the OwnMail application header.
- 757300d: Add calendar invitation RSVP controls with conflict awareness to incoming ICS emails.
- b79770f: Make the mail search divider visible and consistent.

## 0.12.3

### Patch Changes

- c957523: Add advanced Agent Account mail search autocomplete and explicit submission.
- df6410e: Add folder and calendar management with secure create, rename, and delete flows.
- Updated dependencies [df6410e]
  - @nylas-labs/cli-kit@0.7.1

## 0.12.2

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
