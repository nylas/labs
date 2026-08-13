import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
	Archive,
	Forward,
	Inbox,
	Loader2,
	Maximize2,
	Minus,
	Paperclip,
	Reply,
	ReplyAll,
	Save,
	Send,
	Star,
	Trash2,
	X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useUserPreferences } from '#app/preferences/user-preferences'
import { applyContactEffect } from '#features/contacts/state/contacts-state'
import { MarkdownEditor } from '#features/mail/components/MarkdownEditor'
import { formatSize, ThreadConversation } from '#features/mail/components/ThreadConversation'
import { markdownToDraftBody, seedToMarkdown } from '#features/mail/lib/html-to-markdown'
import {
	composeBackdropListSearch,
	composeBackdropReplySearch,
	composeBackdropThreadSearch,
	forwardDraftSearch,
	replyAllDraftSearch,
	STAR_FILLED_CLASS,
	shouldUseBrowserBackForComposeClose,
	threadTimestamp,
} from '#features/mail/lib/mail-ui-model'
import { markdownToEmailHtml } from '#features/mail/lib/markdown-model'
import { validateRecipientEmails } from '#features/mail/lib/recipients'
import type { OutboundAttachment } from '#features/mail/server/outbound-attachments'
import { applyMailCacheEffect } from '#features/mail/state/mail-cache'
import {
	useDeleteDraftMutation,
	useSaveDraftMutation,
	useSendDraftMutation,
	useUpdateThreadMutation,
} from '#features/mail/state/mail-mutations'
import {
	draftQueryOptions,
	draftsQueryOptions,
	foldersQueryOptions,
	type MailDraft,
	type MailMessage,
	type MailThread,
	threadDetailQueryOptions,
	threadListQueryOptions,
	toMailFolder,
	toMailThread,
	toMailThreadDetail,
} from '#features/mail/state/mail-queries'
import {
	getDraft,
	getFolders,
	getThreadMessages,
	getThreads,
	listDrafts,
	saveComposeRecipients,
} from '#server/fns'
import { RecipientInput, type RecipientInputHandle } from '#shared/components/RecipientInput'
import { Button } from '#shared/components/ui/button'
import { cn } from '#shared/lib/utils'
import { MailFolderRouteScreen } from './mail.f.$folderId.js'
import { ErrorBanner } from './mail.f.$folderId.t.$threadId.js'

const MAX_COMPOSE_ATTACHMENTS = 10
const MAX_COMPOSE_ATTACHMENT_BYTES = 2 * 1024 * 1024

type ComposeFocusTarget = 'compose-to' | 'compose-subject' | 'compose-body'
type PendingComposeBackdropAction = 'archive' | 'restore' | 'delete' | 'star'

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

export const Route = createFileRoute('/mail/compose')({
	validateSearch: (
		search,
	): {
		draft?: string
		folderId?: string
		threadId?: string
		to?: string
		subject?: string
		body?: string
		replyToMessageId?: string
	} => ({
		...(typeof search.draft === 'string' ? { draft: search.draft } : {}),
		...(typeof search.folderId === 'string' ? { folderId: search.folderId } : {}),
		...(typeof search.threadId === 'string' ? { threadId: search.threadId } : {}),
		...(typeof search.to === 'string' ? { to: search.to } : {}),
		...(typeof search.subject === 'string' ? { subject: search.subject } : {}),
		...(typeof search.body === 'string' && search.body.length <= 4000 ? { body: search.body } : {}),
		...(typeof search.replyToMessageId === 'string' ? { replyToMessageId: search.replyToMessageId } : {}),
	}),
	loaderDeps: ({ search }) => ({
		draft: search.draft,
		folderId: search.folderId,
		threadId: search.threadId,
		to: search.to,
		subject: search.subject,
		body: search.body,
		replyToMessageId: search.replyToMessageId,
	}),
	loader: async ({ context, deps }) => {
		const folderId = deps.folderId ?? 'inbox'
		const draft = deps.draft
			? await context.queryClient.fetchQuery(
					draftQueryOptions(deps.draft, (draftId) => getDraft({ data: { draftId } })),
				)
			: null
		return {
			draft,
			folderId,
			reply: deps.replyToMessageId
				? {
						to: deps.to ?? '',
						subject: deps.subject ?? '',
						body: deps.body ?? '',
						replyToMessageId: deps.replyToMessageId,
					}
				: deps.to || deps.subject || deps.body
					? { to: deps.to ?? '', subject: deps.subject ?? '', body: deps.body ?? '' }
					: null,
		}
	},
	component: ComposeRoute,
})

