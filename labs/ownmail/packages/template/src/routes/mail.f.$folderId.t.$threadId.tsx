import type { Message } from '@nylas-labs/cli-kit/v3'
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import {
	Archive,
	ArrowLeft,
	Forward,
	MoreHorizontal,
	Paperclip,
	Reply,
	ReplyAll,
	Star,
	Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
	cn,
	collapsedMessagePreview,
	folderMaskFromMailLocation,
	forwardDraftSearch,
	initials,
	labelBadgeClass,
	messageBodyParagraphs,
	replyAllDraftSearch,
	replyDraftSearch,
	threadLabels,
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
	const publicPathname = router.state.location.maskedLocation?.pathname ?? router.state.location.pathname
	const folderMask = folderMaskFromMailLocation(publicPathname)
	const [error, setError] = useState<string | null>(null)
	const lastMessage = messages.at(-1)
	const labels = threadLabels(thread)
	const firstAttachment = messages
		.flatMap((message) => message.attachments ?? [])
		.find((attachment) => !attachment.is_inline)

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
						...(folderMask ? { mask: folderMask } : {}),
					})
				}
				await router.invalidate()
			} catch (err) {
				setError(err instanceof Error ? err.message : 'Action failed')
			}
		},
		[baseFolderId, folderId, folderMask, navigate, router, threadId],
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
					...(folderMask ? { mask: folderMask } : {}),
				})
			}
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [act, baseFolderId, folderId, folderMask, navigate, thread.starred])

	useEffect(() => {
		if (markedRead) router.invalidate()
	}, [markedRead, router])

	return (
		<div className="flex min-w-0 flex-1 flex-col bg-background">
			<div className="flex items-center gap-1 border-b border-border px-3 py-2.5">
				<button
					type="button"
					onClick={() =>
						navigate({
							to: '/mail/f/$folderId',
							params: { folderId },
							search: baseFolderId ? { baseFolderId } : {},
							...(folderMask ? { mask: folderMask } : {}),
						})
					}
					aria-label="Back to list"
					className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
				>
					<ArrowLeft className="h-5 w-5" />
				</button>
				<IconButton label="Archive" onClick={() => act({ folder: 'archive' }, true)}>
					<Archive className="h-4.5 w-4.5" />
				</IconButton>
				<IconButton label="Delete" onClick={() => act({ folder: 'trash' }, true)}>
					<Trash2 className="h-4.5 w-4.5" />
				</IconButton>
				<IconButton
					label={thread.starred ? 'Unstar' : 'Star'}
					onClick={() => act({ starred: !thread.starred })}
				>
					<Star className={cn('h-4.5 w-4.5', thread.starred && 'fill-event-amber text-event-amber')} />
				</IconButton>
				<div className="ml-auto">
					<IconButton label="More">
						<MoreHorizontal className="h-4.5 w-4.5" />
					</IconButton>
				</div>
			</div>
			{error ? <ErrorBanner message={error} /> : null}

			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto max-w-3xl px-4 py-5 md:px-6">
					<div className="flex flex-wrap items-center gap-2">
						<h2 className="text-xl font-semibold text-balance">{thread.subject || '(no subject)'}</h2>
						{labels.map((label) => (
							<span
								key={label.id}
								className={cn(
									'rounded-md border px-2 py-0.5 text-xs font-medium',
									labelBadgeClass(label.tone),
								)}
							>
								{label.name}
							</span>
						))}
					</div>

					{thread.has_attachments ? (
						<div className="mt-4 flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
							<Paperclip className="h-4 w-4 text-muted-foreground" />
							<span className="font-medium text-foreground">
								{firstAttachment?.filename ?? 'attachment.pdf'}
							</span>
							<span className="text-muted-foreground">
								· {firstAttachment?.size ? formatSize(firstAttachment.size) : '248 KB'}
							</span>
						</div>
					) : null}

					<div className="mt-4 space-y-3">
						{messages.map((message, index) => (
							<MessageBlock key={message.id} message={message} defaultOpen={index === messages.length - 1} />
						))}
					</div>

					<div className="mt-4 flex flex-wrap gap-2">
						{lastMessage ? (
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
								className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
							>
								<Reply className="h-4 w-4" /> Reply
							</button>
						) : null}
						<button
							type="button"
							onClick={() =>
								lastMessage
									? navigate({
											to: '/mail/compose',
											search: {
												folderId,
												threadId,
												...replyAllDraftSearch(lastMessage, mailboxEmail),
											},
										})
									: undefined
							}
							className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
						>
							<ReplyAll className="h-4 w-4" /> Reply all
						</button>
						<button
							type="button"
							onClick={() =>
								lastMessage
									? navigate({
											to: '/mail/compose',
											search: {
												folderId,
												threadId,
												...forwardDraftSearch(lastMessage),
											},
										})
									: undefined
							}
							className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
						>
							<Forward className="h-4 w-4" /> Forward
						</button>
					</div>
				</div>
			</div>
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

function MessageBlock({ message, defaultOpen }: { message: Message; defaultOpen: boolean }) {
	const [open, setOpen] = useState(defaultOpen)
	const from = message.from?.[0]
	const fromLabel = from?.name || from?.email || '(unknown sender)'
	return (
		<div className="rounded-sm border border-border bg-card">
			<button
				type="button"
				onClick={() => setOpen((value) => !value)}
				className="flex w-full items-start gap-3 px-4 py-3 text-left"
			>
				<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
					{initials(fromLabel)}
				</div>
				<div className="min-w-0 flex-1">
					<div className="flex items-baseline justify-between gap-2">
						<span className="truncate text-sm font-semibold text-foreground">{fromLabel}</span>
						{message.date ? (
							<span className="shrink-0 text-xs text-muted-foreground">
								{new Date(message.date * 1000).toLocaleString(undefined, {
									weekday: 'short',
									month: 'short',
									day: 'numeric',
									hour: 'numeric',
									minute: '2-digit',
								})}
							</span>
						) : null}
					</div>
					{open ? (
						<p className="truncate text-xs text-muted-foreground">
							to {message.to?.map((person) => person.name || person.email).join(', ') || 'me'}
						</p>
					) : (
						<p className="truncate text-xs text-muted-foreground">{collapsedMessagePreview(message)}</p>
					)}
				</div>
			</button>

			{open ? (
				<div className="px-4 pb-4 pl-16">
					<MessageBody message={message} />
					<MessageAttachments message={message} />
				</div>
			) : null}
		</div>
	)
}

function MessageAttachments({ message }: { message: Message }) {
	const attachments = (message.attachments ?? []).filter((attachment) => !attachment.is_inline)
	if (attachments.length === 0) return null
	return (
		<div className="mt-4 flex flex-wrap gap-2">
			{attachments.map((attachment) => (
				<a
					key={attachment.id}
					href={`/attachments/${encodeURIComponent(attachment.id)}?message_id=${encodeURIComponent(message.id)}`}
					className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm hover:bg-muted"
					download={attachment.filename}
				>
					<Paperclip className="h-4 w-4 text-muted-foreground" />
					<span className="font-medium">{attachment.filename ?? 'attachment'}</span>
					{attachment.size ? (
						<span className="text-muted-foreground">· {formatSize(attachment.size)}</span>
					) : null}
				</a>
			))}
		</div>
	)
}

function MessageBody({ message }: { message: Message }) {
	const paragraphs = messageBodyParagraphs(message)
	if (paragraphs.length === 0) return null
	return (
		<div className="space-y-3 text-sm leading-relaxed text-foreground/90">
			{paragraphs.map((paragraph) => (
				<p key={`${message.id}-${paragraph}`} className="whitespace-pre-line text-pretty">
					{paragraph}
				</p>
			))}
		</div>
	)
}

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function ErrorBanner({ message }: { message: string }) {
	const isQuota = message.startsWith('QUOTA:')
	return (
		<p className="mx-4 mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
			{isQuota ? message.slice(6).trim() : message}
		</p>
	)
}
