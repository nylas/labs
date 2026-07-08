import type { Message, Thread } from '@nylas-labs/cli-kit/v3'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
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
import { useEffect, useMemo, useState } from 'react'
import {
	cn,
	collapsedMessagePreview,
	formatListDate,
	initials,
	labelBadgeClass,
	mailFolderTitle,
	messageBodyParagraphs,
	replyDraftSearch,
	searchListSearch,
	threadLabels,
	threadRouteFolderId,
	threadSender,
	threadTimestamp,
} from '../components/ui-model.js'
import { getFolders, getThreadMessages, getThreads, updateThreadState } from '../server/fns.js'

export const Route = createFileRoute('/mail/search')({
	validateSearch: (search): { q: string; folderId?: string; threadId?: string } => ({
		q: String(search.q ?? ''),
		...(typeof search.folderId === 'string' ? { folderId: search.folderId } : {}),
		...(typeof search.threadId === 'string' ? { threadId: search.threadId } : {}),
	}),
	loaderDeps: ({ search }) => ({ q: search.q, folderId: search.folderId, threadId: search.threadId }),
	loader: async ({ deps }) => {
		const [folders, res, selected] = await Promise.all([
			getFolders(),
			getThreads({
				data: {
					q: deps.q,
					...(deps.folderId === 'starred'
						? { starred: true }
						: deps.folderId
							? { folderId: deps.folderId }
							: {}),
				},
			}),
			deps.threadId ? getThreadMessages({ data: { threadId: deps.threadId } }) : null,
		])
		return { ...res, folders, folderId: deps.folderId, selected }
	},
	component: SearchResults,
})

function SearchResults() {
	const { threads, folders, folderId, selected } = Route.useLoaderData()
	const { q, threadId } = Route.useSearch()
	const router = useRouter()
	const sortedThreads = useMemo(
		() => [...threads].sort((a, b) => (threadTimestamp(b) ?? 0) - (threadTimestamp(a) ?? 0)),
		[threads],
	)
	const unreadCount = sortedThreads.filter((thread) => thread.unread).length
	const title = mailFolderTitle(folderId ?? 'inbox', folders)

	useEffect(() => {
		if (selected?.markedRead) router.invalidate()
	}, [router, selected?.markedRead])

	return (
		<>
			<section
				className={cn(
					'h-full min-w-0 flex-1 flex-col border-r border-border bg-card md:flex md:w-96 md:max-w-96 md:flex-none',
					selected ? 'hidden' : 'flex',
				)}
			>
				<div className="flex items-center justify-between border-b border-border px-4 py-3">
					<h1 className="text-base font-semibold capitalize">{title}</h1>
					{unreadCount > 0 ? (
						<span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-accent-foreground">
							{unreadCount} unread
						</span>
					) : null}
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto">
					{sortedThreads.length === 0 ? (
						<div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
							<p className="text-sm font-medium text-foreground">Nothing here</p>
							<p className="text-sm text-muted-foreground">This view is empty.</p>
						</div>
					) : (
						sortedThreads.map((thread) => (
							<SearchThreadRow
								key={thread.id}
								thread={thread}
								q={q}
								searchFolderId={folderId}
								active={thread.id === threadId}
							/>
						))
					)}
				</div>
			</section>
			<section className={cn('min-w-0 flex-1 flex-col bg-background', selected ? 'flex' : 'hidden md:flex')}>
				{selected ? (
					<SearchThreadDetail selected={selected} q={q} folderId={folderId} />
				) : (
					<div className="hidden min-w-0 flex-1 flex-col items-center justify-center gap-3 bg-background text-center md:flex">
						<div className="flex h-14 w-14 items-center justify-center rounded-sm bg-muted text-muted-foreground">
							<Reply className="h-6 w-6" />
						</div>
						<div>
							<p className="text-sm font-medium text-foreground">Select a conversation</p>
							<p className="text-sm text-muted-foreground">Choose a message from the list to read it here.</p>
						</div>
					</div>
				)}
			</section>
		</>
	)
}

