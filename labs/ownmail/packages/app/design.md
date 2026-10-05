# Design — OwnMail

A locked interaction and visual system for the OwnMail application. Route work
must extend this system instead of inventing per-screen themes.

## Genre

Modern-minimal with a native-utilitarian mobile interaction model.

## Macrostructure family

- Marketing pages: Marquee Hero, if a marketing surface is added later.
- App pages: Workbench. Dense information stays legible; primary mobile actions
  sit within thumb reach; contextual tools use progressive disclosure.
- Content pages: Long Document for help, policy, and release content.

## Theme

Quiet, anchored on a restrained green. The canonical values live in
`src/tokens.css`; all application colour and font declarations reference those
tokens.

## Typography

- Display and body: Manrope, variable weight 200–800. Manrope is the primary
  face for all UI text.
- Data: Inter, variable weight 400–700, with tabular figures (`font-data
  tabular-nums`), for times, dates, counts and calendar numerals.
- Mono: the platform UI monospace stack, limited to shortcuts and code.
- Display tracking: `-0.02em`.
- Mobile editable text: never below 16px, preventing iOS focus zoom.

## Spacing

Use the six-step scale below and the named safe-area/touch tokens in
`src/tokens.css`. Touch-reachable controls are at least 44 CSS pixels; primary
mobile rows prefer 48 pixels.

| Token | Value | Role |
| --- | --- | --- |
| `control` | 4px | Inside a control; between icon buttons in a group |
| `cluster` | 8px | Between related items: pills, chips, buttons in a row |
| `hairline` | 12px | Minimum between any content and a separator line; compact toolbar gutter |
| `region` | 16px | Inner padding and gutter of a region; clearance where a line separates messages |
| `section` | 24px | Between sections in a page or form |
| `page` | 32px | Top and bottom of a page; wide reading gutter |

The tokens are exported as `--spacing-<token>` and used as Tailwind utilities
such as `gap-cluster`, `px-hairline`, and `mt-section`.

1. Six steps, each with a role. Spacing between elements uses 4, 8, 12, 16, 24
   or 32px, chosen by role from the table above, through named tokens in
   `tokens.css`. 20px is kept for one job only: the dialog gutter.
2. Clearance to a line. Nothing sits closer than 12px to a separator. A bordered
   pill, chip or button next to a line that divides messages or sections gets
   16px.
3. Symmetry. A separator has the same space on both sides, and that space does
   not change with state (open or collapsed, loading or loaded, empty or
   filled).
4. One gutter per pane. A toolbar, the content beneath it, its loading skeleton
   and its footer share the same left and right edge at every breakpoint.
5. One recipe per kind of thing. One toolbar height, one pill, one chip row gap,
   one dialog header and footer. They live in shared components (`Toolbar`,
   `Section`, `PillRow` and `Chip`, `IconButton`) so screens stop hand-writing
   padding.
6. No improvised values. Half steps, arbitrary values and negative margins are
   allowed only inside shared primitives and safe-area sums. Never two separator
   lines closer than 16px.
7. Inset sidebars. A module sidebar is one inset column: its create action and
   its navigation rows sit `hairline` (12px) from both sidebar edges, and the
   create action has the same 12px above and below it. There is no separator
   under the create action. Rows are rounded like any other plane control, and
   icons, dots and section labels share one left edge.

The toolbar height is 44px on desktop and 56px on a phone, defined once as
`--toolbar-height` in `src/tokens.css`. `TOOLBAR_HEIGHT_CLASS` in
`src/app/config/layout.ts` and the padding beneath a pinned toolbar both read
that token.
`pnpm lint` reports the number of half-step and arbitrary spacing values outside
`src/shared/components/ui` through `scripts/check-ownmail-spacing.mjs`; it is a
warning while existing screens are migrated.

## Motion

Motion says what changed and where it went. Nothing moves for decoration.

- Enter: `--ease-out`; exit: `--ease-in`; state changes: `--ease-in-out`.
- Micro feedback: `--dur-fast`; sheets and route surfaces: `--dur-medium`.
- Animate transform and opacity only for spatial transitions.
- Reduced motion removes spatial movement and keeps functional feedback.

| Token | Value | Use |
| --- | --- | --- |
| `--dur-press` | 130ms | Button press |
| `--ease-press` | `cubic-bezier(0.3, 0.9, 0.4, 1)` | A press settles without overshoot |
| `--ease-spring` | `cubic-bezier(0.28, 1.4, 0.36, 1)` | One overshoot. Starring only |

1. Split timing. Opacity runs on `--dur-fast`, position and scale on
   `--dur-medium`, so a surface is readable almost at once and then settles.
   Exits are shorter than entrances.
2. Press. Buttons and rail items scale to 0.97 over `--dur-press` with
   `--ease-press`. Nothing nudges down by a pixel.
3. Panels. A floating panel (composer, dialogs, popovers) fades in while it
   rises 8px from a 0.98 scale, and leaves over `--dur-fast` with `--ease-in`.
   Menus do not animate ("Context menus").
4. One spring. Starring a conversation grows the star from 0.6 with
   `--ease-spring`. Unstarring does not move. No other surface bounces.
5. Removal. When a row leaves a list (archive, delete, move), the rows that
   stay slide into the gap with a transform from where they were
   (`useFlipList`). Row height never animates.
6. State swaps. An icon that changes in place (the theme toggle) rotates in
   from -60 degrees with a fade over `--dur-medium` and `--ease-in-out`
   (`SwapIcon`), so it reads as the same control in a new state. A pressed
   state that moves between buttons (the view switch) does not animate.
7. Changing counts. A folder count that changes while it is on screen drops in
   from above over `--dur-medium`.
