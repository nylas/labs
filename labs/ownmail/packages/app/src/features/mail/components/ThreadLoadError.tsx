import { useRouter } from '@tanstack/react-router'
import { EdgeLoadCard, useOnline } from './PartialLoadNotice.js'
import { ThreadColumn, ThreadColumnReader } from './ThreadColumn.js'

/**
 * The reader route's error component. A thread that fails to load keeps the
 * reader around it (the route keeps its toolbar) and shows the same card a
 * partial load does, retrying in place instead of replacing the whole reader.
 */
export function ThreadLoadError({ reset }: { error: unknown; reset(): void }) {
	const router = useRouter()
	const online = useOnline()
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
						onRetry={() => {
							reset()
							void router.invalidate()
						}}
					/>
				</ThreadColumn>
			</ThreadColumnReader>
		</div>
	)
}
