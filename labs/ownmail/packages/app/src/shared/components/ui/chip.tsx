import type * as React from 'react'
import { cn } from '#shared/lib/utils'

/** A wrapping row of chips with the one shared gap. */
export function PillRow({ className, ...props }: React.ComponentProps<'div'>) {
	return (
		<div data-slot="pill-row" className={cn('flex min-w-0 flex-wrap gap-cluster', className)} {...props} />
	)
}

/**
 * A bordered pill. It has no vertical padding: a trailing `action` (an
 * `IconButton`) sets the height, so the pill stays at the 44px touch floor.
 */
export function Chip({
	className,
	children,
	action,
	...props
}: React.ComponentProps<'span'> & { action?: React.ReactNode }) {
	return (
		<span
			data-slot="chip"
			className={cn(
				'inline-flex min-h-11 max-w-full items-center gap-cluster rounded-lg border border-border bg-background px-hairline text-xs text-foreground',
				className,
			)}
			{...props}
		>
			{children}
			{action ? <span className="-mr-2 flex shrink-0">{action}</span> : null}
		</span>
	)
}