function SearchThreadRow({
	thread,
	q,
	searchFolderId,
	active,
}: {
	thread: Awaited<ReturnType<typeof getThreads>>['threads'][number]
	q: string
	searchFolderId?: string
	active: boolean
}) {
	const folderId = threadRouteFolderId(thread)
	const when = formatListDate(threadTimestamp(thread))
	const labels = threadLabels(thread)
	const router = useRouter()

	async function toggleStar(event: React.MouseEvent<HTMLButtonElement>) {
		event.preventDefault()
		event.stopPropagation()
		await updateThreadState({ data: { threadId: thread.id, starred: !thread.starred } })
		router.invalidate()
	}

	return (
		<Link
			to="/mail/search"
			search={{ q, ...(searchFolderId ? { folderId: searchFolderId } : {}), threadId: thread.id }}
			className={cn(
				'group relative flex w-full cursor-pointer flex-col gap-1 border-b border-border px-4 py-3 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:bg-accent',
				active && 'bg-accent hover:bg-accent',
				thread.unread && !active && 'bg-card',
			)}
		>
			{thread.unread ? <span className="absolute top-0 left-0 h-full w-0.5 bg-primary" aria-hidden /> : null}
			<div className="flex items-center gap-2">
				<button
					type="button"
					onClick={toggleStar}
					aria-label={thread.starred ? 'Unstar' : 'Star'}
					className="shrink-0 text-muted-foreground transition-colors hover:text-event-amber"
				>
					<Star className={cn('h-4 w-4', thread.starred && 'fill-event-amber text-event-amber')} />
				</button>
				<span
					className={cn(
						'min-w-0 flex-1 truncate text-sm',
						thread.unread ? 'font-semibold text-foreground' : 'font-medium text-foreground/90',
					)}
				>
					{threadSender(thread, folderId)}
					{(thread.message_ids?.length ?? 0) > 1 ? (
						<span className="ml-1 font-normal text-muted-foreground">({thread.message_ids?.length})</span>
					) : null}
				</span>
				{thread.has_attachments ? <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : null}
				{when ? <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{when}</span> : null}
			</div>
			<p
				className={cn(
					'truncate text-sm',
					thread.unread ? 'font-semibold text-foreground' : 'text-foreground/80',
				)}
			>
				{thread.subject || '(no subject)'}
			</p>
			<div className="flex items-center gap-2">
				<p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{thread.snippet}</p>
				{labels.map((label) => (
					<span
						key={label.id}
						className={cn(
							'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium',
							labelBadgeClass(label.tone),
						)}
					>
						{label.name}
					</span>
				))}
			</div>
		</Link>
	)
}

function SearchThreadDetail({
	selected,
	q,
	folderId,
}: {
	selected: { thread: Thread; messages: Message[] }
	q: string
	folderId?: string
}) {
	const router = useRouter()
	const routeFolderId = threadRouteFolderId(selected.thread)
	const labels = threadLabels(selected.thread)
	const lastMessage = selected.messages.at(-1)
	const firstAttachment = selected.messages
		.flatMap((message) => message.attachments ?? [])
		.find((attachment) => !attachment.is_inline)
	const searchList = useMemo(() => searchListSearch(q, folderId), [folderId, q])

	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			const target = event.target as HTMLElement | null
			const isTyping =
				target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
			if (isTyping || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
			if (event.key === 'Escape') {
				event.preventDefault()
				router.navigate({ to: '/mail/search', search: searchList })
			}
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [router, searchList])

	async function act(input: { unread?: boolean; starred?: boolean; folder?: string }, leave = false) {
		await updateThreadState({ data: { threadId: selected.thread.id, ...input } })
		if (leave) {
			await router.navigate({
				to: '/mail/search',
				search: searchList,
			})
		}
		await router.invalidate()
	}

	return (
		<div className="flex min-w-0 flex-1 flex-col bg-background">
			<div className="flex items-center gap-1 border-b border-border px-3 py-2.5">
				<Link
					to="/mail/search"
					search={searchList}
					aria-label="Back to list"
					className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
				>
					<ArrowLeft className="h-5 w-5" />
				</Link>
				<IconButton label="Archive" onClick={() => act({ folder: 'archive' }, true)}>
					<Archive className="h-4 w-4" />
				</IconButton>
				<IconButton label="Delete" onClick={() => act({ folder: 'trash' }, true)}>
					<Trash2 className="h-4 w-4" />
				</IconButton>
				<IconButton
					label={selected.thread.starred ? 'Unstar' : 'Star'}
					onClick={() => act({ starred: !selected.thread.starred })}
				>
					<Star className={cn('h-4 w-4', selected.thread.starred && 'fill-event-amber text-event-amber')} />
				</IconButton>
				<div className="ml-auto">
					<IconButton label="More">
						<MoreHorizontal className="h-4 w-4" />
					</IconButton>
				</div>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto max-w-3xl px-4 py-5 md:px-6">
					<div className="flex flex-wrap items-center gap-2">
						<h2 className="text-xl font-semibold text-balance">
							{selected.thread.subject || '(no subject)'}
						</h2>
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

					{selected.thread.has_attachments ? (
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
						{selected.messages.map((message, index) => (
							<MessageBlock
								key={message.id}
								message={message}
								defaultOpen={index === selected.messages.length - 1}
							/>
						))}
					</div>

					<div className="mt-4 flex flex-wrap gap-2">
						{lastMessage ? (
							<Link
								to="/mail/compose"
								search={{
									folderId: routeFolderId,
									threadId: selected.thread.id,
									...replyDraftSearch(lastMessage),
								}}
								className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
							>
								<Reply className="h-4 w-4" /> Reply
							</Link>
						) : null}
						<button
							type="button"
							className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
						>
							<ReplyAll className="h-4 w-4" /> Reply all
						</button>
						<button
							type="button"
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
