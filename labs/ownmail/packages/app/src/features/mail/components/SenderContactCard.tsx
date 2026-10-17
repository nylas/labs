import { type FocusEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useCreateContactMutation } from '#features/contacts/state/contacts-state'
import { GLASS_PANEL_CLASS } from '#shared/components/ui/glass'
import { cn } from '#shared/lib/utils'
import { senderSignature } from '../lib/message-anatomy.js'
import { firstName, personName, senderPerson } from '../lib/thread-reading-model.js'
import type { MailMessage } from '../state/mail-queries.js'
import { Avatar } from './Avatar.js'
import { useCompose } from './ComposeProvider.js'

/** A pointer resting this long on the name opens the card; leaving it this long closes it. */
const OPEN_DELAY_MS = 350
const CLOSE_DELAY_MS = 200

const cardButtonClass =
	'touch-target inline-flex h-7 items-center rounded-md px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60'

/** "Principal Engineer, Bletchley" → a job title and a company for the contact. */
function titleFields(title: string | undefined): { jobTitle?: string; companyName?: string } {
	if (!title) return {}
	const [job, ...company] = title.split(',')
	const companyName = company.join(',').trim()
	return { jobTitle: (job as string).trim(), ...(companyName ? { companyName } : {}) }
}

/** How the card opened: a resting pointer, keyboard focus, or a click or Enter that pins it. */
type OpenedBy = 'hover' | 'focus' | 'click'

/**
 * The sender's card (board 05, step 4): hovering or focusing the sender's
 * name shows who they are and how to reach them, from the signature they
 * signed this message with, with "Save to contacts" and "New email". The
 * name is a button: a tap, click or Enter opens the card and keeps it open
 * (a second one closes it); Escape closes it from anywhere, returning to
 * the name when focus was in the card. It is a non-modal hover card, not a
 * dialog, so the reader's shortcuts keep working while it shows.
 *
 * With `heading`, the name button sits in that `<h2>` and the card beside
 * it, so the heading (and anything it labels) is only the name. A
 * `suspicious` sender (failed checks, or a lookalike) shows no
 * signature-derived details and cannot be saved to contacts.
 */
export function SenderContactCard({
	message,
	children,
	heading,
	suspicious = false,
}: {
	message: MailMessage
	children: ReactNode
	heading?: { id: string; className?: string }
	suspicious?: boolean
}) {
	const [openedBy, setOpenedBy] = useState<OpenedBy | null>(null)
	const open = openedBy !== null
	const cardId = useId()
	const rootRef = useRef<HTMLDivElement>(null)
	const triggerRef = useRef<HTMLButtonElement>(null)
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
	/** Set while Escape hands focus back to the name, which must not reopen the card. */
	const returningFocus = useRef(false)

	useEffect(() => () => clearTimeout(timer.current), [])

	useEffect(() => {
		if (!open) return
		function onKeyDown(event: KeyboardEvent) {
			if (event.key !== 'Escape') return
			event.preventDefault()
			event.stopPropagation()
			clearTimeout(timer.current)
			const focusInside = rootRef.current?.contains(document.activeElement) === true
			setOpenedBy(null)
			if (!focusInside) return
			returningFocus.current = true
			triggerRef.current?.focus()
			returningFocus.current = false
		}
		document.addEventListener('keydown', onKeyDown)
		return () => document.removeEventListener('keydown', onKeyDown)
	}, [open])

	/** Opens by hover unless already open some other way; closes only what hover opened. */
	function later(next: 'hover' | null, delay: number) {
		clearTimeout(timer.current)
		timer.current = setTimeout(
			() => setOpenedBy((current) => (next ? (current ?? next) : current === 'hover' ? null : current)),
			delay,
		)
	}

	function onBlur(event: FocusEvent<HTMLDivElement>) {
		if (!rootRef.current?.contains(event.relatedTarget as Node | null)) setOpenedBy(null)
	}

	const trigger = (
		<button
			ref={triggerRef}
			type="button"
			aria-expanded={open}
			aria-controls={open ? cardId : undefined}
			onClick={() => {
				clearTimeout(timer.current)
				setOpenedBy((current) => (current === 'click' ? null : 'click'))
			}}
			onFocus={(event) => {
				if (returningFocus.current || !event.currentTarget.matches(':focus-visible')) return
				setOpenedBy((current) => current ?? 'focus')
			}}
			className="min-w-0 truncate rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
		>
			{children}
		</button>
	)

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: the wrapper only observes hover and focus around the name button and its card; it is not a control.
		<div
			ref={rootRef}
			data-slot="sender-contact"
			className="relative flex min-w-0"
			onPointerEnter={(event) => {
				if (event.pointerType !== 'mouse') return
				if (open) clearTimeout(timer.current)
				else later('hover', OPEN_DELAY_MS)
			}}
			onPointerLeave={(event) => {
				if (event.pointerType !== 'mouse') return
				if (openedBy === 'hover') later(null, CLOSE_DELAY_MS)
				else if (!open) clearTimeout(timer.current)
			}}
			onBlur={onBlur}
		>
			{heading ? (
				<h2 id={heading.id} className={cn('flex min-w-0', heading.className)}>
					{trigger}
				</h2>
			) : (
				trigger
			)}
			{open ? <ContactCard id={cardId} message={message} suspicious={suspicious} /> : null}
		</div>
	)
}

