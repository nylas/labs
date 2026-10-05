import { useQueryClient } from '@tanstack/react-query'
import { Maximize2, Minus, Paperclip, Save, Send, Trash2, X } from 'lucide-react'
import { type Ref, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useUserPreferences } from '#app/preferences/user-preferences'
import { applyContactEffect } from '#features/contacts/state/contacts-state'
import { markdownToDraftBody, seedToMarkdown } from '#features/mail/lib/html-to-markdown'
import { markdownToEmailHtml } from '#features/mail/lib/markdown-model'
import { validateRecipientEmails } from '#features/mail/lib/recipients'
import type { OutboundAttachment } from '#features/mail/server/outbound-attachments'
import {
	useDeleteDraftMutation,
	useSaveDraftMutation,
	useSendDraftMutation,
} from '#features/mail/state/mail-mutations'
import type { MailDraft } from '#features/mail/state/mail-queries'
import { saveComposeRecipients } from '#server/fns'
import { RecipientInput, type RecipientInputHandle } from '#shared/components/RecipientInput'
import { Button } from '#shared/components/ui/button'
import { Chip, PillRow } from '#shared/components/ui/chip'
import { Dialog, DialogContent, DialogTitle } from '#shared/components/ui/dialog'
import { IconButton } from '#shared/components/ui/icon-button'
import { runTrackedWrite } from '#shared/lib/tracked-write'
import { cn } from '#shared/lib/utils'
import { ErrorBanner } from './ErrorBanner.js'
import { MarkdownEditor } from './MarkdownEditor.js'
import { formatSize } from './ThreadConversation.js'

/**
 * What a composer starts from. A draft is loaded before the window opens; the
 * others carry their fields. `threadId` names the conversation a reply or
 * forward belongs to, so a reply can be shown inline in that thread.
 */
export type ComposeSeed =
	| { kind: 'draft'; draft: MailDraft }
	| {
			kind: 'new' | 'reply' | 'forward'
			threadId?: string
			to?: string
			subject?: string
			body?: string
			replyToMessageId?: string
	  }

/** Lets the app close the open composer (saving its draft) before opening another. */
export type ComposeWindowHandle = { close: () => Promise<void> }

const MAX_COMPOSE_ATTACHMENTS = 10
const MAX_COMPOSE_ATTACHMENT_BYTES = 2 * 1024 * 1024
const MOBILE_COMPOSE_QUERY = '(max-width: 47.999rem)'
const COMPOSE_FOCUSABLE_SELECTOR = [
	'button:not(:disabled)',
	'[href]',
	'input:not(:disabled)',
	'select:not(:disabled)',
	'textarea:not(:disabled)',
	'[contenteditable="true"]',
	'[tabindex]:not([tabindex="-1"])',
].join(',')

type ComposeFocusTarget = 'compose-to' | 'compose-subject' | 'compose-body'

function composeFocusTarget({
	to,
	subject,
	isReply,
}: {
	to: string
	subject: string
	isReply: boolean
}): ComposeFocusTarget {
	if (isReply) return 'compose-body'
	if (!to.trim()) return 'compose-to'
	if (!subject.trim()) return 'compose-subject'
	return 'compose-body'
}

function focusComposeTarget(target: ComposeFocusTarget) {
	document.getElementById(target)?.focus()
}

function useMobileComposePresentation(): boolean {
	const [mobile, setMobile] = useState(false)
	useEffect(() => {
		if (typeof window.matchMedia !== 'function') return
		const media = window.matchMedia(MOBILE_COMPOSE_QUERY)
		const update = () => setMobile(media.matches)
		update()
		media.addEventListener('change', update)
		return () => media.removeEventListener('change', update)
	}, [])
	return mobile
}

function visibleComposeControls(root: HTMLElement): HTMLElement[] {
	return [...root.querySelectorAll<HTMLElement>(COMPOSE_FOCUSABLE_SELECTOR)].filter((element) => {
		const style = window.getComputedStyle(element)
		return style.display !== 'none' && style.visibility !== 'hidden'
	})
}

