import type { Contact } from '@nylas-labs/cli-kit/v3'
import { createFileRoute, Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { Loader2, Menu, Plus, Search } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppRailLogo, AppRailMobileNav, AppRailNav, type MailboxAccountOption } from '#app/components/AppRail'
import { CommandPalette, useCommandPaletteShortcut } from '#app/components/CommandPalette'
import { ContentReadyOutlet } from '#app/components/ContentReadyOutlet'
import { MobileTabBar } from '#app/components/MobileTabBar'
import { CHROME_ROW_CLASS, CHROME_ROW_SHELL_CLASS } from '#app/config/layout'
import { ensureMailboxInfo } from '#app/query/mailbox-info'
import { ContactContextMenu } from '#features/contacts/components/ContactContextMenu'
import {
	contactDisplayName,
	contactIdFromPath,
	contactSubtitle,
	filterContacts,
	sortContacts,
} from '#features/contacts/lib/contacts-model'
import {
	contactsInitialData,
	flattenContactPages,
	useContactsPages,
} from '#features/contacts/state/contacts-state'
import { getContacts } from '#server/fns'
import { PullToRefresh, RefreshButton } from '#shared/components/PullToRefresh'
import { Sheet } from '#shared/components/Sheet'
import { UNDER_MOBILE_BAR_CLASS } from '#shared/components/ui/glass'
import { useIdentityState } from '#shared/hooks/use-identity-state'
import { edgeCursor, isContextMenuKey, listNavAction, moveCursor } from '#shared/lib/list-nav'
import { initials } from '#shared/lib/presentation'
import { seededData } from '#shared/lib/seeded-data'
import { cn } from '#shared/lib/utils'

export const Route = createFileRoute('/contacts')({
	validateSearch: (search): { q?: string } =>
		typeof search.q === 'string' && search.q ? { q: search.q } : {},
	loader: async ({ context }) => {
		const [info, page] = await Promise.all([
			ensureMailboxInfo(context.queryClient),
			getContacts({ data: {} }),
		])
		return { info, contacts: page.contacts, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) }
	},
	staleTime: 30_000,
	component: ContactsLayout,
})

/** Pagination state owned by one inbox's loaded contact list; see `ContactsShell`. */
type ContactsPaging = {
	extra: Contact[]
	nextCursor: string | undefined
	loadingMore: boolean
	loadMoreError: boolean
}

type ContactsInfo = {
	email: string
	displayName?: string
	appName: string
	accounts?: MailboxAccountOption[]
}

function ContactsLayout() {
	const { info, contacts, nextCursor } = Route.useLoaderData()
	const initialPage = useMemo(
		() => ({ contacts, ...(nextCursor ? { nextCursor } : {}) }),
		[contacts, nextCursor],
	)
	const contactsQuery = useContactsPages(initialPage)
	const contactPages = seededData(contactsQuery.data, contactsInitialData(initialPage))
	const { q } = Route.useSearch()
	const navigate = useNavigate()
	const pathname = useRouterState({ select: (state) => state.location.pathname })
	async function loadMoreContacts() {
		await contactsQuery.fetchNextPage({ cancelRefetch: false })
	}
	return (
		<ContactsShell
			info={info}
			contacts={flattenContactPages(contactPages)}
			nextCursor={contactsQuery.hasNextPage ? contactPages.pages.at(-1)?.nextCursor : undefined}
			loadingMore={contactsQuery.isFetchingNextPage}
			loadMoreError={contactsQuery.isFetchNextPageError}
			onLoadMore={loadMoreContacts}
			onRefresh={() => contactsQuery.refetch({ throwOnError: true })}
			query={q ?? ''}
			selectedId={contactIdFromPath(pathname)}
			onQueryChange={(next) => navigate({ to: '/contacts', search: next ? { q: next } : {}, replace: true })}
		/>
	)
}

