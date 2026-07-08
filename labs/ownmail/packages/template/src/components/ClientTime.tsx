import { useEffect, useState } from 'react'
import { formatListDate } from './ui-model.js'

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
		<span className={className} suppressHydrationWarning>
			{label}
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
		<time dateTime={iso} className={className} suppressHydrationWarning>
			{label}
		</time>
	)
}

export function useMounted(): boolean {
	const [mounted, setMounted] = useState(false)
	useEffect(() => setMounted(true), [])
	return mounted
}
