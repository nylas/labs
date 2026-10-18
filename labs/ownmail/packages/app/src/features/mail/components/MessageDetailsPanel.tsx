import { useQuery } from '@tanstack/react-query'
import { ShieldCheck, X } from 'lucide-react'
import { type ReactNode, type RefObject, useEffect, useId, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogTitle } from '#shared/components/ui/dialog'
import { GLASS_PANEL_CLASS } from '#shared/components/ui/glass'
import { IconButton } from '#shared/components/ui/icon-button'
import { cn } from '#shared/lib/utils'
import {
	copyableAddresses,
	longDateLabel,
	type PersonChip,
	personChips,
	senderLocalTime,
} from '../lib/message-anatomy.js'
import { firstName, senderPerson } from '../lib/thread-reading-model.js'
import {
	type MailMessage,
	type MessageHeaderFacts,
	messageRawHeadersQueryOptions,
} from '../state/mail-queries.js'
import { Avatar } from './Avatar.js'

/** Loaded on demand: raw headers are read only when someone asks to see them. */
async function fetchRawHeaders(messageId: string): Promise<{ text: string }> {
	const { getMessageRawHeaders } = await import('../server/mail-functions.js')
	return getMessageRawHeaders({ data: { messageId } })
}

/** How long "Copied" stands in for "Copy addresses". */
const COPIED_MS = 2000
/** Chips on one recipient line before the rest fold into "+n more". */
const MAX_CHIPS = 8

const quietButtonClass =
	'details-button touch-target inline-flex h-7 items-center rounded-md text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring'

function Row({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="contents">
			<dt className="text-muted-foreground">{label}</dt>
			<dd className="min-w-0 [overflow-wrap:anywhere]">{children}</dd>
		</div>
	)
}

const chipClass = 'inline-flex h-6 max-w-full items-center rounded-full bg-muted text-xs'

/** People on one line of the panel; a long list shows its first few and a count that expands it. */
function Chips({ chips }: { chips: PersonChip[] }) {
	const [all, setAll] = useState(false)
	const shown = all || chips.length <= MAX_CHIPS ? chips : chips.slice(0, MAX_CHIPS - 1)
	const hidden = chips.length - shown.length
	return (
		<ul className="flex flex-wrap gap-1">
			{shown.map(({ person, label, isList, count }) => (
				<li
					key={person.email}
					title={person.email}
					data-list={isList || undefined}
					className={cn(chipClass, 'person-chip')}
				>
					<Avatar person={person} size={18} />
					<span className="truncate">
						{label}
						{count !== undefined ? (
							<>
								<span aria-hidden="true"> · </span>
								<span className="font-data tabular-nums">{count.toLocaleString('en-US')}</span>
								<span className="sr-only"> {count === 1 ? 'member' : 'members'}</span>
							</>
						) : null}
					</span>
					{person.isOwner || label === person.email ? null : <span className="sr-only">{person.email}</span>}
				</li>
			))}
			{hidden > 0 ? (
				<li>
					<button
						type="button"
						onClick={() => setAll(true)}
						className={cn(
							chipClass,
							'px-2 font-data tabular-nums text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
						)}
					>
						+{hidden.toLocaleString('en-US')} more
					</button>
				</li>
			) : null}
		</ul>
	)
}

/**
 * The message's details, one click from its header (board 05, step 2): the
 * sender's address and whether it is verified, the recipients as people,
 * the full date with the sender's own time when their clock differs, and
 * the addresses to copy or the raw headers to read.
 */