export function ContactsShell({
	info,
	contacts,
	nextCursor: initialCursor,
	query,
	selectedId,
	onQueryChange,
	loadingMore: controlledLoadingMore,
	loadMoreError: controlledLoadMoreError,
	onLoadMore,
	onRefresh,
}: {
	info: ContactsInfo
	contacts: Contact[]
	nextCursor?: string
	query: string
	selectedId?: string
	onQueryChange: (query: string) => void
	loadingMore?: boolean
	loadMoreError?: boolean
	onLoadMore?: () => Promise<unknown>
	onRefresh?: () => Promise<unknown>
}) {
	// Paged-in rows and the pagination status belong to one inbox and one loaded
	// first page. A fresh loader run (after a mutation, or for another inbox)
	// replaces `contacts`, and the paging state starts clean on that same render:
	// stale or duplicated rows never paint, and a page that answers late for the
	// previous list is dropped.
	const [paging, setPaging] = useIdentityState<ContactsPaging>([info.email, contacts, initialCursor], () => ({
		extra: [],
		nextCursor: initialCursor,
		loadingMore: false,
		loadMoreError: false,
	}))
	const { extra, nextCursor } = paging
	const localLoadingMore = paging.loadingMore
	const localLoadMoreError = paging.loadMoreError
	const loadingMore = Boolean(controlledLoadingMore || localLoadingMore)
	const loadMoreFailed = !loadingMore && Boolean(controlledLoadMoreError || localLoadMoreError)
	const [paletteOpen, setPaletteOpen] = useState(false)
	const [navigationOpen, setNavigationOpen] = useState(false)
	const loadMorePendingRef = useRef<number | null>(null)
	const listScrollRef = useRef<HTMLUListElement>(null)
	const listGenerationRef = useRef({ contacts, initialCursor, generation: 0 })
	if (
		listGenerationRef.current.contacts !== contacts ||
		listGenerationRef.current.initialCursor !== initialCursor
	) {
		listGenerationRef.current = {
			contacts,
			initialCursor,
			generation: listGenerationRef.current.generation + 1,
		}
	}

	const openPalette = useCallback(() => setPaletteOpen(true), [])
	const closePalette = useCallback(() => setPaletteOpen(false), [])
	useCommandPaletteShortcut(openPalette)

	const all = useMemo(() => sortContacts(dedupeContacts([...contacts, ...extra])), [contacts, extra])
	const filtered = useMemo(() => filterContacts(all, query), [all, query])
	// Preserve the active search when following a contact link so the list stays filtered.
	const linkSearch = query ? { q: query } : {}

	// Contacts is an arrow-key list as well as a set of ordinary tab stops. The
	// keyboard cursor starts on the selected contact and belongs to that
	// selection and list: another selection or filter starts from its own row.
	const [cursor, setCursor] = useIdentityState([filtered, selectedId], () =>
		selectedId ? filtered.findIndex((contact) => contact.id === selectedId) : -1,
	)

	/* v8 ignore start -- list navigation is exercised through the shared pure helpers -- @preserve */
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
				target?.closest?.('button, a, select, [role="menu"]')
			)
				return
			// The browser opens a keyboard context menu on the focused element, so
			// the cursored contact takes focus first and its menu is the one that opens.
			if (isContextMenuKey(event)) {
				document.querySelector<HTMLElement>('[data-contact-id][data-nav-cursor="true"]')?.focus()
				return
			}
			if (document.querySelector('[role="dialog"]')) return
			const action = listNavAction(event.key)
			if (!action) return
			event.preventDefault()
			if (action === 'open') {
				const contact = filtered[cursor]
				if (contact) {
					const element = Array.from(document.querySelectorAll<HTMLAnchorElement>('[data-contact-id]')).find(
						(link) => link.dataset.contactId === contact.id,
					)
					element?.click()
				}
				return
			}
			setCursor((current) =>
				action === 'first' || action === 'last'
					? edgeCursor(action, filtered.length)
					: moveCursor(current, action === 'down' ? 1 : -1, filtered.length),
			)
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [cursor, filtered, setCursor])
	/* v8 ignore stop -- @preserve */

	async function loadMore() {
		if (!nextCursor || loadMorePendingRef.current === listGenerationRef.current.generation || loadingMore)
			return
		const actionGeneration = listGenerationRef.current.generation
		loadMorePendingRef.current = actionGeneration
		setPaging((current) => ({ ...current, loadMoreError: false, loadingMore: true }))
		try {
			if (onLoadMore) {
				await onLoadMore()
				return
			}
			const res = await getContacts({ data: { pageToken: nextCursor } })
			setPaging((current) => ({
				...current,
				extra: [...current.extra, ...res.contacts],
				nextCursor: res.nextCursor,
			}))
		} catch {
			setPaging((current) => ({ ...current, loadMoreError: true }))
		} finally {
			if (listGenerationRef.current.generation === actionGeneration) loadMorePendingRef.current = null
			setPaging((current) => ({ ...current, loadingMore: false }))
		}
	}
	const paginationControls = nextCursor ? (
		<div className="w-full border-t border-border p-3">
			{loadMoreFailed ? (
				<p id="contacts-pagination-error" role="alert" className="mb-2 text-center text-xs text-destructive">
					Could not load more contacts. Check your connection, then try again.
				</p>
			) : null}
			<button
				type="button"
				onClick={() => void loadMore()}
				aria-disabled={loadingMore || undefined}
				aria-busy={loadingMore}
				aria-describedby={loadMoreFailed ? 'contacts-pagination-error' : undefined}
				className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-center text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/60 aria-disabled:cursor-wait aria-disabled:opacity-60"
			>
				{loadingMore ? (
					<>
						<Loader2 className="h-4 w-4 animate-spin" /> Loading more contacts…
					</>
				) : loadMoreFailed ? (
					'Try loading more contacts'
				) : (
					'Load more contacts'
				)}
			</button>
		</div>
	) : null

	const railNavProps = {
		email: info.email,
		displayName: info.displayName,
		accounts: info.accounts,
		active: 'contacts' as const,
		onOpenCommandPalette: openPalette,
	}
	const contactsList =
		filtered.length === 0 ? (
			<ContactsEmptyState query={query} moreAvailable={Boolean(nextCursor)}>
				{paginationControls}
			</ContactsEmptyState>
		) : (
			<>
				<ul
					ref={listScrollRef}
					className={cn(
						'min-h-0 flex-1 overflow-y-auto py-1',
						// The list runs beneath the tab bar unless the pagination row sits below it.
						!paginationControls && [UNDER_MOBILE_BAR_CLASS, '[--under-mobile-bar-gap:0.25rem]'],
					)}
				>
					{filtered.map((contact, index) => (
						<li key={contact.id}>
							<ContactListItem
								contact={contact}
								active={contact.id === selectedId}
								keyboardActive={cursor === index}
								search={linkSearch}
							/>
						</li>
					))}
				</ul>
				{paginationControls}
			</>
		)

	return (
		<div className="flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground">
			<div className={CHROME_ROW_SHELL_CLASS}>
				<AppRailLogo appName={info.appName} className="hidden md:flex" />
				<header
					className={cn(
						'flex min-w-0 flex-1 items-stretch border-b border-border bg-background',
						CHROME_ROW_CLASS,
					)}
				>
					<button
						type="button"
						onClick={() => setNavigationOpen(true)}
						className="flex h-11 w-11 shrink-0 items-center justify-center border-r border-border text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground md:hidden"
						aria-label="Open navigation"
					>
						<Menu className="h-4 w-4" />
					</button>
					<div className="relative flex min-w-0 flex-1 items-center px-3">
						<Search className="pointer-events-none absolute left-3 h-4 w-4 text-muted-foreground" />
						<input
							id="contacts-search"
							type="search"
							value={query}
							onChange={(event) => onQueryChange(event.target.value)}
							placeholder="Search contacts"
							className="min-h-11 w-full border-0 bg-transparent py-2 pr-3 pl-7 text-sm text-foreground placeholder:text-muted-foreground"
							aria-label="Search contacts"
							autoCapitalize="none"
						/>
					</div>
					{onRefresh ? <RefreshButton onRefresh={onRefresh} label="Refresh contacts" /> : null}
					<Link
						to="/contacts/new"
						search={linkSearch}
						aria-label="New contact"
						className="flex min-h-11 shrink-0 items-center gap-2 border-l border-border px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted/60"
					>
						<Plus className="h-4 w-4" />
						<span className="hidden md:inline">New contact</span>
					</Link>
				</header>
			</div>

			<div className="flex min-h-0 flex-1 overflow-hidden">
				<AppRailNav {...railNavProps} />

				<div
					className={cn(
						'flex w-full shrink-0 flex-col overflow-hidden border-r border-border bg-background md:w-80',
						selectedId && 'hidden md:flex',
						// An empty list and the pagination row do not scroll: they stay clear of the tab bar.
						(filtered.length === 0 || paginationControls) && UNDER_MOBILE_BAR_CLASS,
					)}
				>
					{onRefresh ? (
						<PullToRefresh
							onRefresh={onRefresh}
							scrollRef={listScrollRef}
							className="flex min-h-0 flex-1 flex-col"
						>
							{contactsList}
						</PullToRefresh>
					) : (
						contactsList
					)}
				</div>

				<div
					className={cn(
						'min-w-0 flex-1 overflow-y-auto',
						UNDER_MOBILE_BAR_CLASS,
						!selectedId && 'hidden md:block',
					)}
				>
					<ContentReadyOutlet parentRouteId="/contacts" />
				</div>
			</div>
			<MobileTabBar active="contacts" />

			<CommandPalette open={paletteOpen} onClose={closePalette} />

			<Sheet open={navigationOpen} onClose={() => setNavigationOpen(false)} title="Navigation">
				<AppRailMobileNav
					{...railNavProps}
					onNavigate={() => setNavigationOpen(false)}
					showDestinations={false}
				/>
			</Sheet>
		</div>
	)
}

