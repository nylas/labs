import type { Contact } from '@nylas-labs/cli-kit/v3'
import { Copy, Mail, Pencil, Trash2, User } from 'lucide-react'
import type { ReactElement } from 'react'
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuShortcut,
	ContextMenuTrigger,
} from '#shared/components/ui/context-menu'
import { contactDisplayName } from '../lib/contacts-model.js'

/**
 * The right-click menu of a contact, in the list and on its detail page. It
 * holds what the detail page offers; Delete only opens the page's own
 * confirmation.
 */
export function ContactContextMenu({
	contact,
	onOpen,
	onEdit,
	onNewEmail,
	onRequestDelete,
	children,
}: {
	contact: Contact
	/** Omitted on the detail page, where the contact is already open. */
	onOpen?: () => void
	onEdit: () => void
	onNewEmail: (email: string) => void
	onRequestDelete: () => void
	/** The row or header; it becomes the trigger. */
	children: ReactElement
}) {
	const email = contact.emails?.[0]?.email
	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
			<ContextMenuContent aria-label={`Actions for ${contactDisplayName(contact)}`}>
				{onOpen ? (
					<ContextMenuItem aria-keyshortcuts="Enter" onSelect={() => onOpen()}>
						<User aria-hidden="true" />
						Open
						<ContextMenuShortcut>Enter</ContextMenuShortcut>
					</ContextMenuItem>
				) : null}
				<ContextMenuItem onSelect={() => onEdit()}>
					<Pencil aria-hidden="true" />
					Edit
				</ContextMenuItem>
				<ContextMenuSeparator />
				<ContextMenuItem disabled={!email} onSelect={() => onNewEmail(email as string)}>
					<Mail aria-hidden="true" />
					New email
				</ContextMenuItem>
				<ContextMenuItem
					disabled={!email}
					onSelect={() => {
						// The address is the contact's own, read from app state. A browser
						// that refuses the clipboard leaves nothing to undo.
						void navigator.clipboard?.writeText(email as string).catch(() => {})
					}}
				>
					<Copy aria-hidden="true" />
					Copy email address
				</ContextMenuItem>
				<ContextMenuSeparator />
				<ContextMenuItem variant="destructive" onSelect={() => onRequestDelete()}>
					<Trash2 aria-hidden="true" />
					Delete…
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	)
}
