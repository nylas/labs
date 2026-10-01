import { Archive, Forward, Inbox, Mail, MailOpen, Reply, ReplyAll, Star, Trash2 } from 'lucide-react'
import type { ReactElement, ReactNode } from 'react'
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuShortcut,
	ContextMenuTrigger,
} from '#shared/components/ui/context-menu'
import type { MailThread } from '../state/mail-queries.js'
import type { ThreadResponseKind } from '../state/thread-response.js'

export type ThreadRowUpdate = { unread?: boolean; folder?: string }

/** One item; its shortcut is shown and announced only when that key would act on this row. */
function Item({
	shortcut,
	children,
	...props
}: React.ComponentProps<typeof ContextMenuItem> & { shortcut?: string | false; children: ReactNode }) {
	return (
		<ContextMenuItem aria-keyshortcuts={shortcut || undefined} {...props}>
			{children}
			{shortcut ? <ContextMenuShortcut>{shortcut}</ContextMenuShortcut> : null}
		</ContextMenuItem>
	)
}

/**
 * The right-click menu of a thread-list row. It holds what the reader toolbar
 * and the row already do (open, answer, read state, star, archive, delete) and
 * acts on the row it was opened on, whichever conversation is open beside the
 * list. The reader's shortcuts (R, E, #, S, U) act on the open conversation,
 * so they are shown only on the row of that conversation.
 */
export function ThreadRowMenu({
	thread,
	folderId,
	busy,
	readerShortcuts = false,
	onOpen,
	onRespond,
	onToggleStar,
	onUpdate,
	children,
}: {
	thread: MailThread
	folderId: string
	busy: boolean
	/** This row's conversation is open in a reader that has the keyboard shortcuts. */
	readerShortcuts?: boolean
	onOpen: () => void
	/** Omitted where the list cannot start a reply (behind the composer). */
	onRespond?: (kind: ThreadResponseKind) => void
	onToggleStar: () => void
	onUpdate: (input: ThreadRowUpdate) => void
	/** The row element; it becomes the trigger. */
	children: ReactElement
}) {
	const isArchived = folderId === 'archive' || thread.folders?.includes('archive') === true
	const cannotRespond = busy || !onRespond
	// The items are disabled without it, so they never call a missing handler.
	const respond = onRespond as NonNullable<typeof onRespond>
	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
			<ContextMenuContent aria-label={`Actions for ${thread.subject || '(no subject)'}`}>
				<Item shortcut="Enter" onSelect={() => onOpen()}>
					<MailOpen aria-hidden="true" />
					Open
				</Item>
				<ContextMenuSeparator />
				<Item shortcut={readerShortcuts && 'R'} disabled={cannotRespond} onSelect={() => respond('reply')}>
					<Reply aria-hidden="true" />
					Reply
				</Item>
				<Item disabled={cannotRespond} onSelect={() => respond('reply-all')}>
					<ReplyAll aria-hidden="true" />
					Reply all
				</Item>
				<Item disabled={cannotRespond} onSelect={() => respond('forward')}>
					<Forward aria-hidden="true" />
					Forward
				</Item>
				<ContextMenuSeparator />
				<Item
					shortcut={readerShortcuts && !thread.unread && 'U'}
					disabled={busy}
					onSelect={() => onUpdate({ unread: !thread.unread })}
				>
					<Mail aria-hidden="true" />
					{thread.unread ? 'Mark as read' : 'Mark as unread'}
				</Item>
				<Item shortcut={readerShortcuts && 'S'} disabled={busy} onSelect={() => onToggleStar()}>
					<Star aria-hidden="true" />
					{thread.starred ? 'Unstar' : 'Star'}
				</Item>
				<Item
					shortcut={readerShortcuts && 'E'}
					disabled={busy}
					onSelect={() => onUpdate({ folder: isArchived ? 'inbox' : 'archive' })}
				>
					{isArchived ? <Inbox aria-hidden="true" /> : <Archive aria-hidden="true" />}
					{isArchived ? 'Return to inbox' : 'Archive'}
				</Item>
				<ContextMenuSeparator />
				<Item
					shortcut={readerShortcuts && '#'}
					variant="destructive"
					disabled={busy}
					onSelect={() => onUpdate({ folder: 'trash' })}
				>
					<Trash2 aria-hidden="true" />
					Delete
				</Item>
			</ContextMenuContent>
		</ContextMenu>
	)
}