function dedupeContacts(contacts: Contact[]): Contact[] {
	return [...new Map(contacts.map((contact) => [contact.id, contact])).values()]
}

function ContactsEmptyState({
	query,
	moreAvailable,
	children,
}: {
	query: string
	moreAvailable: boolean
	children?: ReactNode
}) {
	return (
		<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 py-8 text-center">
			<p className="text-sm font-medium text-foreground">
				{query
					? 'No contacts match your search.'
					: moreAvailable
						? 'More contacts may be available'
						: 'No contacts yet.'}
			</p>
			{moreAvailable ? (
				<p className="text-sm text-muted-foreground">Load the next page to keep looking.</p>
			) : null}
			{children}
		</div>
	)
}

function ContactListItem({
	contact,
	active,
	keyboardActive,
	search,
}: {
	contact: Contact
	active: boolean
	keyboardActive: boolean
	search: { q?: string }
}) {
	const name = contactDisplayName(contact)
	const subtitle = contactSubtitle(contact)
	const navigate = useNavigate()
	const openContact = (flags: { edit?: true; delete?: true } = {}) =>
		navigate({
			to: '/contacts/$contactId',
			params: { contactId: contact.id },
			search: { ...search, ...flags },
		})
	return (
		<ContactContextMenu
			contact={contact}
			onOpen={() => openContact()}
			onEdit={() => openContact({ edit: true })}
			onNewEmail={(to) => navigate({ to: '/mail/compose', search: { to } })}
			// Deleting is confirmed on the contact's own page.
			onRequestDelete={() => openContact({ delete: true })}
		>
			<Link
				to="/contacts/$contactId"
				params={{ contactId: contact.id }}
				search={search}
				aria-current={active ? 'true' : undefined}
				data-contact-id={contact.id}
				data-nav-cursor={keyboardActive ? 'true' : undefined}
				className={cn(
					'flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/60',
					(active || keyboardActive) && 'bg-muted',
				)}
			>
				<ContactAvatar name={name} className="h-8 w-8 text-xs" />
				<span className="min-w-0 flex-1">
					<span className="block truncate text-sm font-medium">{name}</span>
					{subtitle ? <span className="block truncate text-xs text-muted-foreground">{subtitle}</span> : null}
				</span>
			</Link>
		</ContactContextMenu>
	)
}

export function ContactAvatar({ name, className }: { name: string; className?: string }) {
	return (
		<span
			aria-hidden="true"
			className={cn(
				'flex shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-muted-foreground',
				className,
			)}
		>
			{initials(name)}
		</span>
	)
}
