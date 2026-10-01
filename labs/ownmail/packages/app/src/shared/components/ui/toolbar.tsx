import type * as React from 'react'
import { TOOLBAR_HEIGHT_CLASS } from '#app/config/layout'
import { cn } from '#shared/lib/utils'

/** The top row of a pane: one height everywhere, with a separator beneath it. */
export function Toolbar({ className, ...props }: React.ComponentProps<'div'>) {
	return (
		<div
			data-slot="toolbar"
			className={cn('flex shrink-0 items-center border-b border-border', TOOLBAR_HEIGHT_CLASS, className)}
			{...props}
		/>
	)
}
