import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'
import type * as React from 'react'
import { useCallback, useEffect, useId, useState } from 'react'
import { cn } from '../../lib/utils.js'

type ScrollAreaProps = React.ComponentProps<typeof ScrollAreaPrimitive.Root> & {
	viewportClassName?: string
	viewportRef?: React.Ref<HTMLDivElement>
}

type OverflowState = {
	top: boolean
	bottom: boolean
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
	type = 'hover',
	'aria-describedby': ariaDescribedBy,
	...props
}: ScrollAreaProps) {
	const descriptionId = useId()
	const describedBy = [ariaDescribedBy, descriptionId].filter(Boolean).join(' ')
	const [viewport, setViewport] = useState<HTMLDivElement | null>(null)
	const [overflow, setOverflow] = useState<OverflowState>({ top: false, bottom: false })

	const setViewportRef = useCallback(
		(node: HTMLDivElement | null) => {
			setViewport(node)
			if (typeof viewportRef === 'function') {
				viewportRef(node)
			} else if (viewportRef) {
				viewportRef.current = node
			}
		},
		[viewportRef],
	)

	useEffect(() => {
		if (!viewport) return

		const updateOverflow = () => {
			const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
			const nextOverflow = {
				top: viewport.scrollTop > 1,
				bottom: maxScrollTop - viewport.scrollTop > 1,
			}
			setOverflow((current) =>
				current.top === nextOverflow.top && current.bottom === nextOverflow.bottom ? current : nextOverflow,
			)
		}

		updateOverflow()
		viewport.addEventListener('scroll', updateOverflow, { passive: true })

		const resizeObserver =
			typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(updateOverflow)
		resizeObserver?.observe(viewport)
		for (const child of viewport.children) resizeObserver?.observe(child)

		const mutationObserver =
			typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(updateOverflow)
		mutationObserver?.observe(viewport, { childList: true, subtree: true, characterData: true })

		return () => {
			viewport.removeEventListener('scroll', updateOverflow)
			resizeObserver?.disconnect()
			mutationObserver?.disconnect()
		}
	}, [viewport])

	return (
		<ScrollAreaPrimitive.Root
			data-slot="scroll-area"
			aria-describedby={describedBy}
			className={cn('group relative w-full min-w-0 overflow-hidden', className)}
			type={type}
			{...props}
		>
			<ScrollAreaPrimitive.Viewport
				ref={setViewportRef}
				data-slot="scroll-area-viewport"
				tabIndex={0}
				className={cn(
					'size-full min-w-0 overflow-x-hidden rounded-[inherit] focus-visible:outline-none',
					viewportClassName,
				)}
			>
				{children}
			</ScrollAreaPrimitive.Viewport>
			<div
				aria-hidden="true"
				data-overflow-top={overflow.top ? '' : undefined}
				className={cn(
					'pointer-events-none absolute inset-x-0 top-0 z-20 h-5 bg-linear-to-b from-background/80 to-transparent transition-opacity',
					!overflow.top && 'opacity-0',
				)}
			/>
			<div
				aria-hidden="true"
				data-overflow-bottom={overflow.bottom ? '' : undefined}
				className={cn(
					'pointer-events-none absolute inset-x-0 bottom-0 z-20 h-5 bg-linear-to-t from-background/80 to-transparent transition-opacity',
					!overflow.bottom && 'opacity-0',
				)}
			/>
			<span id={descriptionId} className="sr-only">
				Scrollable content. Use the mouse wheel, trackpad, Page Up, or Page Down to see more.
			</span>
			<ScrollAreaPrimitive.Scrollbar
				data-slot="scroll-area-scrollbar"
				orientation="vertical"
				className="z-30 flex w-2.5 touch-none p-0.5 opacity-0 transition-opacity data-[state=visible]:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
			>
				<ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-border" />
			</ScrollAreaPrimitive.Scrollbar>
		</ScrollAreaPrimitive.Root>
	)
}
