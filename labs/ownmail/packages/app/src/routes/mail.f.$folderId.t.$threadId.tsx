import type { Message, Thread } from '@nylas-labs/cli-kit/v3'
import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
	Archive,
	ArrowLeft,
	Forward,
	Inbox,
	Loader2,
	MailOpen,
	Reply,
	ReplyAll,
	Star,
	Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useUserPreferences } from '#app/preferences/user-preferences'
import { ensureMailboxInfo } from '#app/query/mailbox-info'
import { ThreadColumn } from '#features/mail/components/ThreadColumn'
import { THREAD_TOOLBAR_ACTIONS_ID, ThreadConversation } from '#features/mail/components/ThreadConversation'
import { ThreadReaderSkeleton } from '#features/mail/components/ThreadReaderSkeleton'
import { MobileThreadResponseActions } from '#features/mail/components/ThreadResponseActions'
import {
	forwardDraftSearch,
	replyAllDraftSearch,
	replyDraftSearch,
	STAR_FILLED_CLASS,
	threadNeighbours,
} from '#features/mail/lib/mail-ui-model'
import { readingPaneLayout } from '#features/mail/lib/reading-pane'
import { findCachedThread } from '#features/mail/state/mail-cache'
import {
	markThreadReadOnOpen,
	openThreadDetail,
	useUpdateThreadMutation,
} from '#features/mail/state/mail-mutations'
import {
	type MailThreadDetail,
	type MailThreadListData,
	mailKeys,
	threadDetailQueryOptions,
	toMailThread,
	toMailThreadDetail,
} from '#features/mail/state/mail-queries'
import { getThreadMessages, getThreads } from '#server/fns'
import { IconButton as ToolbarIconButton } from '#shared/components/ui/icon-button'
import { ScrollArea } from '#shared/components/ui/scroll-area'
import { Toolbar } from '#shared/components/ui/toolbar'
import { useHorizontalSwipe } from '#shared/hooks/use-horizontal-swipe'
import { cn } from '#shared/lib/utils'

export const Route = createFileRoute('/mail/f/$folderId/t/$threadId')({
	validateSearch: (search): { baseFolderId?: string } => ({
		...(typeof search.baseFolderId === 'string' ? { baseFolderId: search.baseFolderId } : {}),
	}),
	loader: async ({ context, params, preload }) => {
		// The mailbox comes first: the detail key is partitioned by account.
		await ensureMailboxInfo(context.queryClient)
		const options = threadDetailQueryOptions(params.threadId, (threadId) =>
			getThreadMessages({ data: { threadId } }),
		)
		return openThreadDetail(
			context.queryClient,
			params.threadId,
			{ preload, queryKey: options.queryKey },
			() => context.queryClient.ensureQueryData(options),
		)
	},
	component: KeyedThreadView,
	pendingComponent: ThreadPending,
})

/** The older conversation to open after triage. When the open thread is the
 * oldest loaded row but the folder has more pages, the next page is loaded
 * (and kept in the list cache) so triage continues across page boundaries.
 * The page is written only once the triage mutation has settled: its commit
 * rebuilds the cache from an earlier snapshot and would discard the page. */
async function nextConversationAfterTriage(
	queryClient: QueryClient,
	folderId: string,
	threadId: string,
	mutationSettled: Promise<void>,
): Promise<string | undefined> {
	const filters = folderId === 'starred' ? { starred: true } : { folderId }
	const queryKey = mailKeys.threadList(filters)
	const list = queryClient.getQueryData<MailThreadListData>(queryKey)
	const loaded = (list?.pages ?? []).flatMap((page) => page.threads)
	const neighbours = threadNeighbours(loaded, threadId)
	const pageToken = list?.pages.at(-1)?.nextCursor
	if (!neighbours || neighbours.older || !pageToken) return neighbours?.older ?? neighbours?.newer
	try {
		const page = await getThreads({ data: { ...filters, pageToken } })
		const threads = page.threads.map(toMailThread)
		await mutationSettled
		queryClient.setQueryData<MailThreadListData>(queryKey, (current) =>
			current && current.pages.at(-1)?.nextCursor === pageToken
				? {
						pages: [
							...current.pages,
							{ threads, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) },
						],
						pageParams: [...current.pageParams, pageToken],
					}
				: current,
		)
		return threadNeighbours([...loaded, ...threads], threadId)?.older ?? neighbours.newer
	} catch {
		// Pagination is best effort; the newer neighbour keeps triage moving.
		return neighbours.newer
	}
}

