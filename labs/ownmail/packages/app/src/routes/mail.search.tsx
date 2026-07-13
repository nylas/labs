import type { Message, Thread } from '@nylas-labs/cli-kit/v3'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { Archive, ArrowLeft, Forward, Reply, ReplyAll, Star, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { edgeCursor, listNavAction, moveCursor } from '../components/list-nav.js'
import { ThreadConversation } from '../components/ThreadConversation.js'
import { THREAD_ROW_CLASS, ThreadRowContent } from '../components/ThreadRow.js'
import {
	cn,
	forwardDraftSearch,
	mailFolderTitle,
	replyAllDraftSearch,
	replyDraftSearch,
	STAR_FILLED_CLASS,
	searchListSearch,
	threadRouteFolderId,
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
	const [cursor, setCursor] = useState(-1)
	const sortedThreads = useMemo(
		() => [...threads].sort((a, b) => (threadTimestamp(b) ?? 0) - (threadTimestamp(a) ?? 0)),
		[threads],
	)
	const unreadCount = sortedThreads.filter((thread) => thread.unread).length
	const title = mailFolderTitle(folderId ?? 'inbox', folders)

	/* v8 ignore start -- list navigation is exercised through the shared pure helpers */
	useEffect(() => {
		setCursor(threadId ? sortedThreads.findIndex((thread) => thread.id === threadId) : -1)
	}, [sortedThreads, threadId])

	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			const target = event.target as HTMLElement | null
			const isTyping =
				target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
			if (
				isTyping ||
				event.metaKey ||
				event.ctrlKey ||
				event.altKey ||
				target?.closest?.('button, a, select')
			)
				return
			if (document.querySelector('[role="dialog"]')) return
			const action = listNavAction(event.key)
			if (!action) return
			event.preventDefault()
			if (action === 'open') {
				const thread = sortedThreads[cursor]
				if (thread) {
					router.navigate({
						to: '/mail/search',
						search: { q, ...(folderId ? { folderId } : {}), threadId: thread.id },
					})
				}
				return
			}
			setCursor((current) =>
				action === 'first' || action === 'last'
					? edgeCursor(action, sortedThreads.length)
					: moveCursor(current, action === 'down' ? 1 : -1, sortedThreads.length),
			)
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [cursor, folderId, q, router, sortedThreads])
	/* v8 ignore stop */

	useEffect(() => {
		if (selected?.markedRead) router.invalidate()
	}, [router, selected?.markedRead])

	return (
		<>
			<section
				className={cn(
					'h-full min-w-0 flex-1 flex-col border-r border-border bg-card/50 md:flex md:w-[22rem] md:max-w-[22rem] md:flex-none',
					selected ? 'hidden' : 'flex',
				)}
			>
				<div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
					<h1 className="font-display text-base font-semibold capitalize">{title}</h1>
					{unreadCount > 0 ? (
						<span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
							{unreadCount}
						</span>
					) : null}
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto">
					{sortedThreads.length === 0 ? (
						<div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
							<p className="font-display text-sm font-semibold text-foreground">Nothing here</p>
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
								keyboardActive={cursor === sortedThreads.indexOf(thread)}
							/>
						))
					)}
				</div>
			</section>
			<section className={cn('min-w-0 flex-1 flex-col bg-background', selected ? 'flex' : 'hidden md:flex')}>
				{selected ? (
					<SearchThreadDetail selected={selected} q={q} folderId={folderId} />
				) : (
					<div className="hidden min-w-0 flex-1 flex-col items-center justify-center gap-3 bg-background px-6 text-center md:flex">
						<div className="flex h-14 w-14 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground shadow-sm">
							<Reply className="h-6 w-6" />
						</div>
						<div>
							<p className="font-display text-sm font-semibold text-foreground">Select a conversation</p>
							<p className="mt-1 text-sm text-muted-foreground">
								Choose a message from the list to read it here.
							</p>
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
	keyboardActive,
}: {
	thread: Awaited<ReturnType<typeof getThreads>>['threads'][number]
	q: string
	searchFolderId?: string
	active: boolean
	keyboardActive: boolean
}) {
	const folderId = threadRouteFolderId(thread)
	const router = useRouter()
	const [starred, setStarred] = useState(thread.starred)
	const [starPending, setStarPending] = useState(false)

	useEffect(() => {
		setStarred(thread.starred)
	}, [thread.starred])

	async function toggleStar() {
		/* v8 ignore next -- the star control is disabled while its request is pending */
		if (starPending) return
		const nextStarred = !starred
		setStarred(nextStarred)
		setStarPending(true)
		try {
			await updateThreadState({ data: { threadId: thread.id, starred: nextStarred } })
			router.invalidate()
			/* v8 ignore next 3 -- a failed optimistic mutation restores the rendered value before re-enabling the control */
		} catch {
			setStarred(!nextStarred)
		} finally {
			setStarPending(false)
		}
	}
	const optimisticThread = starred === thread.starred ? thread : { ...thread, starred }

	return (
		<Link
			to="/mail/search"
			search={{ q, ...(searchFolderId ? { folderId: searchFolderId } : {}), threadId: thread.id }}
			data-active={active ? 'true' : undefined}
			data-nav-cursor={keyboardActive ? 'true' : undefined}
			data-unread={optimisticThread.unread ? 'true' : undefined}
			className={cn(THREAD_ROW_CLASS, optimisticThread.unread && 'bg-card/80')}
		>
			<ThreadRowContent
				thread={optimisticThread}
				folderId={folderId}
				onToggleStar={toggleStar}
				starPending={starPending}
			/>
		</Link>
	)
}

