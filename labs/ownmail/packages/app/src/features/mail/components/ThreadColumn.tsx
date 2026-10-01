import type { ReactNode } from 'react'

/**
 * The thread reader's single content column. Headers, prose, attachments, and
 * designed emails all start on its edge, so a conversation reads as one aligned
 * column while sender canvases are free to extend across the whole pane.
 *
 * `designed` lets HTML layouts use the phone gutter, because they bring their own
 * margins; prose and app chrome always keep it.
 */
export function ThreadColumn({ children, designed = false }: { children: ReactNode; designed?: boolean }) {
	return (
		<div data-slot="thread-column" className={designed ? 'px-0 sm:px-6 xl:px-8' : 'px-4 sm:px-6 xl:px-8'}>
			<div className="mx-auto w-full min-w-0 max-w-3xl">{children}</div>
		</div>
	)
}
