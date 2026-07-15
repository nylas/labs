import type * as React from 'react'
import { useCallback, useEffect, useId, useState } from 'react'
import { cn } from '../../lib/utils.js'

type ScrollAreaProps = React.ComponentProps<'section'> & {
	viewportClassName?: string
	viewportRef?: React.Ref<HTMLElement>
}

type OverflowState = {
	top: boolean
	bottom: boolean
}

/**
 * A native shadcn-style scrolling region with directional overflow affordances.
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
	const [viewport, setViewport] = useState<HTMLElement | null>(null)
	const [overflow, setOverflow] = useState<OverflowState>({ top: false, bottom: false })

	const setViewportRef = useCallback(
		(node: HTMLElement | null) => {
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
		<section
			data-slot="scroll-area"
			aria-describedby={describedBy}
			ref={setViewportRef}
			// biome-ignore lint/a11y/noNoninteractiveTabindex: Native scroll regions must be keyboard focusable.
			tabIndex={0}
			className={cn(
				'group relative size-full min-w-0 overflow-x-hidden overflow-y-auto rounded-[inherit] focus-visible:outline-none',
				className,
				viewportClassName,
			)}
			{...props}
		>
			{children}
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
		</section>
	)
}
