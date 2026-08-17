import { Loader2, RefreshCw } from 'lucide-react'
import {
	type CSSProperties,
	type ReactNode,
	type TouchEvent as ReactTouchEvent,
	type RefObject,
	useCallback,
	useRef,
	useState,
} from 'react'
import { cn } from '../lib/utils.js'

const PULL_THRESHOLD = 64
const MAX_PULL_DISTANCE = 88
const AXIS_LOCK_DISTANCE = 8
const INTERACTIVE_TARGET = 'button, a, input, textarea, select, [contenteditable="true"], [role="slider"]'

type Gesture = {
	startX: number
	startY: number
	axis: 'pending' | 'vertical' | 'cancelled'
}

export function PullToRefresh({
	onRefresh,
	scrollRef,
	className,
	children,
	label = 'Refresh',
}: {
	onRefresh: () => Promise<unknown>
	scrollRef?: RefObject<HTMLElement | null>
	className?: string
	children: ReactNode
	label?: string
}) {
	const rootRef = useRef<HTMLDivElement>(null)
	const gestureRef = useRef<Gesture | null>(null)
	const distanceRef = useRef(0)
	const [distance, setDistance] = useState(0)
	const [refreshing, setRefreshing] = useState(false)
	const [status, setStatus] = useState('')

	const refresh = useCallback(async () => {
		if (refreshing) return
		setRefreshing(true)
		setStatus('Refreshing…')
		try {
			await onRefresh()
			setStatus('Updated')
		} catch {
			setStatus('Could not refresh. Check your connection, then try again.')
		} finally {
			setRefreshing(false)
		}
	}, [onRefresh, refreshing])

	function resetGesture() {
		gestureRef.current = null
		distanceRef.current = 0
		setDistance(0)
	}

	function onTouchStart(event: ReactTouchEvent<HTMLDivElement>) {
		const touch = event.touches[0]
		const scroller = scrollRef?.current ?? rootRef.current
		const selection = window.getSelection?.()?.toString()
		const target = event.target as HTMLElement
		if (
			refreshing ||
			event.touches.length !== 1 ||
			!touch ||
			(scroller?.scrollTop ?? 0) > 0 ||
			selection ||
			target.closest(INTERACTIVE_TARGET)
		) {
			gestureRef.current = null
			return
		}
		gestureRef.current = { startX: touch.clientX, startY: touch.clientY, axis: 'pending' }
	}

	function onTouchMove(event: ReactTouchEvent<HTMLDivElement>) {
		const gesture = gestureRef.current
		const touch = event.touches[0]
		if (!gesture || !touch || event.touches.length !== 1 || gesture.axis === 'cancelled') return
		const deltaX = touch.clientX - gesture.startX
		const deltaY = touch.clientY - gesture.startY
		if (gesture.axis === 'pending') {
			if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < AXIS_LOCK_DISTANCE) return
			if (Math.abs(deltaX) >= Math.abs(deltaY) || deltaY <= 0) {
				gesture.axis = 'cancelled'
				return
			}
			gesture.axis = 'vertical'
		}
		if (deltaY <= 0) return
		if (event.cancelable) event.preventDefault()
		const nextDistance = Math.min(MAX_PULL_DISTANCE, deltaY * 0.5)
		distanceRef.current = nextDistance
		setDistance(nextDistance)
	}

	function onTouchEnd() {
		const shouldRefresh = distanceRef.current >= PULL_THRESHOLD
		resetGesture()
		if (shouldRefresh) void refresh()
	}

	const armed = distance >= PULL_THRESHOLD
	return (
		<div
			ref={rootRef}
			className={cn('pull-to-refresh relative min-h-0 overflow-hidden', className)}
			aria-busy={refreshing || undefined}
			onTouchStart={onTouchStart}
			onTouchMove={onTouchMove}
			onTouchEnd={onTouchEnd}
			onTouchCancel={resetGesture}
		>
			<div
				className="pull-to-refresh-indicator pointer-events-none absolute inset-x-0 top-0 z-30 flex h-12 items-center justify-center gap-2 text-xs font-medium text-muted-foreground"
				style={{ '--pull-distance': `${distance}px` } as CSSProperties}
				aria-hidden="true"
			>
				{refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
				{refreshing ? 'Refreshing…' : armed ? 'Release to refresh' : 'Pull to refresh'}
			</div>
			{children}
			<span className="sr-only" role="status" aria-live="polite">
				{status}
			</span>
			<button type="button" className="pull-refresh-keyboard-action" onClick={() => void refresh()}>
				{label}
			</button>
		</div>
	)
}

export function RefreshButton({
	onRefresh,
	refreshing,
	className,
	label = 'Refresh',
}: {
	onRefresh: () => void
	refreshing?: boolean
	className?: string
	label?: string
}) {
	return (
		<button
			type="button"
			onClick={onRefresh}
			disabled={refreshing}
			aria-label={refreshing ? `Refreshing ${label.toLowerCase()}` : label}
			className={cn(
				'touch-target-square flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-[background-color,color,transform] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-muted hover:text-foreground active:translate-y-px disabled:cursor-wait disabled:opacity-50',
				className,
			)}
		>
			<RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
		</button>
	)
}
