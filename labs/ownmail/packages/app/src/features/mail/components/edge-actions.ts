/**
 * The small actions of the reader's edge states (design.md "Edge states"):
 * a quiet bordered button for the first choice, a borderless text action for
 * the rest, and an inline link. All are 26px on a fine pointer and keep the
 * 44px touch floor on touch-first devices and phones.
 */

const EDGE_ACTION_BASE =
	'inline-flex h-[26px] shrink-0 items-center justify-center gap-1 rounded-md px-2 text-xs whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60 max-md:min-h-11 [@media(any-pointer:coarse)]:min-h-11'

/** The first choice: a 1px `cta-line` outline on the card, semibold foreground text. */
export const EDGE_BUTTON_CLASS = `${EDGE_ACTION_BASE} border border-cta-line bg-card font-semibold text-foreground hover:bg-muted`

/** Every other choice: no border, medium quiet text. */
export const EDGE_GHOST_CLASS = `${EDGE_ACTION_BASE} bg-transparent font-medium text-quiet-foreground hover:bg-muted hover:text-foreground`

/** A destructive text action (Discard): the danger colour on the same ghost shape. */
export const EDGE_DANGER_GHOST_CLASS = `${EDGE_ACTION_BASE} bg-transparent font-medium text-danger-soft-foreground hover:bg-danger-soft`

/** An inline text link inside a sentence ("Show", "Open", "Earlier versions"). */
export const EDGE_LINK_CLASS =
	'inline-flex shrink-0 items-center rounded-sm text-xs font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-11 [@media(any-pointer:coarse)]:min-h-11'
