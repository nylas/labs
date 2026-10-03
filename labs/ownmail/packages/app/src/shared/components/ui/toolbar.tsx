import type * as React from 'react'
import { TOOLBAR_HEIGHT_CLASS } from '#app/config/layout'
import { cn } from '#shared/lib/utils'
import { GLASS_BAR_CLASS } from './glass.js'

/**
 * The top row of a pane: one height everywhere, with a separator beneath it.
 * `pinned` floats it over the pane as bar glass, so the scroll region beneath
 * (marked `under-pinned-bar`) runs under it; the pane must be `relative`.
 */
export function Toolbar({
	className,
	pinned = false,
	...props
}: React.ComponentProps<'div'> & { pinned?: boolean }) {
	return (
		<div
			data-slot="toolbar"
			className={cn(
				'flex shrink-0 items-center border-b border-border',
				TOOLBAR_HEIGHT_CLASS,
				pinned && ['absolute inset-x-0 top-0 z-40', GLASS_BAR_CLASS],
				className,
			)}
			{...props}
		/>
	)
}

/** Divides a toolbar's groups of actions, such as the reader's triage, view and respond groups. */
export function ToolbarSeparator({ className }: { className?: string }) {
	return (
		<hr
			aria-orientation="vertical"
			className={cn('mx-cluster h-5 w-px shrink-0 border-0 bg-border', className)}
		/>
	)
}