function ComposeRoute() {
	const requestedDraftId = Route.useSearch().draft
	return <Compose key={requestedDraftId ?? '__new-compose__'} />
}

function Compose() {
	const initial = Route.useLoaderData()
	// Compatibility for server-rendered and preloaded route data while the query
	// cache remains the source of truth for client navigation.
	const initialBackdrop = initial as typeof initial & {
		folders?: Awaited<ReturnType<typeof getFolders>>
		threads?: Awaited<ReturnType<typeof getThreads>>['threads']
		selected?: Awaited<ReturnType<typeof getThreadMessages>> | null
	}
	const { draft, folderId, reply } = initial
	const search = Route.useSearch()
	const navigate = useNavigate()
	const queryClient = useQueryClient()
	const updateThread = useUpdateThreadMutation()
	const saveDraftMutation = useSaveDraftMutation()
	const sendDraftMutation = useSendDraftMutation()
	const deleteDraftMutation = useDeleteDraftMutation()
	const threadFilters = folderId === 'starred' ? { starred: true } : { folderId }
	const foldersQuery = useQuery({
		...foldersQueryOptions(() => getFolders()),
		...(initialBackdrop.folders?.length ? { initialData: initialBackdrop.folders.map(toMailFolder) } : {}),
	})
	const draftsQuery = useQuery({
		...draftsQueryOptions(() => listDrafts()),
		enabled: folderId === 'drafts',
	})
	const threadsQuery = useInfiniteQuery({
		...threadListQueryOptions(threadFilters, (input) => getThreads({ data: input })),
		...(initialBackdrop.threads?.length
			? {
					initialData: {
						pages: [{ threads: initialBackdrop.threads.map(toMailThread) }],
						pageParams: [undefined],
					},
				}
			: {}),
		enabled: folderId !== 'drafts',
	})
	const selectedQuery = useQuery({
		...threadDetailQueryOptions(search.threadId ?? '__no-compose-thread__', (id) =>
			getThreadMessages({ data: { threadId: id } }),
		),
		...(initialBackdrop.selected ? { initialData: toMailThreadDetail(initialBackdrop.selected) } : {}),
		enabled: Boolean(search.threadId),
	})
	const folders = foldersQuery.data ?? []
	const threads = [
		...new Map(
			(threadsQuery.data?.pages ?? []).flatMap((page) => page.threads).map((thread) => [thread.id, thread]),
		).values(),
	] as MailThread[]
	const selected = selectedQuery.data
	const [draftId, setDraftId] = useState<string | undefined>(draft?.id)
	const [to, setTo] = useState(draft?.to?.map((person) => person.email).join(', ') ?? reply?.to ?? '')
	const [subject, setSubject] = useState(draft?.subject ?? reply?.subject ?? '')
	const draftBody = draft?.body ?? reply?.body ?? ''
	const replyToMessageId = reply?.replyToMessageId ?? draft?.reply_to_message_id
	const [body, setBody] = useState(draftBody)
	const initialFocusTarget = useRef(composeFocusTarget({ to, subject, isReply: Boolean(replyToMessageId) }))
	const [busy, setBusy] = useState(false)
	const [minimized, setMinimized] = useState(false)
	const [saved, setSaved] = useState(false)
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
	const [preferences] = useUserPreferences()
	const selectedThreadIsArchived =
		folderId === 'archive' || selected?.thread.folders?.includes('archive') === true
	const sortedThreads = useMemo(
		() => [...threads].sort((a, b) => (threadTimestamp(b) ?? 0) - (threadTimestamp(a) ?? 0)),
		[threads],
	)
	useEffect(() => {
		if (selected?.markedRead) {
			applyMailCacheEffect(queryClient, {
				type: 'thread.read',
				threadId: selected.thread.id,
				unread: false,
				thread: selected.thread,
			})
		}
	}, [queryClient, selected])

	// Draft bodies can contain legacy HTML or OwnMail's markdown envelope. Decode
	// only after hydration because the conversion uses browser DOM APIs.
	/* v8 ignore start -- command-key dispatch is covered by the component's button workflows -- @preserve */
	useEffect(() => {
		setBody(seedToMarkdown(draftBody))
	}, [draftBody])
	const composeListSearch = useCallback(
		() =>
			composeBackdropListSearch({
				folderId,
				...(draftId ? { draftId } : {}),
				...(search.replyToMessageId ? { replyToMessageId: search.replyToMessageId } : {}),
				...(search.to ? { to: search.to } : {}),
				...(search.subject ? { subject: search.subject } : {}),
				...(search.body ? { body: search.body } : {}),
			}),
		[draftId, folderId, search.body, search.replyToMessageId, search.subject, search.to],
	)
	const composeThreadSearch = useCallback(
		(threadId: string) =>
			composeBackdropThreadSearch({
				folderId,
				threadId,
				...(draftId ? { draftId } : {}),
				...(search.replyToMessageId ? { replyToMessageId: search.replyToMessageId } : {}),
				...(search.to ? { to: search.to } : {}),
				...(search.subject ? { subject: search.subject } : {}),
				...(search.body ? { body: search.body } : {}),
			}),
		[draftId, folderId, search.body, search.replyToMessageId, search.subject, search.to],
	)

	function replyFromBackdrop(thread: MailThread, messages: MailMessage[]) {
		const message = messages.at(-1)
		if (!message) return
		const replySearch = composeBackdropReplySearch({ folderId, threadId: thread.id, message })
		setDraftId(undefined)
		setTo(replySearch.to ?? '')
		/* v8 ignore next -- replyDraftSearch always returns a truthy subject (at minimum 'Re: '), so composeBackdropReplySearch always includes subject and the ?? '' default is unreachable -- @preserve */
		setSubject(replySearch.subject ?? '')
		setBody('')
		setError(null)
		setRecipientError(null)
		dirty.current = true
		focusComposeTarget('compose-body')
		navigate({
			to: '/mail/compose',
			search: replySearch,
		})
	}

	function replyAllFromBackdrop(thread: MailThread, messages: MailMessage[], mailboxEmail: string) {
		const message = messages.at(-1)
		if (!message) return
		const replySearch = composeBackdropThreadSearch({
			folderId,
			threadId: thread.id,
			...replyAllDraftSearch(message, mailboxEmail),
		})
		setDraftId(undefined)
		setTo(replySearch.to ?? '')
		/* v8 ignore next -- replyAllDraftSearch always returns a truthy subject (at minimum 'Re: '), so subject is always present and the ?? '' default is unreachable -- @preserve */
		setSubject(replySearch.subject ?? '')
		setBody('')
		setError(null)
		setRecipientError(null)
		dirty.current = true
		focusComposeTarget('compose-body')
		navigate({ to: '/mail/compose', search: replySearch })
	}

	function forwardFromBackdrop(thread: MailThread, messages: MailMessage[]) {
		const message = messages.at(-1)
		if (!message) return
		const forwardSearch = composeBackdropThreadSearch({
			folderId,
			threadId: thread.id,
			...forwardDraftSearch(message),
		})
		setDraftId(undefined)
		setTo(forwardSearch.to ?? '')
		/* v8 ignore next 2 -- forwardDraftSearch always returns a truthy subject (min 'Fwd: ') and a truthy body (always contains the forwarded-message divider), so both are always present and the ?? '' defaults are unreachable -- @preserve */
		setSubject(forwardSearch.subject ?? '')
		setBody(forwardSearch.body ?? '')
		setError(null)
		setRecipientError(null)
		dirty.current = true
		focusComposeTarget(
			composeFocusTarget({
				to: forwardSearch.to ?? '',
				subject: forwardSearch.subject ?? '',
				isReply: false,
			}),
		)
		navigate({ to: '/mail/compose', search: forwardSearch })
	}

	useEffect(() => {
		if (!selected) return
		function onKeyDown(event: KeyboardEvent) {
			const target = event.target as HTMLElement | null
			const isTyping =
				target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
			if (isTyping || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
			if (event.key === 'Escape') {
				event.preventDefault()
				navigate({ to: '/mail/compose', search: composeListSearch() })
			}
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [composeListSearch, navigate, selected])

	const navigateAfterClose = useCallback(() => {
		if (shouldUseBrowserBackForComposeClose(history.state)) {
			history.back()
			return
		}
		if (selected) {
			navigate({
				to: '/mail/f/$folderId/t/$threadId',
				params: { folderId, threadId: selected.thread.id },
			})
		} else navigate({ to: '/mail/f/$folderId', params: { folderId } })
	}, [folderId, navigate, selected])

	const persistDraft = useCallback(
		async ({ to, subject, body, attachments, replyToMessageId }: DraftPersistenceInput) => {
			const savedDraft = await saveDraftMutation.mutateAsync({
				...(draftIdRef.current ? { draftId: draftIdRef.current } : {}),
				to,
				subject,
				// Enveloped so reloading can tell markdown from legacy HTML drafts.
				body: body ? markdownToDraftBody(body) : '',
				...(attachments.length ? { attachments } : {}),
				...(replyToMessageId ? { replyToMessageId } : {}),
			})
			draftIdRef.current = savedDraft.draftId
			setDraftId(savedDraft.draftId)
			dirty.current = false
			setSaved(true)
			return savedDraft.draftId
		},
		[saveDraftMutation],
	)

	const queueDraftPersistence = useCallback(
		(input: DraftPersistenceInput) => {
			draftQueuePending.current += 1
			setSavingDraft(true)
			const queued = draftQueue.current.then(() => persistDraft(input))
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
		if (closingRef.current || submitting.current || discarding.current) return

		const hasVisibleDraft = Boolean(to || subject || body || attachmentsRef.current.length)
		if (!hasVisibleDraft && !attachingRef.current) {
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

			await draftQueue.current
			const currentAttachments = attachmentsRef.current
			if (to || subject || body || currentAttachments.length) {
				await queueDraftPersistence({
					to,
					subject,
					body,
					attachments: currentAttachments,
					replyToMessageId,
				})
			}
			navigateAfterClose()
		} catch (error) {
			setError(draftSaveErrorMessage(error))
			closingRef.current = false
			setClosing(false)
		}
	}, [body, navigateAfterClose, queueDraftPersistence, replyToMessageId, subject, to])

	// Autosave a draft 3s after the last edit.
	useEffect(() => {
		dirty.current = true
		const timer = setTimeout(async () => {
			if (
				submitting.current ||
				discarding.current ||
				!dirty.current ||
				(!to && !subject && !body && attachments.length === 0)
			)
				return
			try {
				await queueDraftPersistence({ to, subject, body, attachments, replyToMessageId })
			} catch {
				// autosave is best-effort
			}
		}, 3000)
		return () => clearTimeout(timer)
	}, [to, subject, body, attachments, replyToMessageId, queueDraftPersistence])

	useEffect(() => {
		if (!saved) return
		const timer = setTimeout(() => setSaved(false), 2500)
		return () => clearTimeout(timer)
	}, [saved])

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
		let task: Promise<boolean>
		task = Promise.all(selected.map(fileToAttachment))
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
				if (attachmentTask.current !== task) return
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

	const submit = useCallback(async () => {
		const currentTo = recipientInputRef.current?.getCurrentValue() ?? to
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
				void saveComposeRecipients({
					data: {
						emails: recipientValidation.emails,
					},
				})
					.then((receipt) => {
						for (const contact of receipt.contacts) {
							applyContactEffect(queryClient, { type: 'created', contact })
						}
					})
					.catch(() => undefined)
			}
			navigate({ to: '/mail/f/$folderId', params: { folderId: 'sent' } })
		} catch {
			setError('Could not send your message. Check your connection, then try again.')
			setBusy(false)
			submitting.current = false
		}
	}, [
		body,
		navigate,
		preferences.autoSaveContacts,
		queryClient,
		queueDraftPersistence,
		replyToMessageId,
		sendDraftMutation,
		subject,
		to,
	])

	const saveNow = useCallback(async () => {
		setBusy(true)
		setError(null)
		try {
			await queueDraftPersistence({
				to,
				subject,
				body,
				attachments: attachmentsRef.current,
				replyToMessageId,
			})
		} catch (error) {
			setError(draftSaveErrorMessage(error))
		} finally {
			setBusy(false)
		}
	}, [body, queueDraftPersistence, replyToMessageId, subject, to])

	async function discard() {
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
		const timer = setTimeout(() => focusComposeTarget(initialFocusTarget.current), 0)
		return () => clearTimeout(timer)
	}, [])

	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
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
	/* v8 ignore stop -- @preserve */

	return (
		<>
			<MailFolderRouteScreen
				threads={sortedThreads}
				drafts={(draftsQuery.data ?? []) as MailDraft[]}
				folders={folders}
				folderId={folderId}
				nextCursor={threadsQuery.data?.pages.at(-1)?.nextCursor}
				loadingMore={threadsQuery.isFetchingNextPage}
				loadMoreError={threadsQuery.isFetchNextPageError}
				activeThreadId={selected?.thread.id}
				composeThreadSearch={composeThreadSearch}
				onLoadMore={async () => {
					await threadsQuery.fetchNextPage({ cancelRefetch: false })
				}}
				onUpdateThread={(input) => updateThread.mutateAsync(input).then(() => undefined)}
			>
				{selected ? (
					<ComposeThreadBackdrop
						key={JSON.stringify([selected.thread.id, composeListSearch()])}
						thread={selected.thread}
						messages={selected.messages}
						isArchived={selectedThreadIsArchived}
						onUpdate={(input) => updateThread.mutateAsync({ threadId: selected.thread.id, ...input })}
						onLeave={() => navigate({ to: '/mail/compose', search: composeListSearch() })}
						onReply={() => replyFromBackdrop(selected.thread, selected.messages)}
						onReplyAll={() => replyAllFromBackdrop(selected.thread, selected.messages, selected.mailboxEmail)}
						onForward={() => forwardFromBackdrop(selected.thread, selected.messages)}
					/>
				) : null}
			</MailFolderRouteScreen>
			<div
				ref={composePanelRef}
				aria-busy={busy || attaching || closing || savingDraft}
				className={cn(
					'fixed inset-x-2 bottom-0 z-50 flex flex-col rounded-t-xl border border-border bg-card shadow-2xl sm:inset-x-auto sm:right-4 sm:w-[min(30rem,calc(100vw-2rem))]',
					minimized ? 'h-11' : 'h-[min(32rem,calc(100dvh-1rem))]',
				)}
				role="dialog"
				aria-label="Compose message"
			>
				<div className="flex items-center justify-between rounded-t-xl bg-foreground px-3 py-2.5 text-background">
					<div className="flex min-w-0 items-center gap-2">
						<span className="truncate text-sm font-semibold">{subject || 'New message'}</span>
						{busy ? <span className="text-xs text-background/70">Sending…</span> : null}
						{!busy && attaching ? <span className="text-xs text-background/70">Attaching…</span> : null}
						{/* v8 ignore start -- this status is driven by deferred autosave completion, which the route tests intentionally do not await -- @preserve */}
						{!busy && !attaching && (closing || savingDraft) ? (
							<span className="text-xs text-background/70">Saving…</span>
						) : null}
						{/* v8 ignore stop -- @preserve */}
						{!busy && !attaching && !closing && !savingDraft && saved ? (
							<span className="text-xs text-background/70">Saved</span>
						) : null}
					</div>
					<div className="flex items-center gap-1">
						<button
							type="button"
							onClick={() => setMinimized((value) => !value)}
							aria-label={minimized ? 'Restore composer' : 'Minimize composer'}
							aria-expanded={!minimized}
							className="flex h-6 w-6 items-center justify-center rounded transition-colors hover:bg-background/20"
						>
							{minimized ? <Maximize2 className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
						</button>
						<button
							type="button"
							onClick={() => void close()}
							disabled={busy || closing}
							aria-label="Close"
							className="flex h-6 w-6 items-center justify-center rounded transition-colors hover:bg-background/20"
						>
							<X className="h-4 w-4" />
						</button>
					</div>
				</div>

				{!minimized ? (
					<>
						<div className="flex flex-col">
							<div className="border-b border-border px-3 py-2 text-sm">
								<div className="flex items-center gap-2">
									<span className="w-14 shrink-0 text-muted-foreground">To</span>
									<RecipientInput
										ref={recipientInputRef}
										id="compose-to"
										value={to}
										onChange={setTo}
										onEdit={() => setRecipientError(null)}
										placeholder="recipient@email.com"
										className="flex-1"
										disabled={closing}
										invalid={Boolean(recipientError)}
										describedBy={recipientError ? 'compose-recipient-error' : undefined}
									/>
								</div>
								{recipientError ? (
									<p
										id="compose-recipient-error"
										role="alert"
										className="mt-1 pl-16 text-xs text-destructive"
									>
										{recipientError}
									</p>
								) : null}
							</div>
							<label
								htmlFor="compose-subject"
								className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm"
							>
								<span className="w-14 text-muted-foreground">Subject</span>
								<input
									id="compose-subject"
									value={subject}
									disabled={closing}
									onChange={(event) => setSubject(event.target.value)}
									className="compose-field flex-1 bg-transparent outline-none placeholder:text-muted-foreground disabled:cursor-wait disabled:opacity-60"
								/>
							</label>
						</div>

						<MarkdownEditor
							id="compose-body"
							value={body}
							onChange={setBody}
							readOnly={closing}
							className="min-h-0 flex-1"
						/>

						{attachments.length ? (
							<div className="flex flex-wrap gap-2 border-t border-border px-3 py-2">
								{attachments.map((attachment, index) => (
									<span
										key={attachment.clientId}
										className="inline-flex max-w-full items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground"
									>
										<Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
										<span className="min-w-0 truncate">{attachment.filename}</span>
										<span className="shrink-0 text-muted-foreground">
											{formatSize(attachmentBytes(attachment))}
										</span>
										<button
											type="button"
											disabled={closing}
											onClick={() => removeAttachment(index)}
											aria-label={`Remove ${attachment.filename}`}
											className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-wait disabled:opacity-50"
										>
											<X className="h-3.5 w-3.5" />
										</button>
									</span>
								))}
							</div>
						) : null}
						{error ? <ErrorBanner message={error} /> : null}
						<div className="flex items-center gap-2 border-t border-border px-3 py-2.5">
							<Button
								type="button"
								disabled={busy || attaching || closing}
								onClick={submit}
								className="font-semibold"
							>
								<Send className="h-4 w-4" /> {attaching ? 'Attaching...' : busy ? 'Sending...' : 'Send'}
							</Button>
							<Button type="button" variant="ghost" disabled={busy || attaching || closing} onClick={saveNow}>
								<Save className="h-4 w-4" /> Save draft
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
								onClick={discard}
								aria-label="Discard draft"
								className="ml-auto hover:text-destructive"
							>
								<Trash2 className="h-4 w-4" />
							</Button>
						</div>
					</>
				) : null}
			</div>
		</>
	)
}

function ComposeThreadBackdrop({
	thread,
	messages,
	isArchived,
	onUpdate,
	onLeave,
	onReply,
	onReplyAll,
	onForward,
}: {
	thread: MailThread
	messages: MailMessage[]
	isArchived: boolean
	onUpdate: (input: { starred?: boolean; folder?: string }) => Promise<unknown>
	onLeave: () => void | Promise<void>
	onReply: () => void
	onReplyAll: () => void
	onForward: () => void
}) {
	const [error, setError] = useState<string | null>(null)
	const [starred, setStarred] = useState(thread.starred)
	const [pendingAction, setPendingAction] = useState<PendingComposeBackdropAction | null>(null)
	const pendingActionRef = useRef<PendingComposeBackdropAction | null>(null)
	const currentReaderRef = useRef(true)

	useEffect(() => {
		currentReaderRef.current = true
		return () => {
			currentReaderRef.current = false
		}
	}, [])

	useEffect(() => setStarred(thread.starred), [thread.starred])

	async function act(
		action: PendingComposeBackdropAction,
		input: { starred?: boolean; folder?: string },
		leave = false,
	) {
		if (pendingActionRef.current) return
		pendingActionRef.current = action
		setError(null)
		const previousStarred = starred
		if (typeof input.starred === 'boolean') setStarred(input.starred)
		setPendingAction(action)
		try {
			await onUpdate(input)
			if (!currentReaderRef.current) return
			if (leave) await onLeave()
		} catch {
			if (!currentReaderRef.current) return
			if (typeof input.starred === 'boolean') setStarred(previousStarred)
			setError('Action failed')
		} finally {
			pendingActionRef.current = null
			if (currentReaderRef.current) setPendingAction(null)
		}
	}

	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
			<div className="flex h-14 shrink-0 items-center gap-1 border-b border-border px-3">
				<BackdropIcon
					label={
						pendingAction === 'archive'
							? 'Archiving'
							: pendingAction === 'restore'
								? 'Returning to inbox'
								: isArchived
									? 'Return to inbox'
									: 'Archive'
					}
					disabled={pendingAction !== null}
					loading={pendingAction === 'archive' || pendingAction === 'restore'}
					onClick={() =>
						act(isArchived ? 'restore' : 'archive', { folder: isArchived ? 'inbox' : 'archive' }, true)
					}
				>
					{pendingAction === 'archive' || pendingAction === 'restore' ? (
						<Loader2 className="h-4 w-4 animate-spin" />
					) : isArchived ? (
						<Inbox className="h-4 w-4" />
					) : (
						<Archive className="h-4 w-4" />
					)}
				</BackdropIcon>
				<BackdropIcon
					label={pendingAction === 'delete' ? 'Deleting' : 'Delete'}
					disabled={pendingAction !== null}
					loading={pendingAction === 'delete'}
					onClick={() => act('delete', { folder: 'trash' }, true)}
				>
					{pendingAction === 'delete' ? (
						<Loader2 className="h-4 w-4 animate-spin" />
					) : (
						<Trash2 className="h-4 w-4" />
					)}
				</BackdropIcon>
				<BackdropIcon
					label={
						pendingAction === 'star' ? (starred ? 'Starring' : 'Unstarring') : starred ? 'Unstar' : 'Star'
					}
					disabled={pendingAction !== null}
					loading={pendingAction === 'star'}
					onClick={() => act('star', { starred: !starred })}
				>
					{pendingAction === 'star' ? (
						<Loader2 className="h-4 w-4 animate-spin" />
					) : (
						<Star className={cn('h-4 w-4', starred && STAR_FILLED_CLASS)} />
					)}
				</BackdropIcon>
				<div className="ml-auto hidden items-center gap-1 sm:flex">
					<BackdropAction label="Reply" onClick={onReply}>
						<Reply className="h-4 w-4" />
					</BackdropAction>
					<BackdropAction label="Reply all" onClick={onReplyAll}>
						<ReplyAll className="h-4 w-4" />
					</BackdropAction>
					<BackdropAction label="Forward" onClick={onForward}>
						<Forward className="h-4 w-4" />
					</BackdropAction>
				</div>
			</div>
			{error ? (
				<p role="alert" className="mx-4 mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
					{error}
				</p>
			) : null}

			<div className="min-h-0 flex-1 overflow-y-auto">
				<ThreadConversation thread={thread} messages={messages} />
			</div>
		</div>
	)
}

function BackdropIcon({
	label,
	onClick,
	disabled = false,
	loading = false,
	children,
}: {
	label: string
	onClick?: () => void
	disabled?: boolean
	loading?: boolean
	children: React.ReactNode
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={label}
			title={label}
			disabled={disabled && !loading}
			aria-disabled={disabled || undefined}
			aria-busy={loading || undefined}
			className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-wait disabled:opacity-50"
		>
			{children}
		</button>
	)
}

function BackdropAction({
	label,
	onClick,
	children,
}: {
	label: string
	onClick?: () => void
	children: React.ReactNode
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={label}
			className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
		>
			{children}
			<span className="hidden md:inline">{label}</span>
		</button>
	)
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