/** Split view keeps the list beside the reader from Tailwind's `xl` breakpoint. */
const SPLIT_VIEW_QUERY = '(min-width: 80rem)'

/** Taps have no hover preload, so show the cached subject at once instead of
 * a blank reader while the conversation loads. */
function ThreadPending() {
	const { threadId } = Route.useParams()
	const queryClient = useQueryClient()
	return <ThreadReaderSkeleton subject={findCachedThread(queryClient, threadId)?.subject} />
}

type PendingThreadAction = 'archive' | 'delete' | 'star' | 'unread'

function normalizeInitialThreadDetail(
	detail:
		| MailThreadDetail
		| {
				thread: Thread
				messages: Message[]
				mailboxEmail: string
				ownmailDraftMessageIds?: string[]
		  },
): MailThreadDetail {
	return 'ownmailDraftMessageIds' in detail ? toMailThreadDetail(detail) : detail
}

const REPLY_SHORTCUT_INTERACTIVE_SELECTOR = [
	'input',
	'textarea',
	'select',
	'button',
	'a',
	'summary',
	'[contenteditable]:not([contenteditable="false"])',
	'[role="button"]',
	'[role="link"]',
	'[role="textbox"]',
	'[role="combobox"]',
	'[role="menuitem"]',
	'[role="option"]',
	'[role="switch"]',
	'[role="tab"]',
	'ownmail-email',
].join(',')

function shouldIgnoreReplyShortcut(event: KeyboardEvent): boolean {
	if (event.defaultPrevented) return true
	const composedPath = event.composedPath()
	const path = composedPath.length > 0 ? composedPath : [event.target]
	return path.some(
		(node) =>
			node instanceof HTMLElement &&
			(node.isContentEditable || node.matches(REPLY_SHORTCUT_INTERACTIVE_SELECTOR)),
	)
}

/** Action errors and in-flight actions belong to one conversation, so the view
 * lives under a key equal to the thread id instead of resetting in an effect. */
function KeyedThreadView() {
	const { threadId } = Route.useParams()
	return <ThreadView key={threadId} />
}

