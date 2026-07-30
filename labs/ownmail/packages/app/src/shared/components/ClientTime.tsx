import { useEffect, useState, useSyncExternalStore } from 'react'
import { formatListDate } from '../lib/presentation.js'
import { cn } from '../lib/utils.js'

const MESSAGE_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
	weekday: 'short',
	month: 'short',
	day: 'numeric',
	hour: 'numeric',
	minute: '2-digit',
}

/** Relative list date (Today, Tue, Jul 8) — client-only to avoid SSR locale drift. */
export function ClientListDate({ epochSeconds, className }: { epochSeconds?: number; className?: string }) {
	const [label, setLabel] = useState('')

	useEffect(() => {
		setLabel(epochSeconds ? formatListDate(epochSeconds) : '')
	}, [epochSeconds])

	if (!epochSeconds) return null

	return (
		<span className={cn('inline-block min-w-14 text-right tabular-nums', className)} suppressHydrationWarning>
			{label || '\u00a0'}
		</span>
	)
}

/** Full message timestamp — client-only to avoid SSR locale drift. */
export function ClientMessageTime({ epochSeconds, className }: { epochSeconds: number; className?: string }) {
	const [label, setLabel] = useState('')
	const iso = new Date(epochSeconds * 1000).toISOString()

	useEffect(() => {
		setLabel(new Date(epochSeconds * 1000).toLocaleString(undefined, MESSAGE_TIME_OPTIONS))
	}, [epochSeconds])

	return (
		<time
			dateTime={iso}
			className={cn('inline-block w-28 text-right tabular-nums sm:w-auto sm:min-w-40', className)}
			suppressHydrationWarning
		>
			{label || '\u00a0'}
		</time>
	)
}

export function useMounted(): boolean {
	return useSyncExternalStore(subscribeToClient, clientSnapshot, serverSnapshot)
}

const subscribeToClient = () => () => {}
const clientSnapshot = () => true
const serverSnapshot = () => false
