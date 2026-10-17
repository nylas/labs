import { createContext, type ReactNode, useContext } from 'react'
import { cn } from '#shared/lib/utils'

/**
 * Set around an open message's body so its prose starts under the sender's
 * name, past the 32px avatar and its 12px gap, from `md` up. Designed
 * (layout) mail keeps the full column.
 */
const ThreadColumnInsetContext = createContext(false)

export function ThreadColumnInset({ children }: { children: ReactNode }) {
	return <ThreadColumnInsetContext value={true}>{children}</ThreadColumnInsetContext>
}

/**
 * The thread reader's single content column. Headers, prose, attachments, and
 * designed emails all start on its edge, so a conversation reads as one aligned
 * column while sender canvases are free to extend across the whole pane. The
 * column is 760px at most and starts 64px into the pane on wide screens, with
 * 56px kept on its right before the thread map.
 *
 * `designed` lets HTML layouts use the phone gutter, because they bring their own
 * margins; prose and app chrome always keep it.
 */
export function ThreadColumn({ children, designed = false }: { children: ReactNode; designed?: boolean }) {
	const inset = useContext(ThreadColumnInsetContext) && !designed
	return (
		<div
			data-slot="thread-column"
			className={designed ? 'px-0 sm:px-6 xl:pr-14 xl:pl-16' : 'px-4 sm:px-6 xl:pr-14 xl:pl-16'}
		>
			<div
				data-inset={inset || undefined}
				className={cn('w-full min-w-0 max-w-[760px]', inset && 'md:pl-11')}
			>
				{children}
			</div>
		</div>
	)
}
