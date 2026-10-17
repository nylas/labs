import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { FileText, Loader2, Reply, Trash2 } from 'lucide-react'
import {
	Fragment,
	memo,
	type ReactNode,
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from 'react'
import { ContentReadyOutlet } from '#app/components/ContentReadyOutlet'
import { useUserPreferences } from '#app/preferences/user-preferences'
import { BulkMailToolbar } from '#features/mail/components/BulkMailToolbar'
import { useCompose } from '#features/mail/components/ComposeProvider'
import { ErrorBanner } from '#features/mail/components/ErrorBanner'
import { ListDensityMenu } from '#features/mail/components/ListDensityMenu'
import { ReadingPaneMenu } from '#features/mail/components/ReadingPaneMenu'
import { ThreadBundleRow } from '#features/mail/components/ThreadBundleRow'
import {
	ThreadListEnvironment,
	ThreadListGroupHeading,
	useThreadListEnvValue,
} from '#features/mail/components/ThreadListGroups'
import {
	THREAD_ROW_CLASS,
	THREAD_ROW_LINK_CLASS,
	ThreadRowContent,
	ThreadRowError,
	ThreadRowLayout,
} from '#features/mail/components/ThreadRow'
import { ThreadRowMenu, type ThreadRowUpdate } from '#features/mail/components/ThreadRowMenu'
import {
	draftRecipientName,
	folderCount,
	mailFolderTitle,
	readableSnippet,
	threadTimestamp,
} from '#features/mail/lib/mail-ui-model'
import { readingPaneLayout } from '#features/mail/lib/reading-pane'
import { foldedBundleOf, type ThreadListItem, threadListItems } from '#features/mail/lib/thread-list-model'
import { dayGroupHeading } from '#features/mail/lib/thread-reading-model'
import type { MailDraft, MailThread } from '#features/mail/state/mail-queries'
import type { ThreadResponseKind } from '#features/mail/state/thread-response'
import { useBulkTriage } from '#features/mail/state/use-bulk-triage'
import { getThreads, updateThreadState } from '#server/fns'
import { PullToRefresh, RefreshButton } from '#shared/components/PullToRefresh'
import { Button } from '#shared/components/ui/button'
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuShortcut,
	ContextMenuTrigger,
} from '#shared/components/ui/context-menu'
import { Dialog, DialogContent, DialogTitle } from '#shared/components/ui/dialog'
import { UNDER_MOBILE_BAR_CLASS, UNDER_PINNED_BAR_CLASS } from '#shared/components/ui/glass'
import { ScrollArea } from '#shared/components/ui/scroll-area'
import { Toolbar } from '#shared/components/ui/toolbar'
import { useFlipList } from '#shared/hooks/use-flip-list'
import { edgeCursor, isContextMenuKey, listNavAction, moveCursor } from '#shared/lib/list-nav'
import { cn } from '#shared/lib/utils'
import type { loadMailFolderData } from './mail.f.$folderId'

type MailFolderRouteData = Awaited<ReturnType<typeof loadMailFolderData>>

/** List state owned by one folder and first page; see `MailFolderRouteScreen`. */
type FolderListState = {
	identity: string
	extraThreads: MailThread[]
	nextCursor: string | undefined
	loadingMore: boolean
	loadMoreError: boolean
	/**
	 * The keyboard cursor: the row it is on (`cursorKey`), so it stays on that
	 * row while rows above it come and go, and its place (`cursor`), where it
	 * stays when that row itself leaves the list.
	 */
	cursor: number
	cursorKey?: string
	/** Bundles (newsletters, receipts of one day group) opened in place. */
	expandedBundles: string[]
	/** The open conversation the bundles and the held unread row were last brought in line with. */
	openSyncedFor?: string
	/** The open conversation that was unread when it opened; its row keeps reading so. */
	heldUnreadFor?: string
}

function emptyFolderListState(identity: string, nextCursor: string | undefined): FolderListState {
	return {
		identity,
		extraThreads: [],
		nextCursor,
		loadingMore: false,
		loadMoreError: false,
		cursor: -1,
		expandedBundles: [],
	}
}

/** The row a keyboard cursor sits on, whatever its place: a draft, a bundle, or a conversation. */
function navKey(item: NavItem): string {
	if ('draftId' in item) return `draft:${item.draftId}`
	if ('bundleKey' in item) return item.bundleKey
	return item.threadId
}

/** The cursor's place among `keys`: its row's, or where that row was when it has left. */
function cursorIndex(state: Pick<FolderListState, 'cursor' | 'cursorKey'>, keys: string[]): number {
	const keyed = state.cursorKey === undefined ? -1 : keys.indexOf(state.cursorKey)
	return keyed >= 0 ? keyed : Math.min(state.cursor, keys.length - 1)
}

/** Folders whose rows are the person's own mail never bundle newsletters or receipts. */
const UNBUNDLED_FOLDERS = new Set(['sent', 'drafts', 'trash', 'spam'])

type NavItem =
	| { draftId: string }
	| { bundleKey: string }
	| { folderId: string; threadId: string; search: object; thread: MailThread }