function ThreadView() {
	const initialDetail = Route.useLoaderData()
	const { folderId, threadId } = Route.useParams()
	const { baseFolderId } = Route.useSearch()
	const queryClient = useQueryClient()
	const { data: detail } = useQuery({
		...threadDetailQueryOptions(
			threadId,
			/* v8 ignore next -- @preserve production query wiring is covered through the isolated route screen and query-option tests */
			(id) => getThreadMessages({ data: { threadId: id } }),
		),
		initialData: normalizeInitialThreadDetail(initialDetail),
	})
	const { thread, messages, mailboxEmail } = detail
	const updateThread = useUpdateThreadMutation()
	const [{ readingPane }] = useUserPreferences()
	const navigate = useNavigate()
	const [error, setError] = useState<string | null>(null)
	// The optimistic mutation writes the star into the cached thread, so the
	// control reads the same source as the conversation beside it.
	const starred = Boolean(thread.starred)
	const [pendingAction, setPendingAction] = useState<PendingThreadAction | null>(null)
	const goBackToList = useCallback(
		() =>
			navigate({
				to: '/mail/f/$folderId',
				params: { folderId },
				search: baseFolderId ? { baseFolderId } : {},
			}),
		[baseFolderId, folderId, navigate],
	)
	const swipeHandlers = useHorizontalSwipe(goBackToList)
	const lastMessage = messages.at(-1)
	const inlineReplyRef = useRef<HTMLButtonElement>(null)
	const isArchived = folderId === 'archive' || thread.folders?.includes('archive') === true
	const reply = useCallback(() => {
		/* v8 ignore next -- every exposed reply entry point requires a latest message -- @preserve */
		if (!lastMessage) return
		navigate({
			to: '/mail/compose',
			search: { folderId, threadId, ...replyDraftSearch(lastMessage) },
		})
	}, [folderId, lastMessage, navigate, threadId])
	const replyAll = useCallback(() => {
		/* v8 ignore next -- every exposed reply-all entry point requires a latest message -- @preserve */
		if (!lastMessage) return
		navigate({
			to: '/mail/compose',
			search: {
				folderId,
				threadId,
				...replyAllDraftSearch(lastMessage, mailboxEmail),
			},
		})
	}, [folderId, lastMessage, mailboxEmail, navigate, threadId])
	const forward = useCallback(() => {
		/* v8 ignore next -- every exposed forward entry point requires a latest message -- @preserve */
		if (!lastMessage) return
		navigate({
			to: '/mail/compose',
			search: { folderId, threadId, ...forwardDraftSearch(lastMessage) },
		})
	}, [folderId, lastMessage, navigate, threadId])

	const act = useCallback(
		async (
			action: PendingThreadAction,
			input: { unread?: boolean; starred?: boolean; folder?: string },
			leave = false,
		) => {
			/* v8 ignore next -- every toolbar action is disabled while the request is pending -- @preserve */
			if (pendingAction) return
			setError(null)
			setPendingAction(action)
			// In split view, triage continues with the neighbouring conversation.
			// The list is read synchronously, before the optimistic move removes
			// this one; a next page is fetched alongside the mutation if needed.
			let settleMutation!: () => void
			const mutationSettled = new Promise<void>((resolve) => (settleMutation = resolve))
			const nextThread =
				leave &&
				action !== 'unread' &&
				readingPane !== 'none' &&
				window.matchMedia?.(SPLIT_VIEW_QUERY).matches
					? nextConversationAfterTriage(queryClient, folderId, threadId, mutationSettled)
					: undefined
			try {
				await updateThread.mutateAsync({ threadId, ...input }).finally(settleMutation)
				const nextThreadId = await nextThread
				if (nextThreadId) {
					await navigate({
						to: '/mail/f/$folderId/t/$threadId',
						params: { folderId, threadId: nextThreadId },
						search: baseFolderId ? { baseFolderId } : {},
					})
				} else if (leave) {
					await navigate({
						to: '/mail/f/$folderId',
						params: { folderId },
						search: baseFolderId ? { baseFolderId } : {},
					})
				}
			} catch {
				// The optimistic mutation has already rolled the cached thread back.
				setError('Action failed')
			} finally {
				setPendingAction(null)
			}
		},
		[baseFolderId, folderId, navigate, pendingAction, queryClient, readingPane, threadId, updateThread],
	)

	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			// An open menu owns its keys: typeahead letters and Escape stay inside it.
			if (event.target instanceof Element && event.target.closest('[role="menu"]')) return
			const key = event.key.toLowerCase()
			if (key === 'r') {
				const isModified = event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey
				if (isModified || shouldIgnoreReplyShortcut(event)) return
				if (document.querySelector('[role="dialog"]') || !lastMessage) return
				event.preventDefault()
				// Desktop: `r` lands on the inline reply field after the last message.
				// Where that field is not displayed (mobile) it cannot take focus, so
				// the shortcut opens the reply directly.
				const inlineReply = inlineReplyRef.current
				inlineReply?.focus()
				if (document.activeElement !== inlineReply) reply()
				return
			}

			const target = event.target as HTMLElement | null
			const isTyping =
				target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
			if (isTyping || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
			if (document.querySelector('[role="dialog"]')) return
			if (key === 'e') {
				event.preventDefault()
				act('archive', { folder: isArchived ? 'inbox' : 'archive' }, true)
			}
			if (event.key === '#') {
				event.preventDefault()
				act('delete', { folder: 'trash' }, true)
			}
			if (key === 's') {
				event.preventDefault()
				act('star', { starred: !starred })
			}
			if (key === 'u') {
				event.preventDefault()
				act('unread', { unread: true }, true)
			}
			if (event.key === 'Escape') {
				event.preventDefault()
				navigate({
					to: '/mail/f/$folderId',
					params: { folderId },
					search: baseFolderId ? { baseFolderId } : {},
				})
			}
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [act, baseFolderId, folderId, isArchived, lastMessage, navigate, reply, starred])

	// Server-rendered deep links skip the client loader, so the reader marks the
	// thread read once per open. Later unread states (for example "Mark unread"
	// before leaving) must not be reverted by this effect.
	const readRequestedFor = useRef<string | null>(null)
	useEffect(() => {
		if (readRequestedFor.current === threadId) return
		readRequestedFor.current = threadId
		if (thread.unread) markThreadReadOnOpen(queryClient, threadId, thread)
	}, [queryClient, thread, threadId])

	return (
		<div
			{...swipeHandlers}
			onTouchMove={(event) => {
				if (event.touches.length > 1) swipeHandlers.onTouchCancel()
			}}
			onTouchEnd={(event) => {
				if (event.touches.length > 0) {
					swipeHandlers.onTouchCancel()
					return
				}
				swipeHandlers.onTouchEnd(event)
			}}
			data-testid="thread-reader"
			className="flex min-h-0 min-w-0 flex-1 flex-col bg-background"
			style={{ touchAction: 'pan-y pinch-zoom' }}
		>
			<Toolbar className="gap-1 px-3">
				<ToolbarIconButton
					label="Back to list"
					onClick={goBackToList}
					className={cn(!readingPaneLayout(readingPane, true).wideBackControl && 'xl:hidden')}
				>
					<ArrowLeft className="size-5" />
				</ToolbarIconButton>
				<IconButton
					label={
						pendingAction === 'archive'
							? isArchived
								? 'Returning to inbox'
								: 'Archiving'
							: isArchived
								? 'Return to inbox'
								: 'Archive'
					}
					disabled={pendingAction !== null}
					loading={pendingAction === 'archive'}
					onClick={() => act('archive', { folder: isArchived ? 'inbox' : 'archive' }, true)}
				>
					{pendingAction === 'archive' ? (
						<Loader2 className="h-4 w-4 animate-spin" />
					) : isArchived ? (
						<Inbox className="h-4 w-4" />
					) : (
						<Archive className="h-4 w-4" />
					)}
				</IconButton>
				<IconButton
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
				</IconButton>
				<IconButton
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
				</IconButton>
				<IconButton
					label={pendingAction === 'unread' ? 'Marking unread' : 'Mark unread'}
					disabled={pendingAction !== null}
					loading={pendingAction === 'unread'}
					onClick={() => act('unread', { unread: true }, true)}
				>
					{pendingAction === 'unread' ? (
						<Loader2 className="h-4 w-4 animate-spin" />
					) : (
						<MailOpen className="h-4 w-4" />
					)}
				</IconButton>

				<div id={THREAD_TOOLBAR_ACTIONS_ID} className="ml-auto flex items-center gap-1" />
				{lastMessage ? (
					<div className="hidden items-center gap-1 sm:flex">
						<ActionButton label="Reply" onClick={reply}>
							<Reply className="h-4 w-4" />
						</ActionButton>
						<ActionButton label="Reply all" onClick={replyAll}>
							<ReplyAll className="h-4 w-4" />
						</ActionButton>
						<ActionButton label="Forward" onClick={forward}>
							<Forward className="h-4 w-4" />
						</ActionButton>
					</div>
				) : null}
			</Toolbar>
			{error ? <ErrorBanner message={error} /> : null}

			<ScrollArea
				key={threadId}
				// The reading position belongs to one conversation.
				scrollRestorationId={`thread:${threadId}`}
				aria-label="Thread conversation"
				className="min-h-0 flex-1"
			>
				<ThreadConversation
					thread={thread}
					messages={messages}
					mailboxEmail={mailboxEmail}
					{...(lastMessage ? { reply: { onReply: reply, onReplyAll: replyAll } } : {})}
				>
					{lastMessage ? (
						<ThreadColumn>
							<button
								ref={inlineReplyRef}
								data-slot="inline-reply"
								type="button"
								onClick={reply}
								className="hidden min-h-11 w-full items-center gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3 text-left text-sm text-muted-foreground transition-colors hover:border-ring/30 hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:flex"
							>
								<Reply className="h-4 w-4 shrink-0" />
								<span>Write a reply…</span>
							</button>
						</ThreadColumn>
					) : null}
				</ThreadConversation>
			</ScrollArea>

			{lastMessage ? (
				<MobileThreadResponseActions onReply={reply} onReplyAll={replyAll} onForward={forward} />
			) : null}
		</div>
	)
}

function IconButton({
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
	// Every control in the thread toolbar is the shared icon button, so the row
	// is one size: 36px with a fine pointer, 44px on narrow and touch screens.
	return (
		<ToolbarIconButton label={label} onClick={onClick} disabled={disabled} aria-busy={loading || undefined}>
			{children}
		</ToolbarIconButton>
	)
}

function ActionButton({
	label,
	onClick,
	children,
}: {
	label: string
	onClick?: () => void
	children: React.ReactNode
}) {
	return (
		<ToolbarIconButton label={label} onClick={onClick}>
			{children}
		</ToolbarIconButton>
	)
}

export function ErrorBanner({ message }: { message: string }) {
	const isQuota = message.startsWith('QUOTA:')
	return (
		<p role="alert" className="mx-4 mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
			{isQuota ? message.slice(6).trim() : message}
		</p>
	)
}
