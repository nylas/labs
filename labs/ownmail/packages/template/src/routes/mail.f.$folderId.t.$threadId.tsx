import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { Archive, ArrowLeft, Forward, MailOpen, Reply, ReplyAll, Star, Trash2 } from 'lucide-react'
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
	const lastMessage = messages.at(-1)

	const act = useCallback(
		async (input: { unread?: boolean; starred?: boolean; folder?: string }, leave = false) => {
			setError(null)
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
			} catch (err) {
				setError(err instanceof Error ? err.message : 'Action failed')
			}
		},
		[baseFolderId, folderId, navigate, router, threadId],
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
				act({ starred: !thread.starred })
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
	}, [act, baseFolderId, folderId, navigate, thread.starred])

	useEffect(() => {
		if (markedRead) router.invalidate()
	}, [markedRead, router])

	return (
		<div className="flex min-w-0 flex-1 flex-col bg-background">
			<div className="flex items-center gap-1 border-b border-border px-3 py-2">
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
				<IconButton label="Archive" onClick={() => act({ folder: 'archive' }, true)}>
					<Archive className="h-4 w-4" />
				</IconButton>
				<IconButton label="Delete" onClick={() => act({ folder: 'trash' }, true)}>
					<Trash2 className="h-4 w-4" />
				</IconButton>
				<IconButton
					label={thread.starred ? 'Unstar' : 'Star'}
					onClick={() => act({ starred: !thread.starred })}
				>
					<Star className={cn('h-4 w-4', thread.starred && STAR_FILLED_CLASS)} />
				</IconButton>
				<IconButton label="Mark unread" onClick={() => act({ unread: true }, true)}>
					<MailOpen className="h-4 w-4" />
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
			title={label}
			className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
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
