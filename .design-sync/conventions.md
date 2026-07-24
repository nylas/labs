# OwnMail design system — building conventions

OwnMail is a shadcn/ui "new-york" component set styled with **Tailwind CSS v4** and
semantic design tokens. Components are imported from `window.OwnMail.*` (the bundle in
`_ds_bundle.js`). Build real mail/calendar/contacts UI by composing these components and
styling your own layout with the SAME token utilities the components use.

## Setup

- **No provider wrapper is required.** `Tooltip` bundles its own provider; `Dialog` and
  `Select` portal to `document.body` on their own.
- The only hard requirement is that the DS stylesheet is loaded — `styles.css` (it
  `@import`s the tokens and `_ds_bundle.css`). All colors/spacing come from CSS custom
  properties defined on `:root`.
- **Dark mode**: put `class="dark"` on an ancestor element (the tokens have a `.dark` set).

## Styling idiom — use the tokens, never raw hex

Components style themselves internally and accept a `className` that is merged with
`tailwind-merge`, so your utilities win on conflicts. Style your own layout glue with the
**semantic token utilities** below so everything stays on-brand (brand primary is a deep
green). Do NOT invent colors like `bg-[#1e5c3a]` — use the tokens:

| Role | Background | Text | Border |
|---|---|---|---|
| Primary (brand green) | `bg-primary` | `text-primary-foreground` | `border-primary` |
| Secondary | `bg-secondary` | `text-secondary-foreground` | — |
| Surface / cards | `bg-card`, `bg-popover` | `text-foreground` | `border-border` |
| Page | `bg-background` | `text-foreground` | — |
| Muted / subtle | `bg-muted` | `text-muted-foreground` | — |
| Accent (hover/active) | `bg-accent` | `text-accent-foreground` | — |
| Destructive | `bg-destructive` | `text-destructive`, `text-background` | — |
| Inputs | `bg-card` | — | `border-input` |

Components handle their own focus rings (they use `focus-visible:border-ring` +
`focus-visible:ring-ring/40`) — you rarely need to add ring utilities yourself.

Radius: `rounded-md` (controls/inputs), `rounded-lg`/`rounded-xl` (surfaces), `rounded-full`
(badges/avatars). Shadows: `shadow-xs` (controls), `shadow-md`/`shadow-2xl` (overlays).
Fonts: body text is **Poppins** by default (no class needed); add `font-display` for
**Manrope** headings. Both fonts ship in the bundle. Standard Tailwind utilities (`flex`,
`gap-*`, `px-*`, `text-sm`…) are available.

## Component APIs

Single components: `Button` (`variant`: default·destructive·outline·secondary·ghost·link;
`size`: default·sm·lg·icon), `Badge` (`variant`: default·secondary·destructive·outline),
`Input`, `Textarea`, `ScrollArea` (fixed-height scroll region — set a height on the wrapper).

Compound components — compose the parts (all on `window.OwnMail`):

- **Dialog**: `<Dialog open>` › `<DialogContent>` (portalled, centered surface) with a
  `<DialogTitle>` inside (required for a11y). Minimal set — add your own header/footer/close.
- **Select**: `<Select defaultValue>` › `<SelectTrigger><SelectValue/></SelectTrigger>` +
  `<SelectContent><SelectItem value>…</SelectItem></SelectContent>`.
- **Tooltip**: `<Tooltip>` › `<TooltipTrigger asChild>{trigger}</TooltipTrigger>` +
  `<TooltipContent>text</TooltipContent>`. Self-contained (no root provider needed).

The truth for any component is its bound `<Name>.d.ts` (props) and `<Name>.prompt.md`
(usage); the token values live in the bound `styles.css` and `_ds_bundle.css`.

## Idiomatic example

```tsx
const { Button, Badge } = window.OwnMail
function ThreadRow() {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
      <div>
        <div className="font-display text-sm font-semibold text-foreground">Ada Lovelace</div>
        <div className="text-xs text-muted-foreground">Re: Analytical Engine notes</div>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant="secondary">Draft</Badge>
        <Button size="sm">Reply</Button>
      </div>
    </div>
  )
}
```
