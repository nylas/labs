import { useSyncExternalStore } from 'react'
import { cn } from '#shared/lib/utils'
import { rowDateLabel, rowTimeLabel } from '../lib/thread-list-model.js'

const subscribe = () => () => {}
const onClient = () => true
const onServer = () => false

/**
 * A row's time, in the words its day group leaves to it ("9:41 AM", "Tue",
 * "Sep 28"), or with its own day where no heading carries one (`grouped`
 * false: today's time, a weekday this past week, else the date). Set only in
 * the browser, where the zone and clock are the reader's, so the server
 * render and hydration agree on a blank cell.
 */
export function ThreadRowTime({
	epochSeconds,
	now,
	tz,
	grouped = true,
	className,
}: {
	epochSeconds?: number
	now: number
	tz: string
	grouped?: boolean
	className?: string
}) {
	const mounted = useSyncExternalStore(subscribe, onClient, onServer)
	if (!epochSeconds) return null
	return (
		<time
			dateTime={new Date(epochSeconds * 1000).toISOString()}
			className={cn('inline-block whitespace-nowrap text-right font-data tabular-nums', className)}
			suppressHydrationWarning
		>
			{(mounted && (grouped ? rowTimeLabel : rowDateLabel)(epochSeconds, now, tz)) || ' '}
		</time>
	)
}
