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

Use Tailwind's four-point scale and the named safe-area/touch tokens in
`src/tokens.css`. Touch-reachable controls are at least 44 CSS pixels; primary
mobile rows prefer 48 pixels.

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

## Navigation

- Desktop: persistent application rail.
- Mobile: one persistent bottom surface. Mail, Calendar, Contacts, and Settings
  occupy it at top-level destinations; contextual workflows replace those items
  in the same surface instead of stacking a second bar above or below it.
- Contextual folders, calendars, mailboxes, theme, and command tools live in
  sheets rather than competing with primary destinations.

## Icon controls

- Compact navigation and familiar toolbar actions use icons without repeated
  visible labels when the icon remains unambiguous in context.
- Every icon-only control keeps an explicit accessible name, visible keyboard
  focus, and a minimum 44 CSS-pixel touch target. A hover `title` may supplement
  the accessible name but never replaces it.
- Keep visible text for ambiguous actions, primary submission, destructive
  confirmation, dynamic destinations, and status or error communication.

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
- Calendar may use event hues only through the named event tokens.
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