export type ThreadUpdateInput = { threadId: string; starred?: boolean } & ThreadRowUpdate
function threadIdFromPath(pathname: string): string | undefined {
	const encoded = /^\/mail\/f\/[^/]+\/t\/([^/]+)\/?$/.exec(pathname)?.[1]
	if (!encoded) return undefined
	try {
		return decodeURIComponent(encoded)
	} catch {
		return undefined
	}
}

export function dedupeThreads<T extends { id: string }>(threads: T[]): T[] {
	return [...new Map(threads.map((thread) => [thread.id, thread])).values()]
}

type MailFolderRouteScreenProps = Parameters<typeof LoadedMailFolderRouteScreen>[0]

/** Server-render real rows using stable preference defaults; hydration applies saved layout. */
export function MailFolderRouteScreen(props: MailFolderRouteScreenProps) {
	return <LoadedMailFolderRouteScreen {...props} />
}

function LoadedMailFolderRouteScreen({
	threads: initialThreads,
	drafts,
	folders,
	folderId,
	baseFolderId,
	nextCursor: initialCursor,
	loadingMore: managedLoadingMore,
	loadMoreError: managedLoadMoreError,
	onLoadMore,
	onRefresh,
	onUpdateThread,
	onDiscardDraft,
	onRespondToThread,
	activeThreadId,
	children,
}: MailFolderRouteData & {
	folderId: string
	baseFolderId?: string
	loadingMore?: boolean
	loadMoreError?: boolean
	onLoadMore?: () => Promise<void>
	onRefresh?: () => Promise<unknown>
	onUpdateThread?: (input: ThreadUpdateInput) => Promise<void>
	onDiscardDraft?: (draftId: string) => Promise<void>
	onRespondToThread?: (input: { threadId: string; kind: ThreadResponseKind }) => Promise<void>
	activeThreadId?: string
	children?: ReactNode
}) {
	useEffect(() => {
		const frame = requestAnimationFrame(() => {
			if (!performance.getEntriesByName?.('ownmail:inbox-ready').length) {
				performance.mark?.('ownmail:inbox-ready')
				window.dispatchEvent(new Event('ownmail:inbox-ready'))
			}
		})
		return () => cancelAnimationFrame(frame)
	}, [])
	const folderTitle = mailFolderTitle(folderId, folders)
	const navigate = useNavigate()
	const { openCompose, composing } = useCompose()
	// This state survives optimistic removal of the row, including rollback on failure.
	const [discardTarget, setDiscardTarget] = useState<MailDraft | null>(null)
	const [discardError, setDiscardError] = useState<string | null>(null)
	const [discardPending, setDiscardPending] = useState(false)
	const discardPendingRef = useRef(false)
	const discardReturnFocus = useRef<HTMLElement | null>(null)
	const discardReturnId = useRef<string | undefined>(undefined)
	const discardCancelRef = useRef<HTMLButtonElement>(null)
	const requestDiscard = useCallback((draft: MailDraft, row: HTMLElement | null) => {
		discardReturnFocus.current = row
		discardReturnId.current = draft.id
		setDiscardError(null)
		setDiscardTarget(draft)
	}, [])

	async function confirmDiscard() {
		if (!discardTarget || !onDiscardDraft || discardPendingRef.current) return
		discardPendingRef.current = true
		setDiscardPending(true)
		setDiscardError(null)
		try {
			await onDiscardDraft(discardTarget.id)
			setDiscardTarget(null)
		} catch {
			setDiscardError('Could not discard the draft. Check your connection, then try again.')
		} finally {
			discardPendingRef.current = false
			setDiscardPending(false)
		}
	}

	const folderIdentity = JSON.stringify([folderId, initialCursor])
	// Paged-in rows, the pagination status and the keyboard cursor belong to one
	// folder and first page. They are stored with that identity and read back
	// only while it still matches, so another folder starts clean on its first
	// render instead of being reset by an effect one render later.
	const [storedList, setStoredList] = useState<FolderListState>(() =>
		emptyFolderListState(folderIdentity, initialCursor),
	)
	const listState =
		storedList.identity === folderIdentity ? storedList : emptyFolderListState(folderIdentity, initialCursor)
	const updateList = useCallback(
		(change: (current: FolderListState) => Partial<FolderListState>) =>
			setStoredList((stored) => {
				const current =
					stored.identity === folderIdentity ? stored : emptyFolderListState(folderIdentity, initialCursor)
				return { ...current, ...change(current) }
			}),
		[folderIdentity, initialCursor],
	)
	const { extraThreads, nextCursor, expandedBundles } = listState
	const localLoadingMore = listState.loadingMore
	const localLoadMoreError = listState.loadMoreError
	// The keys of the rows the cursor walks, read when it moves (set once they are known, below).
	const navKeysRef = useRef<string[]>([])
	const setCursor = useCallback(
		(next: number | ((current: number) => number)) =>
			updateList((current) => {
				const index = typeof next === 'function' ? next(cursorIndex(current, navKeysRef.current)) : next
				return { cursor: index, cursorKey: navKeysRef.current[index] }
			}),
		[updateList],
	)
	const listScrollRef = useRef<HTMLDivElement>(null)
	const moveFocusToCursorRef = useRef(false)
	const loadMorePendingRef = useRef<string | null>(null)
	const folderGenerationRef = useRef({ identity: folderIdentity, generation: 0 })
	if (folderGenerationRef.current.identity !== folderIdentity) {
		folderGenerationRef.current = {
			identity: folderIdentity,
			generation: folderGenerationRef.current.generation + 1,
		}
	}
	const hasThreadRoute = useRouterState({
		select: (state) => {
			// History updates location before committed matches. Reveal the retained list
			// immediately only when returning to this exact folder; other identities keep
			// their existing pending boundary and cannot expose the previous folder's rows.
			if (state.location.pathname === `/mail/f/${encodeURIComponent(folderId)}`) return false
			return (
				state.location.pathname.includes('/t/') ||
				state.matches.some((match) => match.routeId === '/mail/f/$folderId/t/$threadId')
			)
		},
	})
	useEffect(() => {
		if (hasThreadRoute) return
		const frame = requestAnimationFrame(() => window.dispatchEvent(new Event('ownmail:list-ready')))
		return () => cancelAnimationFrame(frame)
	}, [hasThreadRoute])
	const routedThreadId = useRouterState({
		select: (state) =>
			(
				state.matches.find((match) => match.routeId === '/mail/f/$folderId/t/$threadId')?.params as
					| { threadId?: string }
					| undefined
			)?.threadId,
	})
	const openThreadId = activeThreadId ?? routedThreadId
	// While any navigation (j/k, click, or history) is loading, the committed
	// match lags behind; the router location already names the destination.
	const destinationThreadId = useRouterState({
		select: (state) => (state.isLoading ? threadIdFromPath(state.location.pathname) : undefined),
	})
	const hasThread = hasThreadRoute || Boolean(children)
	const [preferences, savePreferences] = useUserPreferences()
	const layout = readingPaneLayout(preferences.readingPane, hasThreadRoute)
	const loadingMore = Boolean(managedLoadingMore || localLoadingMore)
	const loadMoreFailed = !loadingMore && Boolean(managedLoadMoreError || localLoadMoreError)
	const threads = useMemo(
		() => (onLoadMore ? initialThreads : dedupeThreads([...initialThreads, ...extraThreads])),
		[extraThreads, initialThreads, onLoadMore],
	)
	const sortedThreads = useMemo(
		() => [...threads].sort((a, b) => (threadTimestamp(b) ?? 0) - (threadTimestamp(a) ?? 0)),
		[threads],
	)
	const selection = useBulkTriage({
		identity: folderId,
		threads: sortedThreads,
		update: async (input) => {
			if (onUpdateThread) await onUpdateThread(input)
			else await updateThreadState({ data: input })
		},
	})

	const listEnv = useThreadListEnvValue()
	// Day groups, and the bundles a group's newsletters and receipts fold into.
	// Selecting shows every conversation so each one can be checked.
	const listItems = useMemo(
		() =>
			threadListItems(sortedThreads, {
				now: listEnv.now,
				tz: listEnv.tz,
				bundle: !selection.selecting && !UNBUNDLED_FOLDERS.has(folderId),
				expanded: new Set(expandedBundles),
				mutedIds: listEnv.mutedIds,
			}),
		[
			expandedBundles,
			folderId,
			listEnv.mutedIds,
			listEnv.now,
			listEnv.tz,
			selection.selecting,
			sortedThreads,
		],
	)
	// When a conversation opens, the bundle it is folded into opens with it and
	// stays open after (the rows under the cursor never shift when it closes), and
	// a conversation that was unread keeps its row unread while it is open. Done
	// while rendering, once per open, so the first paint already shows both.
	const { heldUnreadFor } = listState
	if (listState.openSyncedFor !== openThreadId) {
		const bundleKey = foldedBundleOf(listItems, openThreadId)
		const opened = openThreadId ? sortedThreads.find((thread) => thread.id === openThreadId) : undefined
		updateList((current) => ({
			openSyncedFor: openThreadId,
			heldUnreadFor:
				openThreadId && (current.heldUnreadFor === openThreadId || opened?.unread) ? openThreadId : undefined,
			...(bundleKey ? { expandedBundles: [...current.expandedBundles, bundleKey] } : {}),
		}))
	}
	/** Notes that a conversation is about to open while it is still unread, before the read lands. */
	const noteOpening = useCallback(
		(thread: MailThread) =>
			updateList((current) => ({ heldUnreadFor: thread.unread ? thread.id : current.heldUnreadFor })),
		[updateList],
	)
	const toggleBundle = useCallback(
		(bundleKey: string) =>
			updateList((current) => ({
				expandedBundles: current.expandedBundles.includes(bundleKey)
					? current.expandedBundles.filter((key) => key !== bundleKey)
					: [...current.expandedBundles, bundleKey],
			})),
		[updateList],
	)

	// Rows that stay slide into the gap a removed row leaves (design.md "Motion" clause 5).
	useFlipList(listScrollRef, listItems.map((item) => item.key).join(' '))
	const unreadCount = folderCount(folders, folderId)

	// The keyboard cursor walks a flat list of the rows actually on screen —
	// drafts in the drafts folder, otherwise the bundles and threads in their
	// day groups — so `j`/`k` order matches render order and Enter opens the
	// right conversation (or opens and folds a bundle).
	const navItems = useMemo((): NavItem[] => {
		if (folderId === 'drafts') {
			return drafts.map((draft) => ({ draftId: draft.id }))
		}
		const search = baseFolderId ? { baseFolderId } : {}
		return listItems.flatMap((item): NavItem[] => {
			if (item.kind === 'bundle') return [{ bundleKey: item.key }]
			if (item.kind === 'thread') return [{ folderId, threadId: item.thread.id, search, thread: item.thread }]
			return []
		})
	}, [baseFolderId, drafts, folderId, listItems])
	const navKeys = useMemo(() => navItems.map(navKey), [navItems])
	navKeysRef.current = navKeys
	const cursor = cursorIndex(listState, navKeys)

	const openItem = useCallback(
		(index: number) => {
			const item = navItems[index]
			if (!item) return
			if ('draftId' in item) {
				void openCompose({ kind: 'draft', draftId: item.draftId })
				return
			}
			if ('bundleKey' in item) {
				toggleBundle(item.bundleKey)
				return
			}
			noteOpening(item.thread)
			navigate({
				to: '/mail/f/$folderId/t/$threadId',
				params: { folderId: item.folderId, threadId: item.threadId },
				search: item.search,
			})
		},
		[navItems, navigate, noteOpening, openCompose, toggleBundle],
	)

	// j/k with a conversation open: the cursor moves (and paints) at once, and the
	// conversation opens in a task after that paint, so the key answers within
	// 100 ms however heavy the next thread is. Presses that land before the open
	// runs replace it, so holding j skims the list without rendering every thread.
	const openItemRef = useRef(openItem)
	openItemRef.current = openItem
	const pendingOpenRef = useRef<{ index: number; token: number } | null>(null)
	const scheduleOpen = useCallback((index: number) => {
		const token = (pendingOpenRef.current?.token ?? 0) + 1
		pendingOpenRef.current = { index, token }
		requestAnimationFrame(() => {
			setTimeout(() => {
				if (pendingOpenRef.current?.token !== token) return
				pendingOpenRef.current = null
				openItemRef.current(index)
			}, 0)
		})
	}, [])
	useEffect(
		() => () => {
			pendingOpenRef.current = null
		},
		[],
	)

	// Keep the cursored row visible as it walks past the fold.
	useEffect(() => {
		if (cursor < 0) return
		const rows = listScrollRef.current?.querySelectorAll<HTMLElement>('[data-nav-row]')
		rows?.[cursor]?.scrollIntoView({ block: 'nearest' })
		if (moveFocusToCursorRef.current) {
			const row = rows?.[cursor]
			;(row?.querySelector<HTMLElement>('.thread-row-link') ?? row)?.focus()
			moveFocusToCursorRef.current = false
		}
	}, [cursor])

	// Closing a conversation (back, Escape, or "Mark unread") returns the cursor
	// and focus to its row, so keyboard reading resumes where it left off —
	// essential when the list was hidden behind the reader.
	const previousOpenThreadIdRef = useRef(openThreadId)
	useEffect(() => {
		const closedThreadId = previousOpenThreadIdRef.current
		previousOpenThreadIdRef.current = openThreadId
		if (!closedThreadId || openThreadId) return
		// A conversation folded away in a bundle returns the cursor to its bundle row.
		const bundleKey = foldedBundleOf(listItems, closedThreadId)
		const index = navKeys.indexOf(bundleKey ?? closedThreadId)
		if (index < 0) return
		setCursor(index)
		requestAnimationFrame(() => {
			const row = listScrollRef.current?.querySelectorAll<HTMLElement>('[data-nav-row]')[index]
			row?.scrollIntoView({ block: 'nearest' })
			focusNavRow(row)
		})
	}, [listItems, navKeys, openThreadId, setCursor])

	// Global list navigation: j/k or arrows move the cursor, Enter/o opens it.
	// Skip while typing, while a dialog (command palette, compose, event) is up,
	// or when a modifier is held so app/browser shortcuts keep working.
	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			if (selection.selecting) return
			const target = event.target instanceof HTMLElement ? event.target : null
			const isTyping =
				target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
			// An open menu owns its keys: arrows, typeahead letters, Enter and Escape.
			if (isTyping || target?.closest('[role="menu"]')) return
			if (event.metaKey || event.ctrlKey || event.altKey) return
			const focusedRow = target?.closest<HTMLElement>('[data-nav-row]')
			const rows = listScrollRef.current?.querySelectorAll<HTMLElement>('[data-nav-row]')
			const focusedRowIndex = focusedRow && rows ? Array.from(rows).indexOf(focusedRow) : -1
			// The browser opens a keyboard context menu on the focused element, so
			// the cursored row takes focus first and its menu is the one that opens.
			if (isContextMenuKey(event)) {
				if (focusedRowIndex < 0) focusNavRow(rows?.[cursor])
				return
			}
			// Keep nested row actions and unrelated links in control of their keys,
			// but let a focused thread row (or draft row, itself a button) continue list navigation.
			const control = target?.closest?.('button, select')
			if ((control && control !== focusedRow) || (target?.closest?.('a') && focusedRowIndex < 0)) return
			if (document.querySelector('[role="dialog"]')) return
			const action = listNavAction(event.key)
			if (!action) return
			// With a conversation open, j/k move straight to the adjacent
			// conversation instead of only moving the list cursor.
			// A press before the last one's conversation has opened continues from it.
			const fromThreadId = destinationThreadId ?? openThreadId
			const isStep = event.key === 'j' || event.key === 'k'
			const openIndex = !isStep
				? -1
				: (pendingOpenRef.current?.index ??
					(fromThreadId
						? navItems.findIndex((item) => 'threadId' in item && item.threadId === fromThreadId)
						: -1))
			if (openIndex >= 0) {
				event.preventDefault()
				// Stepping between conversations passes over bundle rows; past the last one it stays.
				const step = event.key === 'j' ? 1 : -1
				let nextIndex = openIndex + step
				while (navItems[nextIndex] && 'bundleKey' in (navItems[nextIndex] as NavItem)) nextIndex += step
				if (!navItems[nextIndex]) nextIndex = openIndex
				setCursor(nextIndex)
				if (nextIndex !== openIndex) scheduleOpen(nextIndex)
				return
			}
			event.preventDefault()
			if (action === 'open') {
				openItem(focusedRowIndex >= 0 ? focusedRowIndex : cursor)
				return
			}
			if (focusedRowIndex >= 0) moveFocusToCursorRef.current = true
			setCursor((current) =>
				action === 'first' || action === 'last'
					? edgeCursor(action, navItems.length)
					: moveCursor(
							focusedRowIndex >= 0 ? focusedRowIndex : current,
							action === 'down' ? 1 : -1,
							navItems.length,
						),
			)
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [
		cursor,
		destinationThreadId,
		navItems,
		openItem,
		openThreadId,
		scheduleOpen,
		selection.selecting,
		setCursor,
	])

	async function loadMore() {
		if (!nextCursor || loadMorePendingRef.current === folderIdentity || loadingMore || folderId === 'drafts')
			return
		const actionGeneration = folderGenerationRef.current.generation
		loadMorePendingRef.current = folderIdentity
		updateList(() => ({ loadMoreError: false, loadingMore: true }))
		try {
			if (onLoadMore) {
				await onLoadMore()
				return
			}
			const res = await getThreads({
				data: {
					...(folderId === 'starred' ? { starred: true } : { folderId }),
					pageToken: nextCursor,
				},
			})
			if (folderGenerationRef.current.generation !== actionGeneration) return
			updateList((current) => ({
				extraThreads: [...current.extraThreads, ...res.threads],
				nextCursor: res.nextCursor,
			}))
		} catch {
			if (folderGenerationRef.current.generation === actionGeneration) {
				updateList(() => ({ loadMoreError: true }))
			}
		} finally {
			if (folderGenerationRef.current.generation === actionGeneration) {
				loadMorePendingRef.current = null
				updateList(() => ({ loadingMore: false }))
			}
		}
	}
	const paginationControls = nextCursor ? (
		<div className="w-full border-t border-border p-3">
			{loadMoreFailed ? (
				<p id="folder-pagination-error" role="alert" className="mb-2 text-center text-xs text-destructive">
					Could not load more messages. Check your connection, then try again.
				</p>
			) : null}
			<button
				type="button"
				onClick={() => void loadMore()}
				aria-disabled={loadingMore || undefined}
				aria-busy={loadingMore}
				aria-describedby={loadMoreFailed ? 'folder-pagination-error' : undefined}
				className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium transition-colors hover:bg-muted aria-disabled:cursor-wait aria-disabled:opacity-60"
			>
				{loadingMore ? (
					<>
						<Loader2 className="h-4 w-4 animate-spin" /> Loading more messages…
					</>
				) : loadMoreFailed ? (
					'Try loading more messages'
				) : (
					'Load more messages'
				)}
			</button>
		</div>
	) : null
	const threadList = (
		<ScrollArea
			// The scroll offset belongs to one folder; another folder starts at the top.
			key={folderId}
			scrollRestorationId={`mail-list:${folderId}`}
			aria-label={`${folderTitle} thread list`}
			viewportRef={listScrollRef}
			viewportClassName={cn(!selection.selecting && UNDER_PINNED_BAR_CLASS, UNDER_MOBILE_BAR_CLASS)}
			className="min-h-0 flex-1"
		>
			{folderId === 'drafts' ? (
				drafts.length === 0 ? (
					<EmptyState />
				) : (
					drafts.map((draft, index) => {
						const group = dayGroupHeading(draft.date ?? 0, listEnv.now, listEnv.tz)
						const previous = drafts[index - 1]
						const startsGroup =
							!previous || dayGroupHeading(previous.date ?? 0, listEnv.now, listEnv.tz) !== group
						return (
							<Fragment key={draft.id}>
								{startsGroup ? <ThreadListGroupHeading label={group} /> : null}
								<DraftRow
									draft={draft}
									navActive={cursor === index}
									onRequestDiscard={onDiscardDraft ? requestDiscard : undefined}
								/>
							</Fragment>
						)
					})
				)
			) : sortedThreads.length === 0 ? (
				<EmptyState moreAvailable={Boolean(nextCursor)}>{paginationControls}</EmptyState>
			) : (
				<>
					{renderListItems(listItems, (item, navIndex) => {
						if (item.kind === 'bundle') {
							return (
								<ThreadBundleRow
									key={item.key}
									bundleKey={item.key}
									bundle={item.bundle}
									threads={item.threads}
									expanded={item.expanded}
									navActive={cursor === navIndex}
									onToggle={toggleBundle}
								/>
							)
						}
						const thread = item.thread
						return (
							<ThreadRow
								key={item.key}
								thread={thread}
								folderId={folderId}
								baseFolderId={baseFolderId}
								bundled={item.bundled}
								active={thread.id === activeThreadId}
								open={thread.id === routedThreadId}
								heldUnread={thread.id === heldUnreadFor}
								onOpening={noteOpening}
								onRespondToThread={onRespondToThread}
								navActive={cursor === navIndex}
								onUpdateThread={onUpdateThread}
								selection={
									selection.selecting
										? {
												checked: selection.selectedIds.includes(thread.id),
												disabled: selection.pending,
												onToggle: () => selection.toggle(thread.id),
											}
										: undefined
								}
							/>
						)
					})}
					{paginationControls}
				</>
			)}
		</ScrollArea>
	)

	return (
		<ThreadListEnvironment value={listEnv}>
			<div className={layout.container} data-mail-panes>
				<Dialog
					open={discardTarget !== null}
					onOpenChange={(open) => {
						if (!open && !discardPendingRef.current) setDiscardTarget(null)
					}}
				>
					<DialogContent
						className="p-6"
						aria-describedby="draft-discard-description"
						aria-busy={discardPending}
						onOpenAutoFocus={(event) => {
							event.preventDefault()
							discardCancelRef.current?.focus()
						}}
						onCloseAutoFocus={(event) => {
							event.preventDefault()
							if (discardReturnFocus.current?.isConnected) discardReturnFocus.current.focus()
							else {
								const rows = [
									...(listScrollRef.current?.querySelectorAll<HTMLElement>('[data-nav-row]') ?? []),
								]
								focusNavRow(rows.find((row) => row.dataset.draftId === discardReturnId.current) ?? rows[0])
							}
						}}
					>
						<DialogTitle className="text-base font-semibold">Discard this draft?</DialogTitle>
						<p id="draft-discard-description" className="mt-2 break-words text-sm text-muted-foreground">
							“{discardTarget?.subject || '(no subject)'}” and its attachments will be deleted. This cannot be
							undone.
						</p>
						{discardError ? <ErrorBanner message={discardError} /> : null}
						<div className="mt-6 flex flex-wrap justify-end gap-2">
							<Button
								ref={discardCancelRef}
								variant="outline"
								disabled={discardPending}
								onClick={() => setDiscardTarget(null)}
							>
								Keep draft
							</Button>
							<Button variant="destructive" disabled={discardPending} onClick={() => void confirmDiscard()}>
								{discardPending ? 'Discarding…' : 'Discard permanently'}
							</Button>
						</div>
					</DialogContent>
				</Dialog>
				<section
					className={layout.list}
					data-mail-list
					data-navigation-region="mail-list"
					data-density={preferences.listDensity}
					// The minute the day groups were worked out at; hydration reads the server's back.
					data-list-clock={listEnv.now}
				>
					<Toolbar
						pinned={!selection.selecting}
						className={cn('justify-between px-4', selection.selecting && 'h-auto min-h-12 py-2')}
					>
						{selection.selecting ? (
							<BulkMailToolbar selection={selection} />
						) : (
							<>
								<h1 className="min-w-0 truncate font-display text-base font-semibold tracking-[-0.02em] capitalize">
									{folderTitle}
								</h1>
								<div className="flex items-center gap-1">
									{unreadCount > 0 ? (
										<span className="mr-cluster whitespace-nowrap font-data text-xs text-muted-foreground tabular-nums">
											{unreadCount} unread
										</span>
									) : null}
									{folderId !== 'drafts' ? <BulkMailToolbar selection={selection} /> : null}
									{onRefresh ? <RefreshButton onRefresh={onRefresh} label="Refresh mail" /> : null}
									<ListDensityMenu
										value={preferences.listDensity}
										onChange={(listDensity) => savePreferences({ ...preferences, listDensity })}
									/>
									<ReadingPaneMenu
										value={preferences.readingPane}
										onChange={(readingPane) => savePreferences({ ...preferences, readingPane })}
									/>
								</div>
							</>
						)}
					</Toolbar>

					{onRefresh ? (
						<PullToRefresh
							onRefresh={onRefresh}
							scrollRef={listScrollRef}
							className="pull-to-refresh-under-pinned-bar flex min-h-0 flex-1 flex-col"
						>
							{threadList}
						</PullToRefresh>
					) : (
						threadList
					)}
				</section>
				<section className={layout.reader} data-mail-reader data-navigation-region="mail-reader">
					{hasThread ? (
						(children ?? <ContentReadyOutlet parentRouteId="/mail/f/$folderId" />)
					) : composing ? (
						// Behind the open composer the empty reader stays quiet: its "press C to
						// compose" prompt would only be covered by the window it describes.
						<div className="hidden min-w-0 flex-1 bg-background xl:flex" />
					) : (
						<div className="hidden min-w-0 flex-1 flex-col items-center justify-center gap-3 bg-background px-6 text-center xl:flex">
							<div className="flex h-14 w-14 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground shadow-sm">
								<Reply className="h-6 w-6" />
							</div>
							<div>
								<p className="font-display text-sm font-semibold text-foreground">Select a conversation</p>
								<p className="mt-1 text-sm text-muted-foreground">
									Pick a message from the list, or press <kbd className="kbd">C</kbd> to compose.
								</p>
							</div>
						</div>
					)}
				</section>
			</div>
		</ThreadListEnvironment>
	)
}

