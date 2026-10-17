import { WifiOff } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { EDGE_BUTTON_CLASS } from './edge-actions.js'

function subscribeOnline(onChange: () => void): () => void {
	window.addEventListener('online', onChange)
	window.addEventListener('offline', onChange)
	return () => {
		window.removeEventListener('online', onChange)
		window.removeEventListener('offline', onChange)
	}
}

/** Whether the browser reports a connection; assumed online while rendering on the server. */
export function useOnline(): boolean {
	return useSyncExternalStore(
		subscribeOnline,
		() => navigator.onLine,
		() => true,
	)
}

const messages = (count: number): string => `${count} ${count === 1 ? 'message' : 'messages'}`

/**
 * Part of a thread failed to load: say exactly how much is missing, keep
 * showing what did load, and retry in place. Offline, it also says the mail
 * refreshes on its own once the connection is back.
 */
export function PartialLoadNotice({
	failedCount,
	shownCount,
	onRetry,
}: {
	failedCount: number
	shownCount: number
	onRetry(): void
}) {
	const online = useOnline()
	if (failedCount <= 0) return null
	return (
		<EdgeLoadCard
			text={`Couldn’t load ${messages(failedCount)}. Showing ${shownCount} saved on this device.`}
			online={online}
			onRetry={onRetry}
		/>
	)
}

/** The card shape partial loads and the reader's route error share: glyph, words, Try again. */
export function EdgeLoadCard({ text, online, onRetry }: { text: string; online: boolean; onRetry(): void }) {
	return (
		<div
			role="note"
			data-slot="partial-load-notice"
			className="flex flex-col gap-2 rounded-md border border-border bg-card p-3 text-[13px] text-foreground"
		>
			<div className="flex items-center gap-2">
				<WifiOff aria-hidden="true" className="size-3.5 shrink-0" />
				<span className="min-w-0 flex-1">{text}</span>
			</div>
			<div className="flex flex-wrap items-center gap-2">
				<button type="button" onClick={onRetry} className={EDGE_BUTTON_CLASS}>
					Try again
				</button>
				{online ? null : (
					<span className="text-xs text-muted-foreground">Mail refreshes when you’re back online.</span>
				)}
			</div>
		</div>
	)
}
