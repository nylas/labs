import type * as React from 'react'
import { cn } from '#shared/lib/utils'

/** A divided block inside page content: the same space on both sides of its separator. */
export function Section({ className, ...props }: React.ComponentProps<'div'>) {
	return (
		<div
			data-slot="section"
			className={cn('mt-section border-t border-border pt-section', className)}
			{...props}
		/>
	)
}
