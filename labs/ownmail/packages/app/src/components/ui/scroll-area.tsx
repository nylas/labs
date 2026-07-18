import type * as React from 'react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { cn } from '../../lib/utils.js'

type ScrollAreaProps = React.ComponentProps<'div'> & {
	viewportClassName?: string
	viewportRef?: React.Ref<HTMLElement>
	overflowIndicatorClassName?: string
	'aria-label'?: string
	'aria-describedby'?: string
}

type OverflowState = {
	top: boolean
	bottom: boolean
}

type ScrollbarGeometry = {
	height: number
	offset: number
}

type ScrollbarDrag = {
	pointerId: number
	startScrollTop: number
	startY: number
}

/**
 * Shadcn-sidebar-style native scrolling with an overlay scrollbar and
 * directional overflow affordances. The overlay stays outside the viewport,
 * so it never reserves content width or scrolls with the list.
 */
export function ScrollArea({
	className,
	viewportClassName,
	viewportRef,
	overflowIndicatorClassName,
	children,
	'aria-label': ariaLabel,
	'aria-describedby': ariaDescribedBy,
	...props
}: ScrollAreaProps) {
	const descriptionId = useId()
	const describedBy = [ariaDescribedBy, descriptionId].filter(Boolean).join(' ')
	const hideScrollbarTimer = useRef(0)
	const scrollbarDrag = useRef<ScrollbarDrag | null>(null)
	const [viewport, setViewport] = useState<HTMLElement | null>(null)
	const [overflow, setOverflow] = useState<OverflowState>({ top: false, bottom: false })
	const [scrollbar, setScrollbar] = useState<ScrollbarGeometry>({ height: 0, offset: 0 })
	const [scrolling, setScrolling] = useState(false)
	const [dragging, setDragging] = useState(false)

	const showScrollbar = useCallback(() => {
		setScrolling(true)
		window.clearTimeout(hideScrollbarTimer.current)
		hideScrollbarTimer.current = window.setTimeout(() => setScrolling(false), 700)
	}, [])

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
			const trackHeight = Math.max(0, viewport.clientHeight - 8)
			const nextOverflow = {
				top: viewport.scrollTop > 1,
				bottom: maxScrollTop - viewport.scrollTop > 1,
			}
			const height =
				maxScrollTop > 0
					? Math.min(
							trackHeight,
							Math.max(24, Math.round(trackHeight * (viewport.clientHeight / viewport.scrollHeight))),
						)
					: 0
			const offset =
				maxScrollTop > 0 ? Math.round(((trackHeight - height) * viewport.scrollTop) / maxScrollTop) : 0

			setOverflow((current) =>
				current.top === nextOverflow.top && current.bottom === nextOverflow.bottom ? current : nextOverflow,
			)
			setScrollbar((current) =>
				current.height === height && current.offset === offset ? current : { height, offset },
			)
		}
		const onScroll = () => {
			updateOverflow()
			showScrollbar()
		}

		updateOverflow()
		viewport.addEventListener('scroll', onScroll, { passive: true })

		const resizeObserver =
			typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(updateOverflow)
		resizeObserver?.observe(viewport)
		for (const child of viewport.children) resizeObserver?.observe(child)

		const mutationObserver =
			typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(updateOverflow)
		mutationObserver?.observe(viewport, { childList: true, subtree: true, characterData: true })

		return () => {
			viewport.removeEventListener('scroll', onScroll)
			window.clearTimeout(hideScrollbarTimer.current)
			resizeObserver?.disconnect()
			mutationObserver?.disconnect()
		}
	}, [showScrollbar, viewport])

	const startScrollbarDrag = (event: React.PointerEvent<HTMLDivElement>) => {
		if (event.button !== 0) return
		event.preventDefault()
		event.currentTarget.setPointerCapture(event.pointerId)
		scrollbarDrag.current = {
			pointerId: event.pointerId,
			startScrollTop: (viewport as HTMLElement).scrollTop,
			startY: event.clientY,
		}
		setDragging(true)
		showScrollbar()
	}

	const moveScrollbarDrag = (event: React.PointerEvent<HTMLDivElement>) => {
		const drag = scrollbarDrag.current as ScrollbarDrag
		const activeViewport = viewport as HTMLElement
		const maxScrollTop = Math.max(0, activeViewport.scrollHeight - activeViewport.clientHeight)
		const trackHeight = Math.max(0, activeViewport.clientHeight - 8)
		const thumbTravel = Math.max(1, trackHeight - scrollbar.height)
		const nextScrollTop = drag.startScrollTop + ((event.clientY - drag.startY) / thumbTravel) * maxScrollTop
		activeViewport.scrollTop = Math.min(maxScrollTop, Math.max(0, nextScrollTop))
	}

	const stopScrollbarDrag = (event: React.PointerEvent<HTMLDivElement>) => {
		event.currentTarget.releasePointerCapture((scrollbarDrag.current as ScrollbarDrag).pointerId)
		scrollbarDrag.current = null
		setDragging(false)
		showScrollbar()
	}

	const cancelScrollbarDrag = () => {
		scrollbarDrag.current = null
		setDragging(false)
		showScrollbar()
	}

	const hasOverflow = overflow.top || overflow.bottom
	const overflowGradientClassName = overflowIndicatorClassName ?? 'from-background/80'

	return (
		<div
			data-slot="scroll-area"
			className={cn('group relative min-h-0 w-full min-w-0 overflow-hidden', className)}
			{...props}
		>
			<section
				data-slot="scroll-area-viewport"
				aria-label={ariaLabel}
				aria-describedby={describedBy}
				ref={setViewportRef}
				// biome-ignore lint/a11y/noNoninteractiveTabindex: Native scroll regions must be keyboard focusable.
				tabIndex={0}
				className={cn(
					'size-full min-w-0 overflow-x-hidden overflow-y-auto rounded-[inherit] focus-visible:outline-none',
					viewportClassName,
				)}
			>
				{children}
			</section>
			{hasOverflow ? (
				<div
					aria-hidden="true"
					data-slot="scroll-area-scrollbar"
					data-scrolling={scrolling ? 'true' : 'false'}
					data-dragging={dragging ? 'true' : 'false'}
					className="pointer-events-none absolute inset-y-1 right-0 z-30 w-2.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 data-[dragging=true]:pointer-events-auto data-[dragging=true]:opacity-100 data-[scrolling=true]:pointer-events-auto data-[scrolling=true]:opacity-100"
				>
					<div
						data-slot="scroll-area-thumb"
						className="absolute inset-x-0.5 top-0 cursor-grab touch-none rounded-full bg-border active:cursor-grabbing"
						style={{ height: `${scrollbar.height}px`, transform: `translateY(${scrollbar.offset}px)` }}
						onPointerDown={startScrollbarDrag}
						onPointerMove={dragging ? moveScrollbarDrag : undefined}
						onPointerUp={dragging ? stopScrollbarDrag : undefined}
						onPointerCancel={dragging ? cancelScrollbarDrag : undefined}
					/>
				</div>
			) : null}
			<div
				aria-hidden="true"
				data-slot="scroll-area-overflow-top"
				data-overflow-top={overflow.top ? '' : undefined}
				className={cn(
					'pointer-events-none absolute inset-x-0 top-0 z-20 h-5 bg-linear-to-b to-transparent transition-opacity',
					overflowGradientClassName,
					!overflow.top && 'opacity-0',
				)}
			/>
			<div
				aria-hidden="true"
				data-slot="scroll-area-overflow-bottom"
				data-overflow-bottom={overflow.bottom ? '' : undefined}
				className={cn(
					'pointer-events-none absolute inset-x-0 bottom-0 z-20 h-5 bg-linear-to-t to-transparent transition-opacity',
					overflowGradientClassName,
					!overflow.bottom && 'opacity-0',
				)}
			/>
			<span id={descriptionId} className="sr-only">
				Scrollable content. Use the mouse wheel, trackpad, Page Up, or Page Down to see more.
			</span>
		</div>
	)
}
