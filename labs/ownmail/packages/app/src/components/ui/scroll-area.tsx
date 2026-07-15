import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'
import type * as React from 'react'
import { useId } from 'react'
import { cn } from '../../lib/utils.js'

type ScrollAreaProps = React.ComponentProps<typeof ScrollAreaPrimitive.Root> & {
	viewportClassName?: string
	viewportRef?: React.Ref<HTMLDivElement>
}

/**
 * shadcn-style scroll container that keeps the browser scrollbar out of the
 * resting UI while retaining keyboard access and a visible affordance.
 */
export function ScrollArea({
	className,
	viewportClassName,
	viewportRef,
	children,
	'aria-describedby': ariaDescribedBy,
	...props
}: ScrollAreaProps) {
	const descriptionId = useId()
	const describedBy = [ariaDescribedBy, descriptionId].filter(Boolean).join(' ')

	return (
		<ScrollAreaPrimitive.Root
			data-slot="scroll-area"
			aria-describedby={describedBy}
			className={cn('group relative overflow-hidden', className)}
			{...props}
		>
			<ScrollAreaPrimitive.Viewport
				ref={viewportRef}
				data-slot="scroll-area-viewport"
				className={cn('size-full rounded-[inherit] focus-visible:outline-none', viewportClassName)}
			>
				{children}
			</ScrollAreaPrimitive.Viewport>
			<div
				aria-hidden="true"
				className="pointer-events-none absolute inset-x-0 top-0 z-20 h-5 bg-linear-to-b from-background/80 to-transparent"
			/>
			<div
				aria-hidden="true"
				className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-5 bg-linear-to-t from-background/80 to-transparent"
			/>
			<span id={descriptionId} className="sr-only">
				Scrollable content. Use the mouse wheel, trackpad, Page Up, or Page Down to see more.
			</span>
			<ScrollAreaPrimitive.Scrollbar
				data-slot="scroll-area-scrollbar"
				orientation="vertical"
				className="z-30 flex w-2.5 touch-none p-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
			>
				<ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-border" />
			</ScrollAreaPrimitive.Scrollbar>
		</ScrollAreaPrimitive.Root>
	)
}