/**
 * Renders the list's rows with their day-group headings. Each row is told its
 * place among the rows the keyboard walks (bundles and threads, not headings).
 */
function renderListItems(
	items: ThreadListItem[],
	renderRow: (item: Exclude<ThreadListItem, { kind: 'heading' }>, navIndex: number) => ReactNode,
): ReactNode[] {
	let navIndex = 0
	return items.map((item) =>
		item.kind === 'heading' ? (
			<ThreadListGroupHeading key={item.key} label={item.label} />
		) : (
			renderRow(item, navIndex++)
		),
	)
}

function EmptyState({ moreAvailable = false, children }: { moreAvailable?: boolean; children?: ReactNode }) {
	return (
		<div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-12 text-center">
			<p className="font-display text-sm font-semibold text-foreground">
				{moreAvailable ? 'More messages may be available' : 'All caught up'}
			</p>
			<p className="text-sm text-muted-foreground">
				{moreAvailable ? 'Load the next page to keep looking.' : 'No messages in this folder.'}
			</p>
			{children}
		</div>
	)
}

/** A keyboard context menu opens on the focused element: the row's link, or the row itself. */
function focusNavRow(row: HTMLElement | undefined) {
	;(row?.querySelector<HTMLElement>('.thread-row-link') ?? row)?.focus()
}

