import type { TouchEvent } from 'react'
import { useRef } from 'react'

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

type TouchStart = { x: number; y: number; interactive: boolean } | null

function isInteractiveTarget(target: EventTarget | null): boolean {
	return (
		target instanceof HTMLElement &&
		(target.isContentEditable || Boolean(target.closest(INTERACTIVE_SELECTOR)))
	)
}

function hasTextSelection(): boolean {
	return Boolean(document.getSelection()?.toString().trim())
}

/** Preserves vertical scrolling while recognizing a deliberate rightward touch swipe. */
export function useHorizontalSwipe(onSwipeRight: () => void) {
	const touchStart = useRef<TouchStart>(null)

	function onTouchStart(event: TouchEvent<HTMLElement>) {
		const touch = event.touches[0]
		if (!touch || event.touches.length !== 1) {
			touchStart.current = null
			return
		}
		touchStart.current = {
			x: touch.clientX,
			y: touch.clientY,
			interactive: isInteractiveTarget(event.target),
		}
	}

	function onTouchEnd(event: TouchEvent<HTMLElement>) {
		const start = touchStart.current
		touchStart.current = null
		const touch = event.changedTouches[0]
		if (!start || !touch || start.interactive || hasTextSelection()) return
		const horizontalDistance = touch.clientX - start.x
		const verticalDistance = touch.clientY - start.y
		if (
			horizontalDistance < MIN_HORIZONTAL_SWIPE_PX ||
			Math.abs(horizontalDistance) <= Math.abs(verticalDistance)
		)
			return
		onSwipeRight()
	}

	function onTouchCancel() {
		touchStart.current = null
	}

	return { onTouchStart, onTouchEnd, onTouchCancel }
}
