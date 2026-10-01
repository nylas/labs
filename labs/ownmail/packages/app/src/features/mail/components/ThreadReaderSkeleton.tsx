import { Toolbar } from '#shared/components/ui/toolbar'
import { ThreadColumn } from './ThreadColumn.js'

/** The reader while a conversation loads: the destination's subject when it is
 * already cached, and never the conversation that was open before. */
export function ThreadReaderSkeleton({ subject }: { subject?: string }) {
	return (
		<div
			data-testid="thread-reader-pending"
			aria-busy="true"
			className="flex min-h-0 min-w-0 flex-1 flex-col bg-background"
		>
			<Toolbar />
			<div className="pt-3">
				<ThreadColumn>
					<h1 className="min-w-0 font-sans text-base leading-6 font-semibold tracking-normal [overflow-wrap:anywhere]">
						{subject || 'Loading conversation…'}
					</h1>
				</ThreadColumn>
			</div>
			<div className="py-5" aria-hidden="true">
				<ThreadColumn>
					<div className="flex flex-col gap-3">
						<div className="h-4 w-1/3 animate-pulse rounded bg-muted motion-reduce:animate-none" />
						<div className="h-4 w-5/6 animate-pulse rounded bg-muted motion-reduce:animate-none" />
						<div className="h-4 w-2/3 animate-pulse rounded bg-muted motion-reduce:animate-none" />
					</div>
				</ThreadColumn>
			</div>
		</div>
	)
}