function draftSaveErrorMessage(error: unknown): string {
	const message =
		typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
			? error.message
			: ''
	if (message.startsWith('Invalid recipient'))
		return 'Enter a valid email address for each recipient before saving.'
	return 'Could not save the draft. Your changes are still here; check your connection and try again.'
}

type ComposeAttachment = OutboundAttachment & { clientId: string }

type DraftPersistenceInput = {
	to: string
	subject: string
	body: string
	attachments: ComposeAttachment[]
	replyToMessageId?: string
}

export function ComposeWindow({
	seed,
	inlineSlot = null,
	onClosed,
	onSent,
	handleRef,
}: {
	seed: ComposeSeed
	/** Where a reply is shown in its thread; null floats the window. */
	inlineSlot?: HTMLElement | null
	onClosed: () => void
	onSent: () => void
	handleRef?: Ref<ComposeWindowHandle>
}) {
	const draft = seed.kind === 'draft' ? seed.draft : null
	const reply = seed.kind === 'draft' ? null : seed
	const queryClient = useQueryClient()
	const { mutateAsync: saveDraft } = useSaveDraftMutation()
	const sendDraftMutation = useSendDraftMutation()
	const deleteDraftMutation = useDeleteDraftMutation()
	const [to, setTo] = useState(draft?.to?.map((person) => person.email).join(', ') ?? reply?.to ?? '')
	const [subject, setSubject] = useState(draft?.subject ?? reply?.subject ?? '')
	const draftBody = draft?.body ?? reply?.body ?? ''
	const replyToMessageId = reply?.replyToMessageId ?? draft?.reply_to_message_id
	const [body, setBody] = useState(draftBody)
	const initialFocusTarget = useRef(composeFocusTarget({ to, subject, isReply: Boolean(replyToMessageId) }))
	const [busy, setBusy] = useState(false)
	const [confirmation, setConfirmation] = useState<'discard' | 'send' | null>(null)
	const confirmationRef = useRef<'discard' | 'send' | null>(null)
	const confirmationReturnFocus = useRef<HTMLElement | null>(null)
	const confirmationCancelRef = useRef<HTMLButtonElement>(null)
	const manualSaving = useRef(false)
	const [minimized, setMinimized] = useState(false)
	const [saved, setSaved] = useState(false)
	const [autosaveFailed, setAutosaveFailed] = useState(false)
	const [recipientDraft, setRecipientDraft] = useState(to)
	const draftRevision = useRef(0)
	const savedSnapshot = useRef<DraftPersistenceInput | null>(null)
	const initialDraft = useRef(draft)
	const [error, setError] = useState<string | null>(null)
	const [recipientError, setRecipientError] = useState<string | null>(null)
	const dirty = useRef(false)
	const submitting = useRef(false)
	const discarding = useRef(false)
	const draftIdRef = useRef<string | undefined>(draft?.id)
	const draftQueue = useRef<Promise<void>>(Promise.resolve())
	const draftQueuePending = useRef(0)
	const attachmentInputRef = useRef<HTMLInputElement>(null)
	const recipientInputRef = useRef<RecipientInputHandle>(null)
	const attachmentsRef = useRef<ComposeAttachment[]>([])
	const attachmentTask = useRef<Promise<boolean>>(Promise.resolve(true))
	const attachingRef = useRef(false)
	const closingRef = useRef(false)
	const composePanelRef = useRef<HTMLDivElement>(null)
	const [attachments, setAttachments] = useState<ComposeAttachment[]>([])
	const [attaching, setAttaching] = useState(false)
	const [closing, setClosing] = useState(false)
	const [savingDraft, setSavingDraft] = useState(false)
	const mobileCompose = useMobileComposePresentation()
	const [preferences] = useUserPreferences()
	const currentRecipients = useCallback(
		() => recipientInputRef.current?.getCurrentValue() ?? recipientDraft,
		[recipientDraft],
	)

	// Draft bodies can contain legacy HTML or OwnMail's markdown envelope. Decode
	// only after hydration because the conversion uses browser DOM APIs.
	useEffect(() => {
		const decodedBody = seedToMarkdown(draftBody)
		if (initialDraft.current) {
			savedSnapshot.current = {
				to: initialDraft.current.to?.map((person) => person.email).join(', ') ?? '',
				subject: initialDraft.current.subject ?? '',
				body: decodedBody,
				attachments: [],
			}
		}
		setBody(decodedBody)
	}, [draftBody])
	const navigateAfterClose = onClosed

	const requestConfirmation = useCallback((action: 'discard' | 'send') => {
		confirmationReturnFocus.current = document.activeElement as HTMLElement | null
		confirmationRef.current = action
		setConfirmation(action)
	}, [])

	function dismissConfirmation() {
		confirmationRef.current = null
		setConfirmation(null)
	}

	const persistDraft = useCallback(
		async ({ to, subject, body, attachments, replyToMessageId }: DraftPersistenceInput, revision: number) => {
			const savedDraft = await saveDraft({
				...(draftIdRef.current ? { draftId: draftIdRef.current } : {}),
				to,
				subject,
				// Enveloped so reloading can tell markdown from legacy HTML drafts.
				body: body ? markdownToDraftBody(body) : '',
				...(attachments.length ? { attachments } : {}),
				...(replyToMessageId ? { replyToMessageId } : {}),
			})
			draftIdRef.current = savedDraft.draftId
			savedSnapshot.current = { to, subject, body, attachments, replyToMessageId }
			// A slower save must not mark text typed since it started as safely stored.
			if (revision === draftRevision.current) {
				dirty.current = false
				setSaved(true)
				setAutosaveFailed(false)
			}
			return savedDraft.draftId
		},
		[saveDraft],
	)

	const queueDraftPersistence = useCallback(
		(input: DraftPersistenceInput) => {
			const revision = draftRevision.current
			draftQueuePending.current += 1
			setSavingDraft(true)
			const queued = draftQueue.current.then(() => persistDraft(input, revision))
			draftQueue.current = queued.then(
				() => undefined,
				() => undefined,
			)
			void queued.then(
				() => {
					draftQueuePending.current -= 1
					if (draftQueuePending.current === 0) setSavingDraft(false)
				},
				() => {
					draftQueuePending.current -= 1
					if (draftQueuePending.current === 0) setSavingDraft(false)
				},
			)
			return queued
		},
		[persistDraft],
	)

	const close = useCallback(async () => {
		if (
			closingRef.current ||
			submitting.current ||
			discarding.current ||
			manualSaving.current ||
			confirmationRef.current
		)
			return

		const currentTo = currentRecipients()
		const hasVisibleDraft = Boolean(currentTo || subject || body || attachmentsRef.current.length)
		if (!hasVisibleDraft && !draftIdRef.current && !attachingRef.current) {
			navigateAfterClose()
			return
		}

		closingRef.current = true
		setClosing(true)
		setError(null)
		try {
			if (attachingRef.current && !(await attachmentTask.current)) {
				closingRef.current = false
				setClosing(false)
				return
			}

			// Reaching here means there is something to keep: visible fields, or an
			// attachment that just finished reading (a failed read returned above).
			await draftQueue.current
			await queueDraftPersistence({
				to: currentTo,
				subject,
				body,
				attachments: attachmentsRef.current,
				replyToMessageId,
			})
			navigateAfterClose()
		} catch (error) {
			setError(draftSaveErrorMessage(error))
			closingRef.current = false
			setClosing(false)
		}
	}, [body, navigateAfterClose, queueDraftPersistence, replyToMessageId, subject, currentRecipients])

	// Autosave a draft 3s after the last edit.
	useEffect(() => {
		draftRevision.current += 1
		const currentTo = currentRecipients()
		const snapshot = savedSnapshot.current
		if (
			draftQueuePending.current === 0 &&
			snapshot &&
			snapshot.to === currentTo &&
			snapshot.subject === subject &&
			snapshot.body === body &&
			snapshot.attachments.length === attachments.length &&
			snapshot.attachments.every((attachment, index) => attachment === attachments[index])
		) {
			dirty.current = false
			setSaved(true)
			setAutosaveFailed(false)
			return
		}
		dirty.current = true
		setSaved(false)
		const timer = setTimeout(async () => {
			if (
				submitting.current ||
				discarding.current ||
				!dirty.current ||
				(!currentTo && !subject && !body && attachments.length === 0 && !draftIdRef.current)
			)
				return
			try {
				await queueDraftPersistence({ to: currentTo, subject, body, attachments, replyToMessageId })
			} catch {
				setAutosaveFailed(true)
			}
		}, 3000)
		return () => clearTimeout(timer)
	}, [subject, body, attachments, replyToMessageId, queueDraftPersistence, currentRecipients])

	useEffect(() => {
		function warnUnsaved(event: BeforeUnloadEvent) {
			const currentTo = currentRecipients()
			const hasContent = Boolean(currentTo || subject || body || attachmentsRef.current.length)
			if (
				(dirty.current && (hasContent || draftIdRef.current)) ||
				draftQueuePending.current > 0 ||
				attachingRef.current
			) {
				event.preventDefault()
				event.returnValue = ''
			}
		}
		window.addEventListener('beforeunload', warnUnsaved)
		return () => window.removeEventListener('beforeunload', warnUnsaved)
	}, [body, subject, currentRecipients])

	async function addAttachments(files: FileList | null) {
		if (!files?.length) return
		if (attachingRef.current) return
		const selected = [...files]
		const currentAttachments = attachmentsRef.current
		if (currentAttachments.length + selected.length > MAX_COMPOSE_ATTACHMENTS) {
			setError(`Attach up to ${MAX_COMPOSE_ATTACHMENTS} files.`)
			return
		}
		const totalBytes = currentAttachments.reduce((sum, attachment) => sum + attachmentBytes(attachment), 0)
		const nextBytes = selected.reduce((sum, file) => sum + file.size, totalBytes)
		if (nextBytes > MAX_COMPOSE_ATTACHMENT_BYTES) {
			setError('Attachments must be under 2 MB total.')
			return
		}
		attachingRef.current = true
		setAttaching(true)
		const task = Promise.all(selected.map(fileToAttachment))
			.then((nextAttachments) => {
				const next = [...attachmentsRef.current, ...nextAttachments]
				attachmentsRef.current = next
				setAttachments(next)
				dirty.current = true
				setError(null)
				return true
			})
			.catch(() => {
				setError('Could not attach the file. Check the file and try again.')
				return false
			})
			.finally(() => {
				// No other read can start while this one runs (addAttachments returns early),
				// so this task is still the current one.
				attachingRef.current = false
				setAttaching(false)
			})
		attachmentTask.current = task
		await task
	}

	function removeAttachment(index: number) {
		const next = attachmentsRef.current.filter((_, currentIndex) => currentIndex !== index)
		attachmentsRef.current = next
		setAttachments(next)
		dirty.current = true
	}

	const submit = useCallback(
		async (allowEmptySubject = false) => {
			if (
				submitting.current ||
				discarding.current ||
				closingRef.current ||
				attachingRef.current ||
				manualSaving.current ||
				confirmationRef.current
			)
				return
			const currentTo = currentRecipients()
			const recipientValidation = validateRecipientEmails(currentTo, { required: true })
			if (recipientValidation.error) {
				setRecipientError(
					recipientValidation.error === 'required'
						? 'Add at least one recipient before sending.'
						: 'Enter a valid email address for each recipient before sending.',
				)
				setError(null)
				focusComposeTarget('compose-to')
				return
			}

			setRecipientError(null)
			if (currentTo !== to) setTo(currentTo)
			if (!subject.trim() && !allowEmptySubject) {
				requestConfirmation('send')
				return
			}
			submitting.current = true
			setBusy(true)
			setError(null)
			try {
				const id = await queueDraftPersistence({
					to: currentTo,
					subject,
					body,
					attachments: attachmentsRef.current,
					replyToMessageId,
				})
				await sendDraftMutation.mutateAsync({
					draftId: id,
					to: currentTo,
					subject,
					// The editor holds markdown; outgoing mail carries inline-styled HTML.
					body: markdownToEmailHtml(body),
					// The provider draft was just saved with the current attachments.
					// sendDraft restores them server-side, avoiding duplicate files.
					...(replyToMessageId ? { replyToMessageId } : {}),
				})
				if (preferences.autoSaveContacts) {
					void runTrackedWrite(queryClient, () =>
						saveComposeRecipients({
							data: {
								emails: recipientValidation.emails,
							},
						}),
					)
						.then((receipt) => {
							for (const contact of receipt.contacts) {
								applyContactEffect(queryClient, { type: 'created', contact })
							}
						})
						.catch(() => undefined)
				}
				onSent()
			} catch {
				setError('Could not send your message. Check your connection, then try again.')
				setBusy(false)
				submitting.current = false
			}
		},
		[
			body,
			onSent,
			currentRecipients,
			preferences.autoSaveContacts,
			queryClient,
			queueDraftPersistence,
			replyToMessageId,
			requestConfirmation,
			sendDraftMutation,
			subject,
			to,
		],
	)

	const saveNow = useCallback(async () => {
		if (
			submitting.current ||
			discarding.current ||
			closingRef.current ||
			attachingRef.current ||
			manualSaving.current ||
			confirmationRef.current
		)
			return
		manualSaving.current = true
		setBusy(true)
		setError(null)
		setAutosaveFailed(false)
		try {
			await queueDraftPersistence({
				to: currentRecipients(),
				subject,
				body,
				attachments: attachmentsRef.current,
				replyToMessageId,
			})
		} catch (error) {
			setError(draftSaveErrorMessage(error))
		} finally {
			manualSaving.current = false
			setBusy(false)
		}
	}, [body, queueDraftPersistence, replyToMessageId, subject, currentRecipients])

	async function discard(confirmed = false) {
		if (
			submitting.current ||
			discarding.current ||
			closingRef.current ||
			attachingRef.current ||
			manualSaving.current ||
			confirmationRef.current
		)
			return
		if (
			!confirmed &&
			(to.trim() ||
				recipientInputRef.current?.getCurrentValue().trim() ||
				subject.trim() ||
				body.trim() ||
				attachmentsRef.current.length ||
				draft?.attachments?.length)
		) {
			requestConfirmation('discard')
			return
		}
		discarding.current = true
		setBusy(true)
		setError(null)
		try {
			await draftQueue.current
			const savedDraftId = draftIdRef.current
			if (savedDraftId) await deleteDraftMutation.mutateAsync(savedDraftId)
			navigateAfterClose()
		} catch {
			setError('Could not discard the draft. Check your connection, then try again.')
			setBusy(false)
			discarding.current = false
		}
	}

	useEffect(() => {
		const timer = setTimeout(() => {
			if (!confirmationRef.current) focusComposeTarget(initialFocusTarget.current)
			// Inline in a thread, the whole card comes into view, Send included.
			composePanelRef.current?.scrollIntoView?.({ block: 'nearest' })
		}, 0)
		return () => clearTimeout(timer)
	}, [])

	useEffect(() => {
		if (!mobileCompose || minimized || confirmation) return
		function trapMobileComposeFocus(event: KeyboardEvent) {
			if (event.key !== 'Tab') return
			const panel = composePanelRef.current
			/* v8 ignore next -- the listener is added after the panel mounts and removed before it unmounts, so the ref is always set here; the guard only narrows the type -- @preserve */
			if (!panel) return
			const controls = visibleComposeControls(panel)
			if (controls.length === 0) {
				event.preventDefault()
				panel.focus()
				return
			}
			const first = controls[0] as HTMLElement
			const last = controls.at(-1) as HTMLElement
			const active = document.activeElement
			if (event.shiftKey && (active === first || !panel.contains(active))) {
				event.preventDefault()
				last.focus()
			} else if (!event.shiftKey && (active === last || !panel.contains(active))) {
				event.preventDefault()
				first.focus()
			}
		}
		document.addEventListener('keydown', trapMobileComposeFocus)
		return () => document.removeEventListener('keydown', trapMobileComposeFocus)
	}, [confirmation, minimized, mobileCompose])

	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			if (confirmationRef.current) return
			if (!composePanelRef.current?.contains(event.target as Node) || event.defaultPrevented) return
			const target = event.target as HTMLElement | null
			const isTyping =
				target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
			if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !busy && !attaching && !closing) {
				event.preventDefault()
				void submit()
			}
			if (
				(event.metaKey || event.ctrlKey) &&
				event.key.toLowerCase() === 's' &&
				!busy &&
				!attaching &&
				!closing
			) {
				event.preventDefault()
				void saveNow()
			}
			if (
				event.key === 'Escape' &&
				!busy &&
				!closing &&
				!isTyping &&
				!event.metaKey &&
				!event.ctrlKey &&
				!event.altKey
			) {
				event.preventDefault()
				void close()
			}
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [attaching, busy, close, closing, saveNow, submit])

	useImperativeHandle(handleRef, () => ({ close }), [close])

	const inlineReply = Boolean(replyToMessageId && !mobileCompose && inlineSlot)

	return placeComposer(
		// biome-ignore lint/a11y/useAriaPropsSupportedByRole: the role is a dialog or a region, and both take aria-label; biome cannot read a conditional role.
		<div
			ref={composePanelRef}
			data-minimized={minimized ? 'true' : 'false'}
			data-presentation={inlineReply ? 'inline' : 'floating'}
			aria-busy={busy || attaching || closing || savingDraft}
			aria-label={inlineReply ? 'Reply' : 'Compose message'}
			aria-modal={mobileCompose && !minimized ? true : undefined}
			role={inlineReply ? 'region' : 'dialog'}
			tabIndex={-1}
			// Panel glass where it floats; a full-screen editor on a phone is solid (design.md "Glass layer").
			// Inline in the thread it is a card in the flow, on the plane.
			data-glass={mobileCompose ? 'solid' : undefined}
			className={cn(
				'compose-panel flex flex-col overflow-hidden',
				inlineReply
					? 'compose-panel-inline'
					: 'glass-panel fixed z-50 max-md:pr-[env(safe-area-inset-right)] max-md:pl-[env(safe-area-inset-left)]',
			)}
		>
			<div
				className={cn(
					'flex min-h-11 items-center justify-between border-b border-[var(--glass-line)] px-3 pb-3 text-foreground md:pt-3',
					minimized ? 'pt-3' : 'pt-[calc(0.75rem+var(--safe-area-top))]',
				)}
			>
				<div className="flex min-w-0 items-center gap-2">
					<span className="truncate text-sm font-semibold">{subject || 'New message'}</span>
					{busy ? (
						<span className="text-xs shrink-0 text-muted-foreground">
							{submitting.current ? 'Sending…' : discarding.current ? 'Discarding…' : 'Saving…'}
						</span>
					) : null}
					{!busy && attaching ? (
						<span className="text-xs shrink-0 text-muted-foreground">Attaching…</span>
					) : null}
					{!busy && !attaching && (closing || savingDraft) ? (
						<span className="text-xs shrink-0 text-muted-foreground">Saving…</span>
					) : null}
					{!busy && !attaching && !closing && !savingDraft && saved ? (
						<span className="text-xs shrink-0 text-muted-foreground">Saved</span>
					) : null}
					{!busy &&
					!attaching &&
					!closing &&
					!savingDraft &&
					!saved &&
					(recipientDraft || to || subject || body || attachments.length || draftIdRef.current) ? (
						<span className="text-xs shrink-0 text-muted-foreground">Unsaved changes</span>
					) : null}
				</div>
				<div className="flex items-center gap-1">
					<Button
						type="button"
						variant="ghost"
						size="icon"
						onClick={() => {
							// Preserve an uncommitted recipient before its field unmounts.
							const recipients = currentRecipients()
							setTo(recipients)
							setRecipientDraft(recipients)
							setMinimized((value) => !value)
						}}
						aria-label={minimized ? 'Restore composer' : 'Minimize composer'}
						aria-expanded={!minimized}
						className={cn(
							'items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground',
							// A reply in the flow has nothing to get out of the way of.
							inlineReply ? 'hidden' : minimized ? 'flex' : 'hidden md:flex',
						)}
					>
						{minimized ? <Maximize2 className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						onClick={() => void close()}
						disabled={busy || closing}
						aria-label="Save and close"
						title="Save and close"
						className="flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
					>
						<X className="h-4 w-4" />
					</Button>
				</div>
			</div>

			<Dialog open={confirmation !== null} onOpenChange={dismissConfirmation}>
				<DialogContent
					className="p-6"
					aria-describedby="compose-confirmation-description"
					onOpenAutoFocus={(event) => {
						event.preventDefault()
						confirmationCancelRef.current?.focus()
					}}
					onCloseAutoFocus={(event) => {
						event.preventDefault()
						if (!submitting.current && !discarding.current) confirmationReturnFocus.current?.focus()
					}}
				>
					<DialogTitle className="text-base font-semibold">
						{confirmation === 'discard' ? 'Discard this draft?' : 'Send without a subject?'}
					</DialogTitle>
					<p id="compose-confirmation-description" className="mt-2 text-sm text-muted-foreground">
						{confirmation === 'discard'
							? 'Your message and attachments will be deleted. This cannot be undone.'
							: 'A subject helps your recipients recognize and find your message.'}
					</p>
					<div className="mt-6 flex flex-wrap justify-end gap-2">
						<Button ref={confirmationCancelRef} variant="outline" onClick={dismissConfirmation}>
							{confirmation === 'discard' ? 'Keep draft' : 'Keep editing'}
						</Button>
						<Button
							variant={confirmation === 'discard' ? 'destructive' : 'default'}
							onClick={() => {
								const action = confirmationRef.current
								dismissConfirmation()
								if (action === 'discard') void discard(true)
								else if (action === 'send') void submit(true)
							}}
						>
							{confirmation === 'discard' ? 'Discard permanently' : 'Send without subject'}
						</Button>
					</div>
				</DialogContent>
			</Dialog>

			{!minimized ? (
				<>
					<div className="flex flex-col">
						<div className="border-b border-border text-sm">
							<div className="flex min-h-12 items-center gap-2 px-3 focus-within:bg-muted/30 focus-within:ring-[3px] focus-within:ring-inset focus-within:ring-ring">
								<span className="w-14 shrink-0 text-muted-foreground">To</span>
								<RecipientInput
									ref={recipientInputRef}
									id="compose-to"
									value={to}
									onChange={setTo}
									onEdit={() => {
										setRecipientError(null)
										setRecipientDraft(currentRecipients())
									}}
									placeholder="recipient@email.com"
									className="flex-1"
									// The row draws the one focus ring, as the subject row does.
									inputClassName="compose-field focus-visible:ring-0"
									disabled={busy || closing}
									invalid={Boolean(recipientError)}
									describedBy={recipientError ? 'compose-recipient-error' : undefined}
								/>
							</div>
							{recipientError ? (
								<p id="compose-recipient-error" role="alert" className="mt-1 pl-16 text-xs text-destructive">
									{recipientError}
								</p>
							) : null}
						</div>
						<label
							htmlFor="compose-subject"
							className="flex min-h-12 items-center gap-2 border-b border-border px-3 text-sm focus-within:bg-muted/30 focus-within:ring-[3px] focus-within:ring-inset focus-within:ring-ring"
						>
							<span className="w-14 text-muted-foreground">Subject</span>
							<input
								id="compose-subject"
								value={subject}
								disabled={busy || closing}
								onChange={(event) => setSubject(event.target.value)}
								className="compose-field h-12 min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground disabled:cursor-wait disabled:opacity-60"
							/>
						</label>
					</div>

					<MarkdownEditor
						id="compose-body"
						value={body}
						onChange={setBody}
						readOnly={busy || closing}
						className="min-h-0 flex-1"
					/>

					{attachments.length ? (
						<PillRow className="border-t border-border px-3 py-3">
							{attachments.map((attachment, index) => (
								<Chip
									key={attachment.clientId}
									action={
										<IconButton
											label={`Remove ${attachment.filename}`}
											disabled={busy || closing}
											onClick={() => removeAttachment(index)}
											className="disabled:cursor-wait"
										>
											<X />
										</IconButton>
									}
								>
									<Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
									<span className="min-w-0 truncate">{attachment.filename}</span>
									<span className="shrink-0 text-muted-foreground">
										{formatSize(attachmentBytes(attachment))}
									</span>
								</Chip>
							))}
						</PillRow>
					) : null}
					{error ? <ErrorBanner message={error} /> : null}
					{autosaveFailed ? (
						<div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2">
							<p role="alert" className="min-w-0 flex-1 text-sm text-destructive">
								Draft not saved. Keep this window open and try again.
							</p>
							<Button variant="outline" disabled={busy || attaching || closing} onClick={saveNow}>
								Retry save
							</Button>
						</div>
					) : null}
					<div className="flex flex-wrap items-center gap-2 border-t border-border px-3 pt-3 pb-[calc(0.75rem+var(--safe-area-bottom))] md:pb-3">
						<Button
							type="button"
							disabled={busy || attaching || closing}
							onClick={() => void submit()}
							aria-keyshortcuts="Meta+Enter Control+Enter"
							className="font-semibold"
						>
							<Send className="h-4 w-4" />{' '}
							{attaching ? 'Attaching...' : submitting.current ? 'Sending...' : 'Send'}
						</Button>
						<span className="shortcut-hint text-xs text-muted-foreground" aria-hidden="true">
							⌘↵
						</span>
						<Button
							type="button"
							variant="ghost"
							disabled={busy || attaching || closing}
							onClick={saveNow}
							aria-label="Save draft"
						>
							<Save className="h-4 w-4" /> <span>Save draft</span>
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							aria-label="Attach file"
							disabled={busy || attaching || closing}
							onClick={() => attachmentInputRef.current?.click()}
						>
							<Paperclip className="h-4 w-4" />
						</Button>
						<input
							ref={attachmentInputRef}
							type="file"
							multiple
							hidden
							aria-hidden="true"
							tabIndex={-1}
							onChange={(event) => {
								void addAttachments(event.target.files)
								event.target.value = ''
							}}
						/>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							disabled={busy || attaching || closing}
							onClick={() => void discard()}
							aria-label="Discard draft"
							className="ml-auto hover:text-destructive"
						>
							<Trash2 className="h-4 w-4" />
						</Button>
					</div>
				</>
			) : null}
		</div>,
	)

	function placeComposer(composer: React.ReactNode) {
		return inlineReply && inlineSlot ? createPortal(composer, inlineSlot) : composer
	}
}

