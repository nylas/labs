import { Archive, ChevronLeft } from 'lucide-react'
import type * as React from 'react'
import { IconButton } from '#shared/components/ui/icon-button'
import { Toolbar } from '#shared/components/ui/toolbar'

const REPLY_PREFIX = /^(?:\s*(?:re|fwd?|aw|sv|wg)\s*(?:\[\d+\])?\s*:\s*)+/i
// A lead that labels what follows ("Action required: sign the NDA", "Updated invitation: …") is not
// the thread's name; the words after the colon are, so such a subject is shown whole.
const LABEL_WORD =
	/^(?:accepted|action|alert|approval|approved|attention|cancell?ed|declined|fyi|important|invitation|invite|needed|new|notice|reminder|request|requested|required|response|tentative|update|updated|urgent)$/i
// Every other subject surface names a blank subject this way (ThreadRow, ThreadConversation).
const NO_SUBJECT = '(no subject)'

/**
 * The subject as the phone bar names the thread (board 03: "Q3 product
 * roadmap"). The full subject is the heading right beneath the bar, so the bar
 * keeps the topic before a "topic: detail" colon and drops reply prefixes. A
 * one-word or label-like lead, or a subject without that shape, is shown whole
 * and truncates.
 */
export function topBarSubject(subject: string): string {
	const text = subject.replace(REPLY_PREFIX, '').trim()
	const colon = text.indexOf(': ')
	const words = colon > 0 ? text.slice(0, colon).trim().split(/\s+/) : []
	const isTopic = words.length >= 2 && !words.some((word) => LABEL_WORD.test(word))
	return isTopic ? words.join(' ') : text || subject.trim()
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
	/** The back button's accessible name, after the folder the thread opened from: "Back to Inbox" (board 03). */
	backLabel?: string
}) {
	return (
		<Toolbar pinned data-slot="mobile-thread-top-bar" className="gap-control px-control md:hidden">
			<IconButton label={backLabel} onClick={onBack} className="size-11 text-foreground">
				<ChevronLeft className="size-5" aria-hidden="true" />
			</IconButton>
			<div className="flex min-w-0 flex-1 flex-col">
				<span title={subject.trim() || NO_SUBJECT} className="truncate text-[15px] font-semibold">
					{topBarSubject(subject) || NO_SUBJECT}
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
