import type { TouchEvent } from 'react'
import { useCallback, useEffect, useRef } from 'react'

const MIN_HORIZONTAL_SWIPE_PX = 64
const INTERACTIVE_SELECTOR = [
	'input',
	'textarea',
	'select',
	'button',
	'a',
	'[contenteditable]:not([contenteditable="false"])',
	'[role="button"]',
	'[role="link"]',
	'[role="textbox"]',
	'[role="combobox"]',
].join(',')

type TouchStart = {
	x: number
	y: number
	interactive: boolean
	axis?: 'horizontal'
	element: HTMLElement
} | null

function isInteractiveTarget(target: EventTarget | null): boolean {
	return target instanceof Element && Boolean(target.closest(INTERACTIVE_SELECTOR))
}

function hasTextSelection(): boolean {
	return Boolean(document.getSelection()?.toString().trim())
}

/** A finger-following back gesture. Browser edges stay available to Safari history. */
export function useHorizontalSwipe(onSwipeRight: () => void, feedback = false) {
	const touchStart = useRef<TouchStart>(null)
	const visual = useRef<HTMLElement | null>(null)
	const previewList = useRef<HTMLElement | null>(null)

	const reset = useCallback(() => {
		touchStart.current = null
		if (visual.current) {
			visual.current.style.removeProperty('--reader-swipe-x')
			delete visual.current.dataset.swipeActive
			visual.current = null
		}
		if (previewList.current) {
			previewList.current.inert = false
			previewList.current = null
		}
	}, [])
	useEffect(() => reset, [reset])

	function onTouchStart(event: TouchEvent<HTMLElement>) {
		reset()
		const touch = event.touches[0]
		if (!touch || event.touches.length !== 1 || hasTextSelection()) return
		const standalone =
			window.matchMedia?.('(display-mode: standalone)').matches ||
			(navigator as Navigator & { standalone?: boolean }).standalone === true
		// Safari owns the first 24px in a normal tab. Installed PWAs have no browser Back UI.
		if (!standalone && touch.clientX < 24) return
		touchStart.current = {
			x: touch.clientX,
			y: touch.clientY,
			interactive: event.nativeEvent.composedPath().some(isInteractiveTarget),
			element: event.currentTarget,
		}
	}

	function onTouchMove(event: TouchEvent<HTMLElement>) {
		const start = touchStart.current
		const touch = event.touches[0]
		if (!start) return
		if (!touch || event.touches.length !== 1 || start.interactive || hasTextSelection()) {
			reset()
			return
		}
		const x = touch.clientX - start.x
		const y = Math.abs(touch.clientY - start.y)
		if (!start.axis) {
			if (Math.max(Math.abs(x), y) < 10) return
			if (x <= y) {
				reset()
				return
			}
			start.axis = 'horizontal'
		}
		if (feedback && !window.matchMedia?.('(min-width: 1280px)').matches) {
			visual.current = start.element
			visual.current.dataset.swipeActive = 'true'
			visual.current.style.setProperty('--reader-swipe-x', `${Math.max(0, Math.min(x, window.innerWidth))}px`)
			previewList.current =
				start.element.closest('[data-mail-panes]')?.querySelector<HTMLElement>('[data-mail-list]') ?? null
			if (previewList.current) previewList.current.inert = true
		}
	}

	function onTouchEnd(event: TouchEvent<HTMLElement>) {
		const start = touchStart.current
		const touch = event.changedTouches[0]
		reset()
		if (!start || !touch || event.touches.length > 0 || start.interactive || hasTextSelection()) return
		const x = touch.clientX - start.x
		const y = Math.abs(touch.clientY - start.y)
		if (x < MIN_HORIZONTAL_SWIPE_PX || x <= y) return
		onSwipeRight()
	}

	return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: reset }
}
