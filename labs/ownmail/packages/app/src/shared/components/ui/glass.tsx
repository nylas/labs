import type * as React from 'react'
import { createContext, useContext } from 'react'

/**
 * The glass layer (design.md "Glass layer"): the two recipes in `styles.css`
 * for a surface that floats above the plane with content beneath it. A surface
 * adopts one by adding the class; nothing else may blur what is behind it.
 */

/** A pinned bar that content scrolls under. The caller positions it (sticky, absolute or fixed). */
export const GLASS_BAR_CLASS = 'glass-bar'
/** Spread on a bar pinned to the bottom, whose content edge is its top. */
export const GLASS_BAR_BOTTOM_EDGE = { 'data-glass-edge': 'top' } as const
/** Something that opens over the plane and closes again: a menu, popover or palette. */
export const GLASS_PANEL_CLASS = 'glass-panel'
/** A panel that is in the flow below `sm` and floats, as glass, from `sm` up. */
export const GLASS_PANEL_FROM_SM_CLASS = 'glass-panel glass-panel-from-sm'
/** A scroll region or spacer that starts beneath a pinned top bar. */
export const UNDER_PINNED_BAR_CLASS = 'under-pinned-bar'
/** A scroll region or pane that runs beneath the mobile tab bar. */
export const UNDER_MOBILE_BAR_CLASS = 'under-mobile-bar'

const OnGlassPanel = createContext(false)

/** Marks its children as sitting on glass (a panel, or the content of a bar), so a panel
 * they open over it is solid: glass never sits on glass. */
export function GlassPanelScope({ children }: { children: React.ReactNode }) {
	return <OnGlassPanel value={true}>{children}</OnGlassPanel>
}

/** Props for a panel surface: glass over the plane, solid when opened from a glass panel. */
export function useGlassPanelProps(): { className: string; 'data-glass'?: 'solid' } {
	return useContext(OnGlassPanel)
		? { className: GLASS_PANEL_CLASS, 'data-glass': 'solid' }
		: { className: GLASS_PANEL_CLASS }
}
