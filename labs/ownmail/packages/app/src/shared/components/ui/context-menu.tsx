import * as ContextMenuPrimitive from '@radix-ui/react-context-menu'
import type * as React from 'react'
import { cn } from '#shared/lib/utils'

/**
 * The shadcn/ui Context Menu (Radix variant) on this app's tokens.
 * design.md, "Context menus", says where a menu may exist and what it may hold.
 */
export function ContextMenu(props: React.ComponentProps<typeof ContextMenuPrimitive.Root>) {
	return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />
}

/** Places that keep the browser's own menu even inside a trigger. */
const NATIVE_MENU_SELECTOR =
	'input, textarea, select, [contenteditable]:not([contenteditable="false"]), ownmail-email'

function insideNativeMenuArea(event: React.SyntheticEvent<HTMLElement>, alsoNative?: string): boolean {
	const selector = alsoNative ? `${NATIVE_MENU_SELECTOR}, ${alsoNative}` : NATIVE_MENU_SELECTOR
	return (event.target as Element).closest(selector) !== null
}

/** People need the browser's menu to copy a selection, follow a link inside an
 * email, or edit text, so those right-clicks are never taken over. */
function keepsNativeMenu(event: React.MouseEvent<HTMLElement>, alsoNative?: string): boolean {
	if (insideNativeMenuArea(event, alsoNative)) return true
	const selection = window.getSelection()
	return Boolean(
		selection &&
			!selection.isCollapsed &&
			selection.rangeCount > 0 &&
			selection.getRangeAt(0).intersectsNode(event.currentTarget),
	)
}

/**
 * The area that opens the menu: right-click, the ContextMenu key or Shift+F10
 * on a focused descendant, and a touch long press. Pass the existing row with
 * `asChild` so the trigger is that element, not a wrapper around it.
 *
 * The exemptions are decided in the capture phase and stop the event there,
 * so Radix never sees it and the browser's menu opens as usual.
 */
export function ContextMenuTrigger({
	onContextMenuCapture,
	onPointerDownCapture,
	keepNativeMenuOn,
	...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Trigger> & {
	/** Further targets inside this trigger that keep the browser's menu, e.g. the links and images of message text. */
	keepNativeMenuOn?: string
}) {
	return (
		<ContextMenuPrimitive.Trigger
			data-slot="context-menu-trigger"
			{...props}
			onContextMenuCapture={(event) => {
				onContextMenuCapture?.(event)
				if (keepsNativeMenu(event, keepNativeMenuOn)) event.stopPropagation()
			}}
			onPointerDownCapture={(event) => {
				onPointerDownCapture?.(event)
				// Radix starts its long-press timer on pointer down.
				if (insideNativeMenuArea(event, keepNativeMenuOn)) event.stopPropagation()
			}}
		/>
	)
}

/** The menu is portalled, but React still bubbles its events to the row's
 * ancestors: a click would reach a day cell, a key the grid, a touch the
 * pull-to-refresh. What happens inside the menu stays in the menu. */
function stopAtMenu(event: React.SyntheticEvent) {
	event.stopPropagation()
}

/**
 * Radix opens a context menu beside the pointer and flips it to the other side
 * when it does not fit, but never slides it sideways. On a phone neither side
 * may fit, so the `translate-x` classes pull the menu back inside the viewport
 * by exactly the amount it would overflow; they resolve to 0 when it fits.
 */
export function ContextMenuContent({
	className,
	collisionPadding = 8,
	...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Content>) {
	return (
		<ContextMenuPrimitive.Portal>
			<ContextMenuPrimitive.Content
				data-slot="context-menu-content"
				collisionPadding={collisionPadding}
				onClick={stopAtMenu}
				onKeyDown={stopAtMenu}
				onTouchStart={stopAtMenu}
				onTouchMove={stopAtMenu}
				onTouchEnd={stopAtMenu}
				className={cn(
					'z-50 max-h-(--radix-context-menu-content-available-height) min-w-52 origin-(--radix-context-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none data-[side=left]:translate-x-[max(0px,calc(100%-var(--radix-context-menu-content-available-width)))] data-[side=right]:translate-x-[min(0px,calc(var(--radix-context-menu-content-available-width)-100%))]',
					className,
				)}
				{...props}
			/>
		</ContextMenuPrimitive.Portal>
	)
}

/** `variant="destructive"` colours the item; give it an icon as well, so the
 * state never rests on colour alone. */
export function ContextMenuItem({
	className,
	variant = 'default',
	...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Item> & { variant?: 'default' | 'destructive' }) {
	return (
		<ContextMenuPrimitive.Item
			data-slot="context-menu-item"
			data-variant={variant}
			className={cn(
				'relative flex min-h-8 cursor-default items-center gap-2 whitespace-nowrap rounded-md px-2 py-1 text-sm outline-none select-none focus:bg-muted focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-11 [@media(any-pointer:coarse)]:min-h-11 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[variant=destructive]:text-destructive forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-solid [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground data-[variant=destructive]:[&_svg]:text-destructive',
				className,
			)}
			{...props}
		/>
	)
}

export function ContextMenuSeparator({
	className,
	...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) {
	return (
		<ContextMenuPrimitive.Separator
			data-slot="context-menu-separator"
			className={cn('-mx-1 my-1 h-px bg-border', className)}
			{...props}
		/>
	)
}

/** The keyboard shortcut that already performs the item's action. It is a
 * visual hint kept out of the item's name; put `aria-keyshortcuts` on the item. */
export function ContextMenuShortcut({
	className,
	children,
}: {
	className?: string
	children: React.ReactNode
}) {
	return (
		<span data-slot="context-menu-shortcut" aria-hidden="true" className={cn('ml-auto', className)}>
			<kbd className="kbd">{children}</kbd>
		</span>
	)
}
