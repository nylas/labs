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

/**
 * The sender's card (board 05, step 4): hovering or focusing the sender's
 * name shows who they are and how to reach them, from the signature they
 * signed this message with, with "Save to contacts" and "New email". The
 * name is a button, so a tap or Enter opens it too; Escape closes it and
 * returns to the name.
 */
export function SenderContactCard({ message, children }: { message: MailMessage; children: ReactNode }) {
	const [open, setOpen] = useState(false)
	const cardId = useId()
	const rootRef = useRef<HTMLSpanElement>(null)
	const triggerRef = useRef<HTMLButtonElement>(null)
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

	useEffect(() => () => clearTimeout(timer.current), [])

	function later(next: boolean, delay: number) {
		clearTimeout(timer.current)
		timer.current = setTimeout(() => setOpen(next), delay)
	}

	function onBlur(event: FocusEvent<HTMLSpanElement>) {
		if (!rootRef.current?.contains(event.relatedTarget as Node | null)) setOpen(false)
	}

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: the wrapper only observes hover, focus and Escape around the name button and its card; it is not a control.
		<span
			ref={rootRef}
			data-slot="sender-contact"
			className="relative inline-flex min-w-0"
			onPointerEnter={(event) => event.pointerType === 'mouse' && later(true, OPEN_DELAY_MS)}
			onPointerLeave={(event) => event.pointerType === 'mouse' && later(false, CLOSE_DELAY_MS)}
			onBlur={onBlur}
			onKeyDown={(event) => {
				if (event.key !== 'Escape' || !open) return
				event.preventDefault()
				event.stopPropagation()
				setOpen(false)
				triggerRef.current?.focus()
			}}
		>
			<button
				ref={triggerRef}
				type="button"
				aria-expanded={open}
				aria-controls={open ? cardId : undefined}
				onClick={() => {
					clearTimeout(timer.current)
					setOpen((current) => !current)
				}}
				onFocus={(event) => {
					if (event.currentTarget.matches(':focus-visible')) setOpen(true)
				}}
				className="min-w-0 truncate rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				{children}
			</button>
			{open ? <ContactCard id={cardId} message={message} /> : null}
		</span>
	)
}

function ContactCard({ id, message }: { id: string; message: MailMessage }) {
	const sender = senderPerson(message, '')
	const name = personName(sender, 'full')
	const signature = useMemo(() => senderSignature(message, ''), [message])
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
		<span
			id={id}
			role="dialog"
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
