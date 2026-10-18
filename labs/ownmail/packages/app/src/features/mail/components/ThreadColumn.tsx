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
 * Whether an open message's furniture starts under the sender's name here.
 * A designed email keeps the full column, so the bars the reader adds under
 * it ("7 images … are hidden", "Fitted to width") take the inset themselves.
 */
export const useThreadColumnInset = (): boolean => useContext(ThreadColumnInsetContext)

/**
 * Set by the standard reader: its column is 760px at most and starts 64px into
 * the pane on wide screens, with 56px kept on its right before the thread map.
 * Everywhere else (the Conversation view, placeholders) the column is centred.
 */
const ThreadColumnReaderContext = createContext(false)

export function ThreadColumnReader({ active, children }: { active: boolean; children: ReactNode }) {
	return <ThreadColumnReaderContext value={active}>{children}</ThreadColumnReaderContext>
}

/**
 * The thread reader's single content column. Headers, prose, attachments, and
 * designed emails all start on its edge, so a conversation reads as one aligned
 * column while sender canvases are free to extend across the whole pane.
 *
 * `designed` lets HTML layouts use the phone gutter, because they bring their own
 * margins; prose and app chrome always keep it.
 */
export function ThreadColumn({ children, designed = false }: { children: ReactNode; designed?: boolean }) {
	const inset = useContext(ThreadColumnInsetContext) && !designed
	const reader = useContext(ThreadColumnReaderContext)
	const gutter = designed ? 'px-0 sm:px-6' : 'px-4 sm:px-6'
	return (
		<div data-slot="thread-column" className={cn(gutter, reader ? 'xl:pr-14 xl:pl-16' : 'xl:px-8')}>
			<div
				data-inset={inset || undefined}
				className={cn('w-full min-w-0', reader ? 'max-w-[760px]' : 'mx-auto max-w-3xl', inset && 'md:pl-11')}
			>
				{children}
			</div>
		</div>
	)
}