export function MessageDetailsPanel({
	message,
	owner,
	facts,
	viewerTz,
	listSizes,
	id,
	className,
}: {
	message: MailMessage
	owner: string
	facts?: MessageHeaderFacts
	/** The reader's time zone, for the sender's own time. */
	viewerTz: string
	/** Member counts of mailing lists, keyed by lower-case address. */
	listSizes?: Readonly<Record<string, number>>
	id?: string
	className?: string
}) {
	const sender = senderPerson(message, owner)
	const [copied, setCopied] = useState(false)
	const [rawOpen, setRawOpen] = useState(false)
	const rawTrigger = useRef<HTMLButtonElement>(null)
	const addresses = copyableAddresses(message, owner)
	const local = message.date ? senderLocalTime(message.date, facts?.dateOffsetMinutes, viewerTz) : null
	const lists = { listId: facts?.listId, listSizes }
	const rows = (
		[
			['To', personChips(message.to, owner, lists)],
			['Cc', personChips(message.cc, owner, lists)],
			['Bcc', personChips(message.bcc, owner, lists)],
		] as const
	).filter(([, chips]) => chips.length > 0)

	useEffect(() => {
		if (!copied) return
		const timer = setTimeout(() => setCopied(false), COPIED_MS)
		return () => clearTimeout(timer)
	}, [copied])

	async function copy() {
		try {
			await navigator.clipboard.writeText(addresses)
			setCopied(true)
		} catch {
			// Without clipboard access the button stays as it was; the addresses are on screen.
		}
	}

	return (
		<section
			id={id}
			data-slot="message-details"
			aria-label="Message details"
			className={cn('message-details flex flex-col p-5 text-[13px] text-foreground', className)}
		>
			<dl className="grid grid-cols-[72px_minmax(0,1fr)] items-baseline gap-x-3 gap-y-2">
				<Row label="From">
					{sender.isOwner ? 'You' : sender.name || null}{' '}
					<span className="font-data tabular-nums text-muted-foreground">{sender.email}</span>
					{facts?.verified ? (
						<span
							data-slot="verified-sender"
							className="flex items-center gap-1 text-xs font-semibold text-cta-icon"
						>
							<ShieldCheck className="size-3.5" aria-hidden="true" />
							Verified sender
						</span>
					) : null}
				</Row>
				{rows.map(([label, chips]) => (
					<Row key={label} label={label}>
						<Chips chips={chips} />
					</Row>
				))}
				{message.date ? (
					<Row label="Date">
						<span className="font-data tabular-nums">{longDateLabel(message.date, viewerTz)}</span>
						{local ? (
							<span
								data-slot="sender-local-time"
								className="block font-data tabular-nums text-muted-foreground"
							>
								{local.time} where {firstName(sender)} is ({local.zone})
							</span>
						) : null}
					</Row>
				) : null}
			</dl>
			<hr className="border-border" />
			<div className="flex flex-wrap gap-2">
				<button
					type="button"
					onClick={() => void copy()}
					disabled={addresses === ''}
					className={cn(quietButtonClass, 'border border-cta-line bg-card font-semibold hover:bg-muted')}
				>
					{copied ? 'Copied' : 'Copy addresses'}
				</button>
				{message.ownmailDraft === true ? null : (
					<button
						ref={rawTrigger}
						type="button"
						onClick={() => setRawOpen(true)}
						aria-haspopup="dialog"
						className={cn(
							quietButtonClass,
							'font-medium text-quiet-foreground hover:bg-muted hover:text-foreground',
						)}
					>
						Show raw headers
					</button>
				)}
			</div>
			<Dialog open={rawOpen} onOpenChange={setRawOpen}>
				<RawHeadersDialog
					messageId={message.id}
					returnFocusTo={rawTrigger}
					onClose={() => setRawOpen(false)}
				/>
			</Dialog>
		</section>
	)
}

/** The message's header block as the provider stored it: plain text, never parsed or rendered as markup. */
function RawHeadersDialog({
	messageId,
	returnFocusTo,
	onClose,
}: {
	messageId: string
	/** The details panel's "Show raw headers", which takes focus back however the dialog closes. */
	returnFocusTo: RefObject<HTMLButtonElement | null>
	onClose: () => void
}) {
	const titleId = useId()
	return (
		<DialogContent
			aria-labelledby={titleId}
			aria-describedby={undefined}
			onCloseAutoFocus={(event) => {
				event.preventDefault()
				returnFocusTo.current?.focus()
			}}
			className={cn('flex max-w-2xl flex-col', GLASS_PANEL_CLASS)}
		>
			<div className="flex items-center gap-2 border-b border-border py-2 pr-2 pl-5">
				<DialogTitle id={titleId} className="flex-1 text-sm font-semibold">
					Raw headers
				</DialogTitle>
				<IconButton label="Close" onClick={onClose}>
					<X aria-hidden="true" />
				</IconButton>
			</div>
			<div className="min-h-0 overflow-auto p-5">
				<RawHeadersText messageId={messageId} />
			</div>
		</DialogContent>
	)
}

/** The headers themselves, fetched only while the dialog is open. */
function RawHeadersText({ messageId }: { messageId: string }) {
	const query = useQuery(messageRawHeadersQueryOptions(messageId, fetchRawHeaders))
	if (query.isPending) return <p className="text-sm text-muted-foreground">Loading headers…</p>
	if (query.isError)
		return (
			<p role="alert" className="text-sm text-muted-foreground">
				Couldn’t load the raw headers.
			</p>
		)
	return (
		<pre
			data-slot="raw-headers"
			className="whitespace-pre-wrap font-mono text-xs [overflow-wrap:anywhere] text-foreground"
		>
			{query.data}
		</pre>
	)
}
