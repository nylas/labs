import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { Archive, ArrowLeft, Forward, Loader2, MailOpen, Reply, ReplyAll, Star, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { ThreadConversation } from '../components/ThreadConversation.js'
import {
	cn,
	forwardDraftSearch,
	replyAllDraftSearch,
	replyDraftSearch,
	STAR_FILLED_CLASS,
} from '../components/ui-model.js'
import { getThreadMessages, updateThreadState } from '../server/fns.js'

export const Route = createFileRoute('/mail/f/$folderId/t/$threadId')({
	validateSearch: (search): { baseFolderId?: string } => ({
		...(typeof search.baseFolderId === 'string' ? { baseFolderId: search.baseFolderId } : {}),
	}),
	loader: async ({ params }) => getThreadMessages({ data: { threadId: params.threadId } }),
	component: ThreadView,
})

function ThreadView() {
	const { thread, messages, mailboxEmail, markedRead } = Route.useLoaderData()
	const { folderId, threadId } = Route.useParams()
	const { baseFolderId } = Route.useSearch()
	const router = useRouter()
	const navigate = useNavigate()
	const [error, setError] = useState<string | null>(null)
	const [starred, setStarred] = useState(thread.starred)
	const [acting, setActing] = useState(false)
	const lastMessage = messages.at(-1)

	useEffect(() => {
		setStarred(thread.starred)
	}, [thread.starred])

	const act = useCallback(
		async (input: { unread?: boolean; starred?: boolean; folder?: string }, leave = false) => {
			/* v8 ignore next -- every toolbar action is disabled while the request is pending */
			if (acting) return
			setError(null)
			const previousStarred = starred
			if (typeof input.starred === 'boolean') setStarred(input.starred)
			setActing(true)
			try {
				await updateThreadState({ data: { threadId, ...input } })
				if (leave) {
					await navigate({
						to: '/mail/f/$folderId',
						params: { folderId },
						search: baseFolderId ? { baseFolderId } : {},
					})
				}
				await router.invalidate()
				/* v8 ignore next 3 -- a failed optimistic star action restores the previous state before surfacing its error */
			} catch (err) {
				if (typeof input.starred === 'boolean') setStarred(previousStarred)
				setError(err instanceof Error ? err.message : 'Action failed')
			} finally {
				setActing(false)
			}
		},
		[acting, baseFolderId, folderId, navigate, router, starred, threadId],
	)

	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			const target = event.target as HTMLElement | null
			const isTyping =
				target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
			if (isTyping || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
			if (event.key.toLowerCase() === 'e') {
				event.preventDefault()
				act({ folder: 'archive' }, true)
			}
			if (event.key === '#') {
				event.preventDefault()
				act({ folder: 'trash' }, true)
			}
			if (event.key.toLowerCase() === 's') {
				event.preventDefault()
				act({ starred: !starred })
			}
			if (event.key.toLowerCase() === 'u') {
				event.preventDefault()
				act({ unread: true }, true)
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
	}, [act, baseFolderId, folderId, navigate, starred])

	useEffect(() => {
		if (markedRead) router.invalidate()
	}, [markedRead, router])

	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
			<div className="flex h-14 shrink-0 items-center gap-1 border-b border-border px-3">
				<button
					type="button"
					onClick={() =>
						navigate({
							to: '/mail/f/$folderId',
							params: { folderId },
							search: baseFolderId ? { baseFolderId } : {},
						})
					}
					aria-label="Back to list"
					className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
				>
					<ArrowLeft className="h-5 w-5" />
				</button>
				<IconButton
					label={acting ? 'Working' : 'Archive'}
					disabled={acting}
					onClick={() => act({ folder: 'archive' }, true)}
				>
					{acting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}
				</IconButton>
				<IconButton
					label={acting ? 'Working' : 'Delete'}
					disabled={acting}
					onClick={() => act({ folder: 'trash' }, true)}
				>
					{acting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
				</IconButton>
				<IconButton
					label={acting ? 'Working' : starred ? 'Unstar' : 'Star'}
					disabled={acting}
					onClick={() => act({ starred: !starred })}
				>
					{acting ? (
						<Loader2 className="h-4 w-4 animate-spin" />
					) : (
						<Star className={cn('h-4 w-4', starred && STAR_FILLED_CLASS)} />
					)}
				</IconButton>
				<IconButton
					label={acting ? 'Working' : 'Mark unread'}
					disabled={acting}
					onClick={() => act({ unread: true }, true)}
				>
					{acting ? <Loader2 className="h-4 w-4 animate-spin" /> : <MailOpen className="h-4 w-4" />}
				</IconButton>

				{lastMessage ? (
					<div className="ml-auto hidden items-center gap-1 sm:flex">
						<ActionButton
							label="Reply"
							onClick={() =>
								navigate({
									to: '/mail/compose',
									search: { folderId, threadId, ...replyDraftSearch(lastMessage) },
								})
							}
						>
							<Reply className="h-4 w-4" />
						</ActionButton>
						<ActionButton
							label="Reply all"
							onClick={() =>
								navigate({
									to: '/mail/compose',
									search: {
										folderId,
										threadId,
										...replyAllDraftSearch(lastMessage, mailboxEmail),
									},
								})
							}
						>
							<ReplyAll className="h-4 w-4" />
						</ActionButton>
						<ActionButton
							label="Forward"
							onClick={() =>
								navigate({
									to: '/mail/compose',
									search: { folderId, threadId, ...forwardDraftSearch(lastMessage) },
								})
							}
						>
							<Forward className="h-4 w-4" />
						</ActionButton>
					</div>
				) : null}
			</div>
			{error ? <ErrorBanner message={error} /> : null}

			<div className="min-h-0 flex-1 overflow-y-auto">
				<ThreadConversation thread={thread} messages={messages} />
			</div>

			{lastMessage ? (
				<div className="shrink-0 border-t border-border bg-background px-5 py-3 lg:px-8">
					<button
						type="button"
						onClick={() =>
							navigate({
								to: '/mail/compose',
								search: {
									folderId,
									threadId,
									...replyDraftSearch(lastMessage),
								},
							})
						}
						className="flex w-full items-center gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3 text-left text-sm text-muted-foreground transition-colors hover:border-ring/30 hover:bg-muted/50 hover:text-foreground"
					>
						<Reply className="h-4 w-4 shrink-0" />
						<span>Write a reply…</span>
					</button>
				</div>
			) : null}
		</div>
	)
}

function IconButton({
	label,
	onClick,
	disabled = false,
	children,
}: {
	label: string
	onClick?: () => void
	disabled?: boolean
	children: React.ReactNode
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={label}
			title={label}
			disabled={disabled}
			className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-wait disabled:opacity-50"
		>
			{children}
		</button>
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
		<button
			type="button"
			onClick={onClick}
			className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
		>
			{children}
			<span className="hidden md:inline">{label}</span>
		</button>
	)
}

export function ErrorBanner({ message }: { message: string }) {
	const isQuota = message.startsWith('QUOTA:')
	return (
		<p className="mx-4 mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
			{isQuota ? message.slice(6).trim() : message}
		</p>
	)
}