function SearchThreadDetail({
	selected,
	q,
	folderId,
}: {
	selected: { thread: Thread; messages: Message[]; mailboxEmail: string }
	q: string
	folderId?: string
}) {
	const router = useRouter()
	const routeFolderId = threadRouteFolderId(selected.thread)
	const lastMessage = selected.messages.at(-1)
	const searchList = useMemo(() => searchListSearch(q, folderId), [folderId, q])

	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			const target = event.target as HTMLElement | null
			const isTyping =
				target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
			if (isTyping || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
			if (event.key === 'Escape') {
				event.preventDefault()
				router.navigate({
					to: '/mail/search',
					search: searchList,
				})
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
		<div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
			<div className="flex h-14 shrink-0 items-center gap-1 border-b border-border px-3">
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
					<Star className={cn('h-4 w-4', selected.thread.starred && STAR_FILLED_CLASS)} />
				</IconButton>

				{lastMessage ? (
					<div className="ml-auto hidden items-center gap-1 sm:flex">
						<ActionButton
							label="Reply"
							onClick={() =>
								router.navigate({
									to: '/mail/compose',
									search: {
										folderId: routeFolderId,
										threadId: selected.thread.id,
										...replyDraftSearch(lastMessage),
									},
								})
							}
						>
							<Reply className="h-4 w-4" />
						</ActionButton>
						<ActionButton
							label="Reply all"
							onClick={() =>
								router.navigate({
									to: '/mail/compose',
									search: {
										folderId: routeFolderId,
										threadId: selected.thread.id,
										...replyAllDraftSearch(lastMessage, selected.mailboxEmail),
									},
								})
							}
						>
							<ReplyAll className="h-4 w-4" />
						</ActionButton>
						<ActionButton
							label="Forward"
							onClick={() =>
								router.navigate({
									to: '/mail/compose',
									search: {
										folderId: routeFolderId,
										threadId: selected.thread.id,
										...forwardDraftSearch(lastMessage),
									},
								})
							}
						>
							<Forward className="h-4 w-4" />
						</ActionButton>
					</div>
				) : null}
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto">
				<ThreadConversation thread={selected.thread} messages={selected.messages} />
			</div>

			{lastMessage ? (
				<div className="shrink-0 border-t border-border bg-background px-5 py-3 lg:px-8">
					<button
						type="button"
						onClick={() =>
							router.navigate({
								to: '/mail/compose',
								search: {
									folderId: routeFolderId,
									threadId: selected.thread.id,
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
