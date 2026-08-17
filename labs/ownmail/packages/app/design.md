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
- Mobile: persistent Mail, Calendar, Contacts, and Settings bottom tabs.
- Contextual folders, calendars, mailboxes, theme, and command tools live in
  sheets rather than competing with primary destinations.

## Mobile surface rules

- Honor top, inline, and bottom safe areas without padding the global `body`.
- Bottom actions share `--mobile-tab-bar-height` and `--safe-area-bottom`.
- App scroll belongs to explicit content regions, not the document.
- Sheets and full-screen editors use `dvh` and remain usable above the software
  keyboard.
- Verify 320, 375, 414, and 768 CSS-pixel widths with no horizontal overflow.

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