// Memoized: a cursor move re-renders only the row it leaves and the row it lands on.
const DraftRow = memo(function DraftRow({
	draft,
	navActive,
	onRequestDiscard,
}: {
	draft: MailDraft
	navActive: boolean
	onRequestDiscard?: (draft: MailDraft, row: HTMLElement | null) => void
}) {
	const { openCompose } = useCompose()
	const openDraft = () => void openCompose({ kind: 'draft', draftId: draft.id })
	const rowRef = useRef<HTMLButtonElement>(null)
	const openingConfirmation = useRef(false)
	return (
		<ContextMenu
			onOpenChange={(open) => {
				if (open) openingConfirmation.current = false
			}}
		>
			<ContextMenuTrigger asChild>
				<button
					ref={rowRef}
					data-draft-id={draft.id}
					type="button"
					onClick={openDraft}
					data-nav-row=""
					data-nav-cursor={navActive ? 'true' : undefined}
					className={THREAD_ROW_CLASS}
				>
					<ThreadRowLayout
						sender={draftRecipientName(draft)}
						epochSeconds={draft.date}
						subject={draft.subject}
						snippet={readableSnippet(draft.snippet)}
					/>
				</button>
			</ContextMenuTrigger>
			<ContextMenuContent
				aria-label={`Actions for draft ${draft.subject || '(no subject)'}`}
				onCloseAutoFocus={(event) => {
					if (openingConfirmation.current) event.preventDefault()
				}}
			>
				<ContextMenuItem aria-keyshortcuts="Enter" onSelect={openDraft}>
					<FileText aria-hidden="true" />
					Open draft
					<ContextMenuShortcut>Enter</ContextMenuShortcut>
				</ContextMenuItem>
				<ContextMenuSeparator />
				<ContextMenuItem
					variant="destructive"
					disabled={!onRequestDiscard}
					onSelect={() => {
						openingConfirmation.current = true
						onRequestDiscard?.(draft, rowRef.current)
					}}
				>
					<Trash2 aria-hidden="true" />
					Discard draft
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	)
})

