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

- Display: Manrope, variable weight 200–800.
- Body: Poppins, weights 400–700.
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

The desktop toolbar height is 44px, defined once in `src/app/config/layout.ts`.
`pnpm lint` reports the number of half-step and arbitrary spacing values outside
`src/shared/components/ui` through `scripts/check-ownmail-spacing.mjs`; it is a
warning while existing screens are migrated.

## Motion

- Enter: `--ease-out`; exit: `--ease-in`; state changes: `--ease-in-out`.
- Micro feedback: `--dur-fast`; sheets and route surfaces: `--dur-medium`.
- Animate transform and opacity only for spatial transitions.
- Reduced motion removes spatial movement and keeps functional feedback.

## Microinteractions stance

- Silent success when the result is already visible.
- Optimistic state with generic rollback errors.
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
- The unread dot is an in-flow leading cell centred in the row's 16-pixel left
  padding, so row text keeps the left edge it shares with the list title.
  The star's hit target is sized per density so it never extends into a
  neighbouring row.

## Reading

The subject is set at body size (16px Poppins semibold) and scrolls with the
conversation as its first line. On desktop one row is pinned, the 44px toolbar,
which also carries the thread's display actions; the reply field follows the
last message. Message bodies default to 16px with a 1.6 line-height, which a
sender's own styles override, and prose is held to a 72ch measure. Designed
(table or layout) mail keeps the full column.

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
- Bubbles are fills (`--muted`, and a `--primary` tint for the reader's own
  messages) with no border, side rail or shadow. Side and name carry the
  sender, so the tint is never the only signal.
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
  block of contact details) are left out, unless text follows them.
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
- Clean pipeline. Classify on body signals only (unsubscribe links, link
  density, images per text, table nesting and `role=presentation`); strip
  preheaders, hidden and zero-size content, tracking pixels and spacers, and a
  stylesheet-hidden copy only when the same text remains elsewhere; read layout
  tables in row order; normalise to the block model. Large styled lines become
  headings and filled links become call-to-action buttons in `--primary`.
- Confidence gate. The clean result is used only when it retains the visible
  text (score 0.85 or more). A data table (`th`, `thead`, `caption`) or content
  that is mostly images drops the score, and the message keeps the standard
  reader. Nothing is hidden silently.
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
  transcript is computed from the loaded thread with no request of its own, so
  it has no pending state after the thread skeleton. The per-thread flip,
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

## Borders and accents

1. Banned. Any border whose width or colour differs from the other sides as an
   accent: `border-l-4`, `border-l-primary`, CSS `border-left` of 2px or more,
   on any side.
2. Banned. Simulated rails: one-sided inset shadows, and `::before`, `::after`
   or absolutely positioned bars 2 to 4px thick along an edge.
3. Allowed. A uniform 1px border on all sides, full-length 1px separators in
   `--border`, and uniform rings and outlines.
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

- Primary: compact filled action with a specific verb.
- Secondary: quiet border or text action.
- Labels remain one line and keep their accessible name when icon-only.

## Per-page allowances

- App pages use no decorative enrichment; function carries the surface.
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
- The desktop calendar sidebar collapses from a toggle at the start of the top
  bar, remembered per device. The toggle's name and `aria-expanded` carry the
  state; mobile keeps the sidebar in its sheet.
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