function ContactCard({ id, message, suspicious }: { id: string; message: MailMessage; suspicious: boolean }) {
	const sender = senderPerson(message, '')
	const name = personName(sender, 'full')
	// A sender who may not be who they say gets nothing vouched for from their own signature.
	const signature = useMemo(() => (suspicious ? null : senderSignature(message, '')), [message, suspicious])
	const email = sender.email || signature?.email
	const { openCompose } = useCompose()
	const save = useCreateContactMutation()
	const [givenName, ...surname] = sender.name.trim().split(/\s+/)

	function saveContact() {
		save.mutate({
			...(givenName ? { givenName } : {}),
			...(surname.length > 0 ? { surname: surname.join(' ') } : {}),
			...titleFields(signature?.title),
			...(email ? { emails: [{ email, type: 'work' }] } : {}),
			...(signature?.phone ? { phoneNumbers: [{ number: signature.phone, type: 'work' }] } : {}),
		})
	}

	return (
		// biome-ignore lint/a11y/useSemanticElements: a labelled group of the card's lines and buttons, not a form fieldset
		<span
			id={id}
			role="group"
			aria-label={name}
			data-slot="sender-contact-card"
			className={cn(
				'absolute top-full left-0 z-30 mt-2 flex w-[260px] flex-col gap-3 p-4 text-left',
				GLASS_PANEL_CLASS,
			)}
		>
			<span className="flex items-center gap-3">
				<Avatar person={sender} size={40} />
				<span className="block min-w-0">
					<span className="block truncate text-sm font-semibold text-foreground">{name}</span>
					{signature?.title ? (
						<span className="block truncate text-xs font-normal text-muted-foreground">
							{signature.title}
						</span>
					) : null}
				</span>
			</span>
			<span className="block font-data text-xs font-normal leading-[1.7] tabular-nums text-foreground/75">
				{email ? <span className="block [overflow-wrap:anywhere]">{email}</span> : null}
				{signature?.phone ? <span className="block">{signature.phone}</span> : null}
			</span>
			{signature ? (
				<span className="block text-xs font-normal text-muted-foreground">From their signature.</span>
			) : null}
			{save.isError ? (
				<span role="alert" className="block text-xs font-normal text-destructive">
					Couldn’t save {firstName(sender)} to contacts.
				</span>
			) : null}
			<span className="flex gap-2">
				{suspicious ? null : (
					<button
						type="button"
						onClick={saveContact}
						disabled={save.isPending || save.isSuccess}
						className={cn(
							cardButtonClass,
							'border border-cta-line bg-card font-semibold text-foreground hover:bg-muted',
						)}
					>
						{save.isSuccess ? 'Saved to contacts' : 'Save to contacts'}
					</button>
				)}
				{email ? (
					<button
						type="button"
						onClick={() => void openCompose({ kind: 'new', to: email })}
						className={cn(
							cardButtonClass,
							'font-medium text-foreground/70 hover:bg-muted hover:text-foreground',
						)}
					>
						New email
					</button>
				) : null}
			</span>
		</span>
	)
}
