import {
	Archive,
	Bell,
	BellOff,
	Forward,
	Inbox,
	Mail,
	MailOpen,
	Reply,
	ReplyAll,
	Send,
	Star,
	Trash2,
	X,
} from 'lucide-react'
import type { ReactElement, ReactNode } from 'react'
import { isThreadMuted, toggleThreadMuted, useUserPreferences } from '#app/preferences/user-preferences'
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuShortcut,
	ContextMenuTrigger,
} from '#shared/components/ui/context-menu'
import { pendingSendAt } from '../lib/thread-list-model.js'
import type { ScheduledSendAction } from '../state/mail-mutations.js'
import type { MailThread } from '../state/mail-queries.js'
import type { ThreadResponseKind } from '../state/thread-response.js'
import { useThreadListEnv } from './ThreadListGroups.js'

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
 * so they are shown only on the row of that conversation. Muting is this
 * device's choice, as in the reader's More menu: it changes the row, never
 * the folder.
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
	onScheduledSend,
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
	/** Sends the thread's scheduled message now or cancels it; omitted where the list cannot. */
	onScheduledSend?: (action: ScheduledSendAction) => void
	/** The row element; it becomes the trigger. */
	children: ReactElement
}) {
	const [preferences, savePreferences] = useUserPreferences()
	// Mutes belong to the signed-in mailbox, which the list around the row names.
	const { owner } = useThreadListEnv()
	const muted = isThreadMuted(preferences, owner, thread.id)
	// Your message that waits to be sent can go now, or be cancelled back into the composer.
	const scheduled =
		onScheduledSend && pendingSendAt(thread.latest_draft_or_message, Date.now()) !== undefined
			? onScheduledSend
			: null
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
				{scheduled ? (
					<>
						<Item disabled={busy} onSelect={() => scheduled('send-now')}>
							<Send aria-hidden="true" />
							Send now
						</Item>
						<Item disabled={busy} onSelect={() => scheduled('cancel')}>
							<X aria-hidden="true" />
							Cancel scheduled send
						</Item>
					</>
				) : null}
				<Item onSelect={() => savePreferences(toggleThreadMuted(preferences, owner, thread.id))}>
					{muted ? <Bell aria-hidden="true" /> : <BellOff aria-hidden="true" />}
					{muted ? 'Unmute' : 'Mute'}
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