8. Navigation. The incoming region fades from 60% to full opacity over
   `--dur-fast`; only list/detail depth changes add a 12px horizontal settle
   over `--dur-medium` on single-pane layouts. Desktop detail changes and peer
   destinations only fade. See "Navigation choreography" below. On narrow
   touch screens, the back gesture follows the finger and reveals the retained list.
   Releasing commits immediately once the distance threshold is met; cancellation
   returns within 120ms, with no settling animation under reduced motion. Browser
   edge gestures, vertical scrolling, and pinch zoom keep their native behavior.

## Navigation choreography

The experience should acknowledge every change of place without making the
person wait. Chrome remains the visual anchor. One arriving content region
moves at a time; rows never cascade in. The 120ms fade, 220ms settle, and 12px
travel are OwnMail design choices using the existing tokens, not universal
perceptual thresholds. The incoming content begins at 60% opacity to soften
the replacement while avoiding a blank flash.

| Journey | Treatment | What stays stable |
| --- | --- | --- |
| Mail / Calendar / Contacts / Settings | Incoming pane fades, no horizontal travel | Header, rail, bottom navigation |
| Folder or search identity changes | Destination skeleton immediately; committed result fades | Mail navigation and destination title |
| List → thread or contact, single pane | Incoming detail fades and settles from 12px to the right | App chrome |
| Detail → list, single pane | Returning list fades and settles from 12px to the left | Retained list scroll and existing focus restoration |
| Thread → thread | Conversation content fades only | Reader toolbar, response controls, list and navigation |
| Contact → contact | Detail fades only | List and navigation |
| Calendar date or view changes | New grid fades only | Header geometry and side panels |
| Navigation sheet open / close | 24px entrance, short reverse exit; backdrop fades | Underlying destination |
| Committed swipe-back | Existing finger-following transition only | Native gesture behavior and retained list |
| Initial render, same identity refresh, pagination | No route animation | Reading position and startup speed |
| Account switch | Immediate removal and existing neutral loader | Account isolation |

Mail uses its 1280px reading-pane breakpoint; contacts use 768px. No layout
properties animate. Routing, loading, focus and scroll restoration never wait
for animation. A new navigation or interaction cancels in-progress effects;
the destination is immediately usable. A slow request shows its existing
pending state and progress indication, then reveals only the arriving data.
No minimum loading or animation duration is added.

Reduced motion skips all route effects and sheet animations. Changing the OS
preference during an animation cancels it. Functional loading and route
announcements remain. Unsupported animation APIs fall back to the same
immediate navigation. Gesture-driven motion remains controlled by the finger,
with no animated settling under reduced motion.

Implementation: `NavigationMotion` observes the router's committed-render event
and animates the named `data-navigation-region` using the Web Animations API.
Mail readers fade the subject and message stream marked `data-navigation-content`
together. The icon toolbar, its glass backdrop, inline reply entry and pinned
Conversation reply bar remain fully opaque. Entering or leaving a single-pane
reader still uses the pane for spatial movement; peer thread changes never do.
It does not add wrappers, remount panes, keep outgoing DOM, or take snapshots.
The existing `ContentReadyOutlet` remains responsible for identity isolation.
Sheets use Radix's CSS animation lifecycle so dismissal can finish before the
sheet unmounts; account and route unmounts still remove it immediately.

### Research and decisions (October 2026)

