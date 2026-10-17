import { Archive, ChevronLeft } from 'lucide-react'
import type * as React from 'react'
import { IconButton } from '#shared/components/ui/icon-button'
import { Toolbar } from '#shared/components/ui/toolbar'

const REPLY_PREFIX = /^(?:\s*(?:re|fwd?|aw|sv|wg)\s*(?:\[\d+\])?\s*:\s*)+/i

/**
 * The subject as the phone bar names the thread (board 03: "Q3 product
 * roadmap"). The full subject is the heading right beneath the bar, so the bar
 * keeps the topic before a "topic: detail" colon and drops reply prefixes; a
 * subject without that shape is shown whole and truncates.
 */
export function topBarSubject(subject: string): string {
	const text = subject.replace(REPLY_PREFIX, '').trim()
	const colon = text.indexOf(': ')
	const topic = colon > 0 ? text.slice(0, colon).trim() : ''
	return topic.split(/\s+/).length >= 2 ? topic : text || subject.trim()
}

function countLabel(count: number, one: string, many: string): string {
	return `${count} ${count === 1 ? one : many}`
}

/**
 * The phone reader's pinned top bar (board 03): back, the thread's name over
 * its size, archive and the more menu. It is the pane toolbar at its phone
 * height (56px, bar glass), so the conversation beneath takes
 * `under-pinned-bar` like any pinned toolbar.
 */
export function MobileThreadTopBar({
	subject,
	messageCount,
	peopleCount,
	onBack,
	onArchive,
	moreMenu,
	backLabel = 'Back to list',
}: {
	subject: string
	messageCount: number
	peopleCount: number
	onBack: () => void
	onArchive: () => void
	moreMenu: React.ReactNode
	/** The back button's accessible name, e.g. "Back to Inbox". */
	backLabel?: string
}) {
	return (
		<Toolbar pinned data-slot="mobile-thread-top-bar" className="gap-control px-control md:hidden">
			<IconButton label={backLabel} onClick={onBack} className="size-11 text-foreground">
				<ChevronLeft className="size-5" aria-hidden="true" />
			</IconButton>
			<div className="flex min-w-0 flex-1 flex-col">
				<span title={subject} className="truncate text-[15px] font-semibold">
					{topBarSubject(subject)}
				</span>
				<span className="truncate font-data text-xs text-muted-foreground tabular-nums">
					{countLabel(messageCount, 'message', 'messages')} · {countLabel(peopleCount, 'person', 'people')}
				</span>
			</div>
			<IconButton label="Archive" onClick={onArchive} className="size-11 text-foreground">
				<Archive className="size-5" aria-hidden="true" />
			</IconButton>
			{moreMenu}
		</Toolbar>
	)
}
