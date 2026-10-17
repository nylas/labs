import { useRouter } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { EdgeLoadCard, useOnline } from './PartialLoadNotice.js'
import { ThreadColumn, ThreadColumnReader } from './ThreadColumn.js'

/**
 * The reader route's error component. A thread that fails to load keeps the
 * reader around it (the route keeps its toolbar) and shows the same card a
 * partial load does, retrying in place instead of replacing the whole reader.
 * Offline it says the mail refreshes once the connection is back, and it does:
 * coming back online loads the conversation again in place.
 */
export function ThreadLoadError({ reset }: { error: unknown; reset(): void }) {
	const router = useRouter()
	const online = useOnline()
	const retry = () => {
		reset()
		void router.invalidate()
	}
	const retryRef = useRef(retry)
	retryRef.current = retry
	useEffect(() => {
		const onOnline = () => retryRef.current()
		window.addEventListener('online', onOnline)
		return () => window.removeEventListener('online', onOnline)
	}, [])
	return (
		// On the reader's own column, where the conversation would have started.
		<div data-slot="thread-load-error" className="w-full py-6">
			<ThreadColumnReader active>
				<ThreadColumn>
					<EdgeLoadCard
						text={
							online ? 'Couldn’t load this conversation.' : 'Couldn’t load this conversation while offline.'
						}
						online={online}
						onRetry={retry}
					/>
				</ThreadColumn>
			</ThreadColumnReader>
		</div>
	)
}