async function fileToAttachment(file: File): Promise<ComposeAttachment> {
	/* v8 ignore next 3 -- defensive: addAttachments rejects any file set exceeding the 2 MB total before calling this, so a single over-size file can never reach here -- @preserve */
	if (file.size > MAX_COMPOSE_ATTACHMENT_BYTES) {
		throw new Error('Attachments must be under 2 MB total.')
	}
	return {
		clientId: newAttachmentClientId(),
		filename: safeAttachmentFilename(file.name),
		content_type: file.type || 'application/octet-stream',
		content: await fileToBase64(file),
	}
}

function safeAttachmentFilename(filename: string): string {
	const safe = [...filename.trim()]
		.map((char) => {
			const code = char.charCodeAt(0)
			return code < 32 || char === '/' || char === '\\' ? '_' : char
		})
		.join('')
	return safe || 'attachment'
}

async function fileToBase64(file: File): Promise<string> {
	const bytes = new Uint8Array(await file.arrayBuffer())
	let binary = ''
	for (let index = 0; index < bytes.length; index += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
	}
	return btoa(binary)
}

function attachmentBytes(attachment: OutboundAttachment): number {
	const padding = attachment.content.endsWith('==') ? 2 : attachment.content.endsWith('=') ? 1 : 0
	return Math.floor((attachment.content.length * 3) / 4) - padding
}

function newAttachmentClientId(): string {
	return typeof crypto.randomUUID === 'function'
		? crypto.randomUUID()
		: `attachment-${Date.now()}-${Math.random().toString(36).slice(2)}`
}