// Memoized: a cursor move or navigation re-renders only the rows whose props change.
const ThreadRow = memo(function ThreadRow({
	thread,
	folderId,
	baseFolderId,
	bundled,
	active,
	open,
	heldUnread = false,
	onOpening,
	navActive,
	onUpdateThread,
	onRespondToThread,
	selection,
}: {
	thread: MailThread
	selection?: { checked: boolean; disabled: boolean; onToggle: () => void }
	folderId: string
	baseFolderId?: string
	/** The bundle this row is listed under, indented beneath it. */
	bundled?: string
	active?: boolean
	/** Whether this row's conversation is open in the reader beside the list
	 * (not merely highlighted behind the composer, where there is no reader to close). */
	open: boolean
	/** Open, and unread when it opened: the row keeps reading as unread. */
	heldUnread?: boolean
	/** Told when the row's link is followed, before the conversation opens. */
	onOpening?: (thread: MailThread) => void
	navActive: boolean
	onUpdateThread?: (input: ThreadUpdateInput) => Promise<void>
	onRespondToThread?: (input: { threadId: string; kind: ThreadResponseKind }) => Promise<void>
}) {
	const navigate = useNavigate()
	const search = baseFolderId ? { baseFolderId } : {}
	const labelId = useId()
	// Menu actions and their failure belong to this row's thread: rows are keyed by thread id.
	const [busy, setBusy] = useState(false)
	const [actionError, setActionError] = useState<string | null>(null)

	/** Runs one row action; a failure is reported on this row, as the reader toolbar reports its own. */
	async function runRowAction(action: () => Promise<unknown>) {
		setBusy(true)
		setActionError(null)
		try {
			await action()
		} catch {
			// A mutation has already restored the cached thread.
			setActionError('Action failed')
		} finally {
			setBusy(false)
		}
	}

	function openThread() {
		navigate({ to: '/mail/f/$folderId/t/$threadId', params: { folderId, threadId: thread.id }, search })
	}

	const updateFromMenu = (input: ThreadRowUpdate) =>
		runRowAction(async () => {
			if (onUpdateThread) await onUpdateThread({ threadId: thread.id, ...input })
			else await updateThreadState({ data: { threadId: thread.id, ...input } })
			// Like the reader toolbar: a conversation that was moved or marked
			// unread while it is open closes. Any other open conversation stays.
			if (open && (input.folder !== undefined || input.unread === true)) {
				await navigate({ to: '/mail/f/$folderId', params: { folderId }, search })
			}
		})

	// The star shown is the thread's own, except while a toggle is in flight.
	// The requested value lives only for that request, so it can never outlive
	// or disagree with the thread once the request settles.
	const [requestedStar, setRequestedStar] = useState<boolean | null>(null)
	const starPending = requestedStar !== null
	const starred = requestedStar ?? Boolean(thread.starred)

	async function toggleStar() {
		/* v8 ignore next -- the star control is disabled while its request is pending -- @preserve */
		if (starPending) return
		const nextStarred = !starred
		setRequestedStar(nextStarred)
		setActionError(null)
		try {
			if (onUpdateThread) await onUpdateThread({ threadId: thread.id, starred: nextStarred })
			else {
				// Compatibility seam for the isolated screen tests; the production route
				// always supplies the centralized optimistic mutation gateway.
				await updateThreadState({ data: { threadId: thread.id, starred: nextStarred } })
			}
		} catch {
			// The mutation gateway has already restored the cached thread.
			setActionError('Action failed')
		} finally {
			setRequestedStar(null)
		}
	}
	const optimisticThread = starred === Boolean(thread.starred) ? thread : { ...thread, starred }
	const className = cn(THREAD_ROW_CLASS, optimisticThread.unread && 'bg-card/80')
	const rowState = {
		'data-bundled': bundled ? ('true' as const) : undefined,
		'data-active': active ? ('true' as const) : undefined,
		'data-nav-row': '',
		'data-nav-cursor': navActive ? ('true' as const) : undefined,
		'data-unread': optimisticThread.unread ? ('true' as const) : undefined,
	}

	const menu = {
		thread: optimisticThread,
		folderId,
		busy: busy || starPending || Boolean(selection),
		// The folder reader's shortcuts act on the conversation open beside the list.
		readerShortcuts: open,
		onOpen: openThread,
		onRespond: onRespondToThread
			? (kind: ThreadResponseKind) => runRowAction(() => onRespondToThread({ threadId: thread.id, kind }))
			: undefined,
		onToggleStar: toggleStar,
		onUpdate: updateFromMenu,
	}

	return (
		<ThreadRowMenu {...menu}>
			<div className={className} tabIndex={-1} {...rowState} data-flip-id={thread.id}>
				{selection ? (
					<button
						type="button"
						className={THREAD_ROW_LINK_CLASS}
						aria-label={`Toggle selection for ${thread.subject || '(no subject)'}`}
						aria-pressed={selection.checked}
						disabled={selection.disabled}
						onClick={selection.onToggle}
					/>
				) : (
					<Link
						to="/mail/f/$folderId/t/$threadId"
						params={{ folderId, threadId: thread.id }}
						search={baseFolderId ? { baseFolderId } : {}}
						aria-labelledby={labelId}
						onClick={() => onOpening?.(optimisticThread)}
						className={THREAD_ROW_LINK_CLASS}
						activeProps={{ 'data-active': 'true' }}
						aria-current={active ? 'true' : undefined}
						data-active={active ? 'true' : undefined}
						data-nav-cursor={navActive ? 'true' : undefined}
						data-unread={optimisticThread.unread ? 'true' : undefined}
					/>
				)}
				<ThreadRowContent
					thread={optimisticThread}
					folderId={folderId}
					onToggleStar={toggleStar}
					starPending={starPending}
					selection={selection}
					heldUnread={heldUnread}
					labelId={selection ? undefined : labelId}
				/>
				<ThreadRowError message={actionError} />
			</div>
		</ThreadRowMenu>
	)
})