- [Microsoft Fluent 2 — Motion](https://fluent2.microsoft.design/motion):
  top-level transitions use quick fades so peers do not acquire an unintended
  spatial hierarchy. Motion stays with the region in focus. This informs the
  peer/depth distinction and the decision to leave chrome stationary.
- [IBM Carbon — Motion](https://v10.carbondesignsystem.com/guidelines/motion/overview/):
  task-focused motion is subtle and efficient; duration varies with travel,
  and curves avoid bounce and sudden stops. OwnMail adopts that restrained
  approach for repeated mail triage. This is the archived v10 guidance, used
  for its design principles rather than current package APIs.
- [Google Material — Duration and easing](https://m1.material.io/motion/duration-easing.html):
  repeated transitions should stay short, entrances decelerate, and exits can
  be shorter. Its historical duration examples are context-dependent; OwnMail
  keeps its existing timing scale instead of importing the mobile examples
  wholesale.
- [W3C — Animation from interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html):
  nonessential interaction motion must be disableable for SC 2.3.3 (AAA).
  OwnMail honors the OS preference, including live changes, and keeps semantic
  progress feedback independent of animation.
- [web.dev — High-performance animations](https://web.dev/articles/animations-guide):
  prefer opacity and transform-family properties; avoid layout/paint work and
  speculative permanent `will-change` layers. The implementation uses opacity
  and translation, without animating dimensions or adding a motion dependency.
- [Chrome — Same-document view transitions](https://developer.chrome.com/docs/web-platform/view-transitions/same-document):
  the API captures old/new snapshots and defaults to crossfading them. That
  is useful in many apps, but an outgoing mailbox snapshot conflicts with
  OwnMail's strict identity policy. Incoming-only effects preserve that policy.
- [Radix — Animation](https://www.radix-ui.com/primitives/docs/guides/animation):
  CSS keyframe exits defer primitive unmounting. This supplies sheet dismissal
  without an application timeout or custom focus-management layer.

Verification must cover cached and delayed navigation, rapid interruption,
browser Back/Forward, sidebar dismissal/reopening, reduced motion (including a
live toggle), scroll/focus retention, split panes, and account isolation. Inspect
320/375/414/768px layouts plus a wide desktop. Automated checks supplement
visual review; timings are design choices to validate with actual use.

## Microinteractions stance

- Silent success when the result is already visible.
- Optimistic state with generic rollback errors.
- Saving that leaves nothing on screen says so in place: the composer shows
  "Saved" beside its title once the autosave has finished.
- A move that takes a conversation off screen (archive, delete, return to
  inbox) is confirmed in a toast, with Undo when the folder it left is known.
  One toast at a time, panel glass, bottom centre, announced politely
  (`ToastProvider`); a failed undo says so in the same place.
- Focus feedback is immediate and never animated.
- Hover styling is supplementary; every action has a tap and keyboard path.

## Content-ready transitions

Every region shows its own data, or a loader.

1. Identity. Every screen region has a context identity: the account, plus an
   entity id or filter key (folder, thread, contact, search query, date range
   and view). A region renders only data fetched for its current identity.
2. Allowed. Same account and same query key: show cached data while
   refetching, keep rows during pagination, update in place on poll or webhook.
   A pending view may show cached fields of the destination, such as its
   subject.
3. Forbidden. When any part of the identity changes, the region shows a
   skeleton, a loader, or the new data. It never shows the previous identity's
   content, including under a translucent or blurred cover. `placeholderData`
   and `keepPreviousData` across differing keys are banned.
4. Account partition. Every query key, optimistic journal and persisted
   preference holding account-owned data includes the account identity.
   Clearing the cache is defence in depth, not the mechanism. During a switch
   the app content is unmounted, not covered.
5. Routes. Every route whose loader depends on a param or search identity
   declares a `pendingComponent`. Highlights and titles read the same source as
   the content beside them.
6. Local state. `useState` seeded from an entity, and entity-scoped UI state
   (errors, confirmations, drafts, selection, scroll), lives under a key equal
   to that identity. Syncing a prop into state with an effect is not a reset.
7. First render is correct. Client preferences are read synchronously with
   `useSyncExternalStore` and a server snapshot (the pattern in
   `src/shared/components/ClientTime.tsx`), or the dependent region renders a
   neutral placeholder. A default followed by a flip is a bug.
8. Optimism and tests. Rollback touches only what the mutation changed and ends
   with a refetch. Each identity-changing transition has a test with real route
   components mounted, asserting no previous-identity text is in the DOM while
   pending.

Two router behaviours shape how clauses 5 and 6 are met. React keeps the
children of a boundary that suspends again in the DOM, hidden, so a parent
renders a child that has a `pendingComponent` through `ContentReadyOutlet`,
which unmounts the previous child while the pending view is up. The router also
carries a scrolled element's offset to whatever element replaces it, so a
scroll area whose content has an identity names it with `scrollRestorationId`.
State that must start again for another identity without remounting its
component uses `useIdentityState` (`src/shared/hooks/use-identity-state.ts`).
The transition tests live in `src/routes/-content-ready-transitions.test.tsx`.

## Navigation

- Desktop: persistent application rail.
- Mobile: one persistent bottom surface. Mail, Calendar, Contacts, and Settings
  occupy it at top-level destinations; contextual workflows replace those items
  in the same surface instead of stacking a second bar above or below it.
- Contextual folders, calendars, mailboxes, theme, and command tools live in
  sheets rather than competing with primary destinations.
- Reading pane (wide screens only): no split (the conversation replaces the
  list), vertical split (list beside the reader), or horizontal split (list
  above the reader). The choice is a device preference, set from the list
  toolbar or the command palette. Narrow screens always replace the list.
  Closing a conversation returns focus to its row; triage auto-advances only
  while the list is visible beside the reader.

## List density

Mail lists (folders, drafts, and search results) share one row definition,
`.thread-row`, with three densities. The choice is a device preference, set from
the list toolbar or the command palette.

- Default: three lines (sender and date, subject, snippet), about 89 pixels.
- Compact: two lines (sender and date, then subject and snippet on one line),
  about 62 pixels.
- Condensed: one line (sender, subject and snippet, date), 34 pixels. The
  vertical split widens the list from 22rem to 26rem for it, in the same media
  query as the rows, so the preference changes no layout where it does not
  apply.
- Compact and Condensed apply only with a fine pointer (mouse or trackpad) on
  desktop layouts. Mobile layouts and any touch-capable device always get the
  Default row, never under 48 pixels, and the toolbar control is hidden there
  because the choice has no effect. The gate is a CSS media query that is the
  exact complement of the touch-floor query, not script detection.
- Unread rows have no marker of their own. The sender and subject are set in
  the foreground at semibold, and the time turns the green accent
  (`--cta-icon`) at semibold, where the eye checks for recency. Read rows set
  the sender at regular weight. Row text keeps the 16-pixel left edge it shares
  with the list title, and the sender sits 12 pixels clear of the star.
  The star's hit target is sized per density so it never extends into a
  neighbouring row.

## Reading

Compose is app state, not a page. `ComposeProvider` (at the app root, under
the account) holds one composer and opens it over whatever is on screen, in
any module: Compose, the `c` shortcut, Resume, a draft row, a contact's "New
email". Opening another first closes the open one, saving its draft; a failed
save keeps it open. A reply or reply all is written in its thread, under the
last message, when that thread is on screen (`registerInlineSlot`); a new
message, a forward, or a reply whose thread is not open floats as panel glass.
On a phone every composer is the full-screen editor. Closing returns focus to
whatever opened it. `/mail/compose` survives only to turn old links into an
open composer.

The reader's toolbar holds three groups divided by a separator: triage
(archive, delete, star, unread), view (the Messages / Conversation switch and
display options), and respond at the end. Reply is the one labelled button in
the respond group; Reply all and Forward stay icons beside it.

The subject is set at body size (16px Manrope semibold) and scrolls with the
conversation as its first line. On desktop one row is pinned, the 44px toolbar,
which also carries the thread's display actions; the reply field follows the
last message. Message bodies default to 16px with a 1.6 line-height, which a
sender's own styles override, and prose is held to a 72ch measure. Designed
(table or layout) mail keeps the full column. The first message header sits 8px
beneath the subject, and an open message's body starts 12px beneath its header,
so a sender canvas that spans the pane never touches the header above it.

## Conversation view

An optional second way to read a thread. The standard reader stays the default
and renders exactly as before when the view is off.

- Choosing it. `threadView` is a device preference (`messages` by default,
  `conversation` opt-in) set from the command palette. The thread toolbar's
  Messages / Conversation switch flips the open thread only, in memory, and a
  newly chosen default replaces that flip. The switch is two shared icon
  buttons so the toolbar keeps one button size; the current view is a fill plus
  `aria-pressed`.
- Transcript. Each email is a bubble holding only what its sender newly wrote.
  The signed-in address sits on the right, everyone else on the left. With three
  or more participants each run carries a name and initials; with two, names are
  for screen readers only. Consecutive emails from one sender within five
  minutes form one run with one time line, and a day separator starts each
  local day.
- Bubbles are fills with no border, side rail or shadow: `--muted` for
  everyone else, and the quiet green `--bubble-own` with `--bubble-own-fg` text
  for the reader's own messages. In the dark theme that pair is the green
  accent surface; the light accent is neutral, so the light theme has its own
  tint. Message text, muted text and reply references inside an own bubble hold
  4.5:1 or better in both themes (tested from the tokens). Side and name carry
  the sender, so the tint is never the only signal.
- Side and width. No message spans the column: a bubble, and a message the
  standard reader shows inside a chat, is at most the 72ch measure or 85% of
  the column, whichever is smaller, on its sender's side. The standard reader's
  bubble is filled edge to edge by a painted sender canvas, and by `--muted`
  when the sender paints none.
- Content. Bubbles render a block model (heading, paragraph, list, quote,
  image, code, rule, quoted history) as React elements in app type. No message
  markup is injected: content always passes the sanitizer first, links keep the
  reader's new-tab, no-opener, no-referrer handling and the target preview, and
  images stay behind the same consent and signed proxy as the standard reader.
- Never hide silently. A forwarded message, or a message with nothing new left
  once repeats are folded, is shown in full with a "Quoted text" disclosure
  that starts open. "Show original" on every run opens those emails
  in the standard reader inside the stream; it is held in memory only.
- Thread pass. A bubble keeps only what the thread has not already shown,
  matched on a fingerprint of the normalised text. Only a trailing run that
  repeats an earlier message is folded; a trailing quote of something the
  thread has not shown stays behind a closed "Quoted text" disclosure.
  Signatures (a `-- ` line, the mail client's own signature marker, or a closing
  block with a name line, two contact lines and a phone number or email
  address, whether those lines share one block or a table layout gave each its
  own) are left out, unless text follows them. A closing list of links is
  content and stays. A quote header ("On Mon, Ines wrote:", Outlook's
  From/Sent group) is dropped only where a header sits: opening the history or
  directly above a quote. Unquoted lines after a quote, in plain text too, are
  new text. A test over the fixture corpus checks that every new word of every
  message is on screen or the message is shown whole.
- Reply references. An answer written between or below quoted lines is shown
  under a small filled reference to the line it answers, credited to whoever
  wrote that line when the thread knows. A quote the thread has not shown stays
  in full. References are fills, never a bar down one side.
- System lines. Centred, muted lines between runs say what email hides in
  headers: who was added, who was moved from To to Cc, and a changed subject.
  They come only from comparing To, Cc and the subject of consecutive
  messages; a plain reply-all moves nobody.
- Attachments are chips in the bubble; calendar invitations are cards in the
  stream.
- Designed mail (newsletters, receipts, notifications) is an article card in
  the stream: a uniform one-pixel border, the 72ch measure, app typography. A
  thread that is only designed mail opens as an article, with no card border,
  day separators, participants line or chat input.
- Signed mail is a message. A person's words above a small table that only
  signs them (a portrait, a name, contact lines) are prose, in both readers. An
  opt-out link or header on such mail counts as one bulk signal, not two, so it
  stays a bubble unless it is also built like a newsletter.
- Clean pipeline. Classify on body signals (unsubscribe links, link
  density, images per text, table nesting and `role=presentation`); strip
  preheaders, hidden and zero-size content, tracking pixels and spacers, and a
  stylesheet-hidden copy only when the same text remains elsewhere; read layout
  tables in row order; normalise to the block model. Large styled lines become
  headings and filled links become call-to-action buttons in `--primary`.
- Data tables. A table is data only if its author marked it (`th`, `thead`,
  `caption`) or it is a regular grid of short text cells; it is then kept as a
  table that scrolls sideways rather than squeezing. A table that holds other
  tables, or is `role=presentation`, is layout and is read in row order. A
  table with merged cells (`colspan`, `rowspan`) is never kept as a table; if
  its author marked it as data the message keeps the standard reader.
- Boilerplate. Navigation rows, social rows and footers fold into one
  disclosure at the end of the article, labelled with what it holds ("Footer,
  6 links including Unsubscribe"). Blocks are scored on legal wording, a short
  row of links, and position; nothing is deleted, so unsubscribe stays
  reachable. A call to action is never folded, and neither is a block that
  holds a short numeric code.
- Confidence gate. The clean result is used only when it retains the visible
  text (score 0.85 or more). A marked data table that cannot be kept as a
  table, or content that is mostly images, drops the score, and the message
  keeps the standard reader. Nothing is hidden silently.
- Headers. Only while this view shows a thread, the server reports which of its
  messages carry a `List-Unsubscribe` header, as message ids. Header values are
  untrusted and are never stored, logged or sent to the browser. The header
  counts like an unsubscribe link in the body; if the lookup fails, bodies
  alone decide. The standard reader never requests headers. The answer is a
  query keyed by account and thread (`mailKeys.threadListUnsubscribe`) and kept
  for the session, so a thread asks once.
- Layout. In this view the thread display menu offers Clean or Original for
  designed mail; `emailLayoutMode: 'clean'` is stored for the former. The
  standard reader, and any older build, lays a stored `clean` out as Readable.
- Replying. A pinned input after the transcript names every recipient, taken
  from the same functions the composer is opened with, so the two can never
  disagree. The reply-all flow addresses everyone in To and sends no Cc, and the
  bar says so; a long list shows three names and a count that expands. It
  defaults to reply-all, offers "Reply only to …" as an explicit choice in a
  group, and opens the existing composer, where Cc and Bcc are edited and the
  message is sent. Narrow screens keep their one bottom surface: the input is
  hidden there and the bottom bar's Reply, Reply all and Forward remain.
- First render and identity. The saved view is read synchronously, so a thread
  opens straight into it. While it is unknown (server render and hydration) the
  messages are the thread skeleton's placeholder block, never a guess. The
  transcript shows that same block while its one request, the header lookup,
  is pending for a thread it has not seen, so a message is never painted as a
  bubble and then re-drawn as an article, and nothing shifts when it arrives.
  The per-thread flip,
  "Show original" and the reply choice live under the thread's identity
  (`useIdentityState`), so nothing set on one thread shows on another.

## Icon controls

- Compact navigation and familiar toolbar actions use icons without repeated
  visible labels when the icon remains unambiguous in context.
- Every icon-only control keeps an explicit accessible name, visible keyboard
  focus, and a minimum 44 CSS-pixel touch target. A hover `title` may supplement
  the accessible name but never replaces it.
- Keep visible text for ambiguous actions, primary submission, destructive
  confirmation, dynamic destinations, and status or error communication.

## Context menus

Right-click menus use `src/shared/components/ui/context-menu.tsx`, the shadcn
Context Menu on the Radix primitives the other shared components use.

1. Where. Thread and draft rows in a folder and in search results; the header
   row of a message in the reader; a message bubble or article card in the
   Conversation view (not its reply bar or view switch); custom labels in the
   mail sidebar; calendar event chips, mobile agenda rows, empty time slots
   and the rows of the calendar list; contact rows and the header of a contact
   page. Nothing else gets one without a change to this list.
2. Mirror, never add. A menu holds only what its surface already does through
   a toolbar, a button, a dialog or a shortcut, and calls the same mutation or
   navigation. An action that exists but is unavailable is shown disabled, not
   hidden. A shortcut is shown beside an item only when that shortcut performs
   the item for the same row: the reader's R, E, #, S and U appear only on the
   row of the conversation open in that reader.
3. Destructive items. They use the destructive variant with an icon and go
   through the confirmation the surface already has: the item opens that
   confirmation and never deletes by itself. Where the surface has no
   confirmation today (move a thread to Trash, discard a draft), neither does
   the menu.
4. The row it was opened on. A menu acts on its own row and leaves the
   selection and the open conversation, event or contact alone, unless the
   action removes the item that is open. With the keyboard, the ContextMenu key
   or Shift+F10 opens the menu of the focused or cursored row. Menu state
   lives under the row's identity (clause 6 of "Content-ready transitions").
5. The browser's menu stays wherever people need it: inside rendered email
   (`<ownmail-email>` and plain-text bodies), in inputs, textareas, selects and
   editable content, on any text selection that reaches into the trigger, on
   links and images inside a Conversation bubble or article card, and on every
   surface not listed above. A trigger is the row, header or bubble itself and
   never contains rendered sender HTML.
6. Failures are said, on the item. A menu action that fails is reported the
   way its surface reports failures, tied to the item it was for: "Action
   failed" inside the mail row, the composer's wording inside the draft row,
   and a grid notice that names the event for a calendar answer. It never
   appears on another row.
7. Calendar pointer rules. A right-click or Control-click never starts, ends
   or cancels a drag, and opening an event's menu does not select the event or
   open it in the detail pane; "Open" does what a click does. The rule that
   makes an event read-only for dragging disables Edit and Delete. A
   colleague's busy block has no menu: it takes no pointer events, so the slot
   beneath it answers.
8. Look and input. Menus are panel glass ("Glass layer"), like the other
   menus: one surface, uniform 1px border and radius. Items are `menuitem`s with roving focus, 32px
   high with a fine pointer and 44px on narrow and touch screens. Escape closes
   the menu and returns focus to the row. A touch long press opens it. Keys,
   clicks and touches inside a menu do not reach the page shortcuts or
   gestures behind it. Menus do not animate.

## Shape

1. Two radii carry the layers: 6px (`--radius`) for the plane and its controls,
   12px (`--glass-radius`) for panel glass.
2. Full-width rows and bars that run edge to edge are square.
3. A shape inside another uses the outer radius minus the gap between them,
   never less than 2px: a focus ring inset 4px inside a 12px panel is 8px; a
   key hint inside a button is 3px.
4. Fully round is kept for identity: avatars, dots, label chips and counts.
   Buttons are never fully round.

## Borders and accents

1. Banned. Any border whose width or colour differs from the other sides as an
   accent: `border-l-4`, `border-l-primary`, CSS `border-left` of 2px or more,
   on any side.
2. Banned. Simulated rails: one-sided inset shadows, and `::before`, `::after`
   or absolutely positioned bars 2 to 4px thick along an edge.
3. Allowed. A uniform 1px border on all sides, full-length 1px separators in
   `--border` (or `--glass-line` on the content edge of a pinned glass bar),
   and uniform rings and outlines.
4. Use instead. Severity: uniform border, tint and glyph. Selection: fill and
   ARIA state. Keyboard cursor: uniform 2px ring. Category: dot, swatch or full
   tint. Quotation: indent and muted text, or a disclosure. System card: icon
   tile and label.
5. Never colour alone. Pair every state with a glyph, text, weight or ARIA
   attribute.

### Enforcement

`pnpm lint` runs `scripts/check-ownmail-accent-rails.mjs` over `src`, excluding
tests, email fixtures and the dev mock emails. It parses lengths (px, rem and em
at 16px) and compares them numerically. It rejects:

- A border on one side or one axis that is 2px or wider, or in a colour other
  than the separator tokens: `border-left` and the other physical and logical
  sides, `border-inline`, `border-block`, their `-width` and `-color`
  longhands, `border-width` when its sides differ, and the Tailwind forms
  (`border-l-4`, `border-s-[0.25rem]`, `border-x-2`, `border-l-primary`).
- An inset shadow with any offset and no blur, in CSS or as
  `shadow-[inset_…]`. Uniform rings (`inset 0 0 0 1px`) pass.
- A CSS pseudo-element or absolutely positioned box that is 2 to 4px thick in
  exactly one dimension.
- A full-width colour strip built from Tailwind utilities on one line (`h-0.5`,
  `h-1` or `h-1.5` with `w-full` or `inset-x-0` and a fill).

A one-sided width or inset offset the check cannot evaluate (`var()`, `calc()`)
is rejected too. It is the only case that may be vouched for, with a comment
on the same or the previous line: `accent-rails-allow: <reason>`.

Known blind spots, which need review instead:

- Class lists assembled across several lines or from variables and helpers, so
  the utilities never appear together or literally (`cn(side, width)`).
- Values that come from variables: a custom property that resolves to a wide
  border, a Tailwind theme value, or an inline style built at runtime.
- Bars built from Tailwind utilities other than the full-width strip above
  (for example `absolute left-0 w-0.5 h-4`), and bars positioned with
  `fixed`, `sticky` or layout rather than `absolute` or a pseudo-element.
- Units the check does not convert (`%`, `vw`, `ch`) and `em` on text that is
  not 16px.
- Gradients, images, outlines and `clip-path` used to draw an edge, and a
  uniform `border` whose sides are then recoloured by a separate
  `border-color` shorthand.

## Glass layer

The plane is flat. Glass is one extra layer with one meaning: this surface
floats above the plane, and content passes beneath it. If nothing can ever be
behind a surface, it is not glass.

| Layer | What it is | Treatment |
| --- | --- | --- |
| Plane | Lists, panes, sidebars, the calendar grid, cards in the flow, email content | Opaque. 1px lines. No shadow. 6px radius |
| Bar glass | Pinned bars that content scrolls under | Translucent with blur. One line on the content edge. No shadow. Square, edge to edge |
| Panel glass | Things that open over the plane and close again | Translucent with blur. Uniform 1px border, one soft shadow, 12px radius |

1. Glass means floating. Use it only on a surface that sits above the plane
   with content beneath it. Content itself, and anything in the flow of a page,
   is flat and opaque.
2. One layer deep. Glass never sits on glass. A menu opened from a glass bar is
   a panel over the plane, not a second sheet of glass stacked on the first. At
   most three glass surfaces are visible at once.
3. Neutral only. No tinted glass, gradients, glows, noise or highlights. Colour
   stays where it has meaning: actions, events, status.
4. Uniform edges. Panels get a uniform 1px border. No bright top edge, which
   would be an accent rail by another name ("Borders and accents").
5. Same identity beneath. Glass may only show content that belongs to the
   current screen. It is never a cover during a transition ("Content-ready
   transitions").
6. Readable on anything. Text and icons on glass meet 4.5:1 against the worst
   backdrop. Glass falls back to solid `--card` when the browser lacks
   `backdrop-filter`, and when the person prefers reduced transparency or more
   contrast, or uses forced colours.
7. Still on the grid. Glass surfaces follow the spacing scale and align to the
   same gutters as the plane ("Spacing"). Only opacity and position animate,
   never the blur.

### Tokens

Subtle means high opacity. The surface is mostly solid, so text contrast holds
whatever is behind it; the blur only lets colour and movement through.

| Token | Light | Dark | Note |
| --- | --- | --- | --- |
| `--glass-bg` | `--card` at 85% | `--card` at 89% | The lowest values that meet clause 6, measured in the app: muted text is 4.59:1 over black (light) and 4.61:1 over white (dark). One step lower fails (4.46 and 4.43), as did the first proposal of 78% and 84% (3.83 and 3.86) |
| `--glass-blur` | 14px | 14px | With saturation 1.15. One value everywhere |
| `--glass-line` | `--foreground` at 10% | white at 12% | Uniform border on panels; single edge line on bars |
| `--glass-shadow` | 0 8px 24px, 12% | 0 8px 24px, 40% | Panels only. The one shadow a floating surface uses |
| `--glass-radius` | 12px | 12px | Panels only. The plane keeps 6px, so shape also tells the layers apart |

Reduced-transparency detection is not supported in every browser, so the
high-opacity floor is the real safeguard.

The floor is set by muted text, the weakest neutral on glass. Red status text
is weaker still, so inside a glass surface `--destructive` is one step stronger
(`oklch(0.5 0.2 25)` light, `oklch(0.69 0.19 25)` dark), which keeps it at
4.5:1 over the worst backdrop without raising the opacity for everything.

### Where each surface lands

| Layer | Surfaces |
| --- | --- |
| Bar glass | Reader toolbar and mail list toolbar (folder and search); calendar day header with the all-day band; mobile tab bar |
| Panel glass | Menus and popovers (reading pane, list density, thread display, message actions, account menu in the app rail, message details, recipient suggestions, Meet with suggestions, select lists, context menus, the calendar's grid zoom and second time zone popovers); command palette; the anchored new-event composer; a calendar event while it is being dragged |
| Stays flat | List rows, message bodies, the invitation card and every card in the flow, sidebars and the app rail, the calendar grid and events, the calendar detail pane, busy blocks, Conversation bubbles and article cards, settings, modal dialogs and the compose window (workspaces behind a dimmed scrim, which does not blur, with nothing to see through), mobile sheets, tooltips, and the reply bar in Conversation view (solid everywhere: with both toolbars glass, a glass reply bar would be a fourth surface whenever a menu opens, past the three-surface limit) |
| Never glass | The account-switch loader and any other transition cover |

Glass over designed email is accepted: the toolbar stays glass above every
message, and the high opacity keeps a sender's colour faint.

### The two recipes

`.glass-bar` and `.glass-panel` in `src/styles.css` are the only places a
blurred backdrop is declared; `src/shared/components/ui/glass.tsx` names them
for components. A surface adopts glass by adding one class and positioning
itself.

- Bar glass. `Toolbar pinned` floats the toolbar over its pane, and the scroll
  region beneath takes `under-pinned-bar`: padding equal to the bar keeps the
  first line where a flat toolbar would put it, and scroll padding keeps
  keyboard focus and `scrollIntoView` clear of the bar. Regions that run under
  the mobile tab bar take `under-mobile-bar` the same way. A bar pinned to the
  bottom sets `data-glass-edge="top"` so its one line is the top edge.
- The blur of a bar sits on a layer behind the bar's content, not on the bar
  element, so a menu that opens from a bar blurs the plane beneath it.
- Panel glass. A panel that sits in the flow on a phone and floats from `sm` up
  adds `glass-panel-from-sm`, which keeps it flat where it does not float.
- A panel opened over glass is solid: a select list or suggestions in the
  new-event composer, or a context menu on an all-day event in the glass day
  header. `GlassPanelScope` marks the glass, and `useGlassPanelProps` gives
  what opens from it `data-glass="solid"`. The shared select, recipient
  suggestions and context menu use it, so they follow the rule wherever they
  are placed.
- A dragged calendar event takes `glass-panel` for as long as it is dragged. It
  is neutral glass at full strength (no dimming, no calendar tint), so its text
  stays legible over whatever it crosses; it is flat again when dropped.

### Enforcement

`pnpm lint` runs `scripts/check-ownmail-glass.mjs` over `src`, excluding tests,
email fixtures and the dev mock emails. It rejects:

- `backdrop-filter` (or `-webkit-backdrop-filter`) with any value but `none` in
  a CSS rule whose selector is not one of the two recipes.
- The Tailwind backdrop utilities (`backdrop-blur-*`, `backdrop-saturate-*` and
  the rest), an arbitrary `[backdrop-filter:…]` property, and an inline
  `backdropFilter` style in components.
- A `transition`, `animation` or `will-change` that names `backdrop-filter`.

Review covers what the check cannot see: that a glass surface really has
content beneath it, that no more than three are visible at once, and that
nothing tints or decorates the glass.

## Mobile surface rules

- Honor top, inline, and bottom safe areas without padding the global `body`.
- Bottom actions share `--mobile-tab-bar-height` and `--safe-area-bottom`.
- Exactly one mobile bottom surface is visible at a time; contextual actions
  replace primary tabs and suppress competing floating actions.
- App scroll belongs to explicit content regions, not the document.
- Sheets and full-screen editors use `dvh` and remain usable above the software
  keyboard.
- Verify 320, 375, 414, 640, 767, and 768 CSS-pixel widths with no horizontal
  overflow. The 640 and 767 checks protect the final mobile breakpoint before
  desktop chrome takes over.

## Mobile interaction contract

This contract is normative for application-owned UI. It intentionally uses the
44 CSS-pixel enhanced target size as the product floor rather than relying on
the smaller WCAG 2.2 AA minimum.

- Every touch-reachable control has an effective target at least 44 by 44 CSS
  pixels. Primary navigation, menu, picker, and result rows are at least 48
  pixels high. A compact glyph may remain 16–20 pixels inside that target.
- The floor applies to mobile layouts and to touch-capable hybrid/tablet input.
  Targets may not overlap, and spacing alone does not excuse an undersized
  application control.
- Semantic activation uses `click`; pointer- or mouse-down handlers may only
  prevent blur or provide supplementary feedback. Enter and Space must perform
  the same action as a tap where the element's native role requires it.
- Icon-only controls have an accessible name. Disclosures, selections, busy
  actions, validation, and expanded surfaces expose their current state through
  native semantics or ARIA.
- Keyboard focus uses an immediate, visible two-pixel treatment with at least
  3:1 contrast against adjacent colors. Removing an outline requires an equal
  or stronger replacement on the same focusable surface.
- Editable controls remain at least 16 pixels in type, use stable labels and
  helper/error space, set `aria-invalid` and `aria-describedby` when invalid,
  and announce submitted errors without exposing internal details.
- Overlays use dynamic viewport units, all four safe-area insets, an explicit
  close path, focus containment when modal, and focus restoration on dismissal.
- Visible action labels stay on one line. At narrow widths, actions may become
  icon-only with an accessible name or stack to full-width rows rather than
  wrap or overflow.
- Sanitized sender-authored email links are the sole target-size exemption.
  They retain readable scaling, underlines, safe navigation, and visible focus;
  application-added controls inside message content are not exempt.

## CTA voice

- Primary submission (Send, Save in an editor): compact filled action with a
  specific verb.
- Module create action (Compose, New event, New contact): `PrimaryAction`, the
  first thing in the module's sidebar. A 36px outline in `--cta-line` with the
  accent only on its icon (`--cta-icon`), foreground text at medium weight, and
  its shortcut as plain muted text at the end. The shortcut hint is hidden on
  touch-first devices. When the sidebar is hidden, an icon-only version sits
  in the top bar.
- Secondary: quiet border or text action.
- Labels remain one line and keep their accessible name when icon-only.

## Per-page allowances

- App pages use no decorative enrichment; function carries the surface.
- Glass is permitted only as a layer signal: it marks a surface that floats
  over content. It is never decoration.
- Calendar colours each event by its calendar. The hue comes from the
  calendar's own `hex_color`, accepted only as an exact `#rrggbb` value, with
  lightness and chroma clamped per theme (`EVENT_COLOR_LIMITS`) so foreground
  text on the tint stays at 4.5:1 or better. The four named event tokens
  (`--event-blue`, `--event-teal`, `--event-amber`, `--event-rose`) are the
  fallback for a calendar with no valid colour. No other hue source is allowed:
  an event's title never changes its colour.
- Calendar events are a tinted fill (30% of the hue over `--card`) with a
  uniform one-pixel border in the same hue (`.event-chip`). One-sided accent
  bars, single-edge borders, and inset rail shadows are not used. The sidebar
  swatch carries the colour key.
- RSVP state, hidden calendars, and past events never rely on colour alone:
  tentative and unanswered events use a dashed outline, declined events add a
  strikethrough, each state is part of the accessible name, and a hidden
  calendar is labelled "hidden".
- `--today` and `--today-fg` mark the current day: the date pill, the
  mini-month marker, and the now line. `--primary` stays the action colour and
  `--destructive` stays reserved for errors, so neither is used for "today".
  The pair holds 4.5:1 text contrast in both themes.
- The day and week grid has four zoom steps: an hour is 40, 52 (default), 64 or
  80 pixels tall, a device preference. Every hour row, event box, and the now
  line derive from that one value, and a zoom change keeps the hour at the top
  of the viewport in place. The control sits at the right of the day header in
  its own 44-pixel grid track, shared by the header and the body so their
  columns stay aligned, and names the current step in text.
- The time gutter's head is a button naming the zone or zones shown. It opens a
  small non-modal popover to add, change, or remove the second time zone; the
  value is validated before it is stored and can never equal the primary zone.
  With a second zone, the gutter shows two columns, each headed by its city:
  the second zone with its offset from the first ("Lisbon +5h"), the first with
  its abbreviation ("Toronto EDT"). Hours before 7 AM and from 10 PM in the
  second zone are shaded and say so in their name, its hour labels mark the
  day where it crosses midnight, and the now line shows the current time in
  both columns. The popover lists each zone with its local time and offset.
- The desktop calendar sidebar collapses from a quiet toggle in the mini-month
  header, remembered per device. When it is collapsed, the start of the top bar
  shows the toggle to bring it back and an icon-only New event action. The
  toggle's name and `aria-expanded` carry the state; mobile keeps the sidebar
  in its sheet.
- Calendar popovers are non-modal: they take focus on open, close on Escape
  (returning focus to the trigger), on a click elsewhere, and when keyboard
  focus leaves.
- Viewing an event is separate from editing it. On desktop layouts an event
  opens in a details pane to the right of the grid: content in the flow, not an
  overlay, with a show and hide toggle at the end of the top bar; whether it is
  open is a device preference, and the pending view reserves it. Opening moves
  focus into the pane, Escape or its close button hands focus back to the
  event, and the shown event carries `aria-current` and a uniform ring. Mobile
  layouts keep the bottom sheet. Both render the same read-only view; Edit
  opens the editor, which is the only place an event's fields change.
- Events in the day and week grid can be created, moved and resized by
  dragging with a mouse, snapped to 15 minutes. Nothing is saved until the
  drop: releasing outside the grid, pressing Escape, or losing the pointer
  cancels. A drop updates the grid at once and is put back, with a visible
  generic message, if the provider refuses it.
- Every drag has a keyboard path. Creating: Enter on an hour slot opens the
  editor. Moving: Alt with an arrow key (15 minutes, or one day). Resizing:
  Shift and Alt with Up or Down. The adjustment is previewed and announced,
  Enter saves it once, and Escape or moving focus away abandons it. Each event
  box describes this through `aria-describedby`.
- Touch and pen never start a drag, so the grid keeps scrolling; they change an
  event's day and times in the editor. Read-only events, and events on
  read-only calendars, cannot be moved or resized. A repeating occurrence moves
  alone and the calendar says so; a series shown as one event cannot be dragged.
  All-day events are not moved or resized in the time grid. Resize edges are
  unfilled pointer areas, never a drawn bar.
- A drag follows the pointer with no animation of its own, so reduced motion
  needs nothing more than the global transition rule.
- "Meet with…" overlays colleagues' busy times on the day and week grid. Each
  busy period is a hatched tint with a uniform one-pixel border in that
  person's hue (`.busy-block`), labelled with the person's name and laid out
  beside the person's own events by the same column layout, never over them.
  The blocks are decorative: they take no pointer or focus, so the hour slots
  beneath stay usable. The sidebar legend carries the key (swatch, name, and
  the state in words: busy times, none, not shared, or loading) and lists the
  same times as text for assistive technology. Hatching and the name, not hue
  alone, set a busy block apart from an event.
- Availability is privacy-bounded: only busy and free times are requested,
  never event details; at most five people and ten days per lookup; the chosen
  people live in the page, belong to the inbox they were chosen in, and are
  not stored. Lookups wait for the choice to settle and are cached per account,
  range and guest list; a range not looked up yet shows no blocks rather than
  the previous range's. A failure or rate limit shows one generic message with
  an explicit "Try again".
- Email content may preserve sender styling inside the sanitizer-controlled
  message boundary; application chrome remains on this system.

## What pages must share

- Palette, typography, touch-target floor, focus treatment, safe-area contract,
  bottom tabs, sheet behavior, and restrained motion.

## What pages may differ on

- Information density, contextual actions, and whether a mobile workflow uses a
  bottom sheet or a full-screen editor.

## Exports

The canonical CSS and Tailwind v4 exports are in `src/tokens.css`. Its `:root`
and `.dark` blocks also map directly to shadcn/ui variable names already used by
the shared primitives.
