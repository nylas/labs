import type { Message } from '@nylas-labs/cli-kit/v3'
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import {
	Archive,
	ArrowLeft,
	ChevronDown,
	Forward,
	MailOpen,
	Paperclip,
	Reply,
	ReplyAll,
	Star,
	Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ClientMessageTime } from '../components/ClientTime.js'
import { MessageBody } from '../components/MessageBody.js'
import {
	cn,
	collapsedMessagePreview,
	folderMaskFromMailLocation,
	forwardDraftSearch,
	initials,
	labelBadgeClass,
	replyAllDraftSearch,
	replyDraftSearch,
	STAR_FILLED_CLASS,
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
	const threadAttachments = useMemo(
		() =>
			messages.flatMap((message) =>
				(message.attachments ?? []).filter((attachment) => !attachment.is_inline),
			),
		[messages],
	)

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
			<div className="flex items-center gap-1 border-b border-border px-3 py-2">
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
				<header className="border-b border-border px-5 py-5 lg:px-8">
					<div className="flex flex-wrap items-start gap-x-3 gap-y-2">
						<h1 className="font-display text-xl font-semibold text-balance lg:text-2xl">
							{thread.subject || '(no subject)'}
						</h1>
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

					{threadAttachments.length > 0 ? (
						<div className="mt-4 flex flex-wrap gap-2">
							{threadAttachments.map((attachment) => {
								const parent = messages.find((message) =>
									message.attachments?.some((item) => item.id === attachment.id),
								)
								if (!parent) return null
								return (
									<a
										key={attachment.id}
										href={`/attachments/${encodeURIComponent(attachment.id)}?message_id=${encodeURIComponent(parent.id)}`}
										className="inline-flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-sm transition-colors hover:bg-muted"
										download={attachment.filename}
									>
										<Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
										<span className="font-medium">{attachment.filename ?? 'attachment'}</span>
										{attachment.size ? (
											<span className="text-muted-foreground">· {formatSize(attachment.size)}</span>
										) : null}
									</a>
								)
							})}
						</div>
					) : null}
				</header>

				<div className="px-5 py-2 lg:px-8">
					{messages.map((message, index) => (
						<MessageBlock
							key={message.id}
							message={message}
							defaultOpen={index === messages.length - 1}
							isLast={index === messages.length - 1}
						/>
					))}
				</div>
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

function MessageBlock({
	message,
	defaultOpen,
	isLast,
}: {
	message: Message
	defaultOpen: boolean
	isLast: boolean
}) {
	const [open, setOpen] = useState(defaultOpen)
	const from = message.from?.[0]
	const fromLabel = from?.name || from?.email || '(unknown sender)'
	const recipients = message.to?.map((person) => person.name || person.email).join(', ') || 'me'

	return (
		<article className={cn('py-5', !isLast && 'border-b border-border')}>
			<button
				type="button"
				onClick={() => setOpen((value) => !value)}
				className="flex w-full items-start gap-3 text-left"
				aria-expanded={open}
			>
				<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground">
					{initials(fromLabel)}
				</div>
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
						<span className="text-sm font-semibold text-foreground">{fromLabel}</span>
						{open ? <span className="text-xs text-muted-foreground">to {recipients}</span> : null}
						{message.date ? (
							<ClientMessageTime
								epochSeconds={message.date}
								className="ml-auto shrink-0 text-xs text-muted-foreground"
							/>
						) : null}
					</div>
					{!open ? (
						<p className="mt-0.5 truncate text-sm text-muted-foreground">
							{collapsedMessagePreview(message)}
						</p>
					) : null}
				</div>
				<ChevronDown
					className={cn(
						'mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform',
						open && 'rotate-180',
					)}
				/>
			</button>

			{open ? (
				<div className="mt-4">
					<MessageBody message={message} />
					<MessageAttachments message={message} />
				</div>
			) : null}
		</article>
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
					className="inline-flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-sm transition-colors hover:bg-muted"
					download={attachment.filename}
				>
					<Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
					<span className="font-medium">{attachment.filename ?? 'attachment'}</span>
					{attachment.size ? (
						<span className="text-muted-foreground">· {formatSize(attachment.size)}</span>
					) : null}
				</a>
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
