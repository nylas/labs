import { ReplyAll, Send } from 'lucide-react'
import type { Ref } from 'react'
import { replyAllCount } from '../lib/thread-reading-model.js'
import { replyAllNames, replyFirstName } from '../lib/thread-stream.js'
import type { MailMessage } from '../state/mail-queries.js'
import { ReplyAllGuard } from './ReplyAllGuard.js'
import { ThreadColumn } from './ThreadColumn.js'

/**
 * The reply under the last message, pinned to the bottom of the reader while
 * the thread scrolls (design.md "Reading"). At rest it is a card naming who
 * Reply all reaches, the plain reply as an explicit choice, and a field;
 * taking the field (or Send) opens the composer in its place. Past 25 people
 * the reply-all guard asks once, offering the smaller reply first. The `r`
 * shortcut lands on the plain reply, so it means Reply here as everywhere.
 */
export function InlineReplyCard({
	latest,
	owner,
	onReply,
	onReplyAll,
	replyRef,
}: {
	latest: MailMessage
	owner: string
	onReply: () => void
	onReplyAll: () => void
	/** "Reply only to {name}", so the `r` shortcut can land on it. */
	replyRef?: Ref<HTMLButtonElement>
}) {
	const { names, more } = replyAllNames(latest, owner)
	const replyName = replyFirstName(latest, owner)
	const reach = replyAllCount(latest, owner)
	return (
		<div data-slot="inline-reply-dock" className="reader-reply-dock">
			<ThreadColumn>
				<section aria-label="Reply" data-slot="inline-reply-card" className="reader-reply-card">
					<div className="reader-reply-head">
						<ReplyAll aria-hidden="true" className="size-3.5 shrink-0 text-cta-icon" />
						<span className="min-w-0 truncate">
							Reply all to <span className="font-medium text-foreground">{names}</span>
							{more > 0 ? ` +${more}` : null}
						</span>
						<span aria-hidden="true" className="flex-1" />
						{replyName ? (
							<button
								ref={replyRef}
								type="button"
								data-slot="reply-only"
								onClick={onReply}
								className="reader-reply-only"
							>
								Reply only to {replyName}
							</button>
						) : null}
					</div>
					{/* Renders nothing until Reply all would reach more than REPLY_ALL_GUARD people. */}
					<ReplyAllGuard count={reach} replyOnlyFirstName={replyName} onReplyOnly={onReply} />
					<div className="reader-reply-row">
						<button
							type="button"
							data-slot="inline-reply"
							aria-label="Write a reply…"
							onClick={onReplyAll}
							className="reader-reply-field"
						>
							Write a reply…
						</button>
						<span aria-hidden="true" className="reader-reply-hint font-data">
							⌘↵
						</span>
						<button
							type="button"
							data-slot="inline-reply-send"
							onClick={onReplyAll}
							className="reader-reply-send"
						>
							<Send aria-hidden="true" className="size-3.5" />
							Send
						</button>
					</div>
				</section>
			</ThreadColumn>
		</div>
	)
}
