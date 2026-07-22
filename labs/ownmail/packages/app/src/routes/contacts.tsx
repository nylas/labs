import type { Contact } from '@nylas-labs/cli-kit/v3'
import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import { Menu, Plus, Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AppRailLogo, AppRailMobileNav, AppRailNav, type MailboxAccountOption } from '#app/components/AppRail'
import { CommandPalette, useCommandPaletteShortcut } from '#app/components/CommandPalette'
import { CHROME_ROW_CLASS, CHROME_ROW_SHELL_CLASS } from '#app/config/layout'
import {
	contactDisplayName,
	contactIdFromPath,
	contactSubtitle,
	filterContacts,
	sortContacts,
} from '#features/contacts/lib/contacts-model'
import { flattenContactPages, useContactsPages } from '#features/contacts/state/contacts-state'
import { getContacts, getMailboxInfo } from '#server/fns'
import { Sheet } from '#shared/components/Sheet'
import { edgeCursor, listNavAction, moveCursor } from '#shared/lib/list-nav'
import { initials } from '#shared/lib/presentation'
import { cn } from '#shared/lib/utils'

export const Route = createFileRoute('/contacts')({
	validateSearch: (search): { q?: string } =>
		typeof search.q === 'string' && search.q ? { q: search.q } : {},
	loader: async () => {
		const [info, page] = await Promise.all([getMailboxInfo(), getContacts({ data: {} })])
		return { info, contacts: page.contacts, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) }
	},
	staleTime: 30_000,
	component: ContactsLayout,
})

type ContactsInfo = {
	email: string
	displayName?: string
	appName: string
	accounts?: MailboxAccountOption[]
}

function ContactsLayout() {
	const { info, contacts, nextCursor } = Route.useLoaderData()
	const contactsQuery = useContactsPages({ contacts, ...(nextCursor ? { nextCursor } : {}) })
	const { q } = Route.useSearch()
	const navigate = useNavigate()
	const pathname = useRouterState({ select: (state) => state.location.pathname })
	return (
		<ContactsShell
			info={info}
			contacts={flattenContactPages(contactsQuery.data)}
			nextCursor={contactsQuery.hasNextPage ? contactsQuery.data.pages.at(-1)?.nextCursor : undefined}
			loadingMore={contactsQuery.isFetchingNextPage}
			onLoadMore={() => contactsQuery.fetchNextPage()}
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
	onLoadMore,
}: {
	info: ContactsInfo
	contacts: Contact[]
	nextCursor?: string
	query: string
	selectedId?: string
	onQueryChange: (query: string) => void
	loadingMore?: boolean
	onLoadMore?: () => Promise<unknown>
}) {
	const [extra, setExtra] = useState<Contact[]>([])
	const [nextCursor, setNextCursor] = useState(initialCursor)
	const [localLoadingMore, setLocalLoadingMore] = useState(false)
	const loadingMore = controlledLoadingMore ?? localLoadingMore
	const [paletteOpen, setPaletteOpen] = useState(false)
	const [navigationOpen, setNavigationOpen] = useState(false)
	const [cursor, setCursor] = useState(-1)

	const openPalette = useCallback(() => setPaletteOpen(true), [])
	const closePalette = useCallback(() => setPaletteOpen(false), [])
	useCommandPaletteShortcut(openPalette)

	// A fresh loader run (after a mutation) replaces `contacts`; drop the paged-in
	// extras and reset the cursor so we don't show stale or duplicated rows. The
	// `contacts` dep is the trigger even though the body doesn't read it.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset when a new contacts page arrives
	useEffect(() => {
		setExtra([])
		setNextCursor(initialCursor)
	}, [contacts, initialCursor])

	const all = useMemo(() => sortContacts([...contacts, ...extra]), [contacts, extra])
	const filtered = useMemo(() => filterContacts(all, query), [all, query])
	// Preserve the active search when following a contact link so the list stays filtered.
	const linkSearch = query ? { q: query } : {}

	// Contacts is an arrow-key list as well as a set of ordinary tab stops.
	/* v8 ignore start -- list navigation is exercised through the shared pure helpers */
	useEffect(() => {
		setCursor(selectedId ? filtered.findIndex((contact) => contact.id === selectedId) : -1)
	}, [filtered, selectedId])

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
	}, [cursor, filtered])
	/* v8 ignore stop */

	async function loadMore() {
		// Only reachable from the paged button, which renders solely when a cursor
		// exists and is disabled while a fetch is in flight — no re-entry guard needed.
		if (onLoadMore) {
			await onLoadMore().catch(() => {})
			return
		}
		setLocalLoadingMore(true)
		try {
			const res = await getContacts({ data: { pageToken: nextCursor } })
			setExtra((prev) => [...prev, ...res.contacts])
			setNextCursor(res.nextCursor)
		} catch {
			// The button remains available for a retry.
		} finally {
			setLocalLoadingMore(false)
		}
	}

	const railNavProps = {
		email: info.email,
		displayName: info.displayName,
		accounts: info.accounts,
		active: 'contacts' as const,
		onOpenCommandPalette: openPalette,
	}

	return (
		<div className="flex h-screen w-full flex-col overflow-hidden bg-background text-foreground">
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
							className="h-full w-full border-0 bg-transparent py-2 pr-3 pl-7 text-sm text-foreground outline-none placeholder:text-muted-foreground"
							aria-label="Search contacts"
							autoCapitalize="none"
						/>
					</div>
					<Link
						to="/contacts/new"
						search={linkSearch}
						className="flex shrink-0 items-center gap-2 border-l border-border px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted/60"
					>
						<Plus className="h-4 w-4" />
						<span className="hidden sm:inline">New contact</span>
					</Link>
				</header>
			</div>

			<div className="flex min-h-0 flex-1 overflow-hidden">
				<AppRailNav {...railNavProps} />

				<div
					className={cn(
						'flex w-full shrink-0 flex-col overflow-hidden border-r border-border bg-background md:w-80',
						selectedId && 'hidden md:flex',
					)}
				>
					{filtered.length === 0 ? (
						<p className="px-4 py-8 text-center text-sm text-muted-foreground">
							{query ? 'No contacts match your search.' : 'No contacts yet.'}
						</p>
					) : (
						<ul className="min-h-0 flex-1 overflow-y-auto py-1">
							{filtered.map((contact) => (
								<li key={contact.id}>
									<ContactListItem
										contact={contact}
										active={contact.id === selectedId}
										keyboardActive={cursor === filtered.indexOf(contact)}
										search={linkSearch}
									/>
								</li>
							))}
						</ul>
					)}
					{nextCursor ? (
						<button
							type="button"
							onClick={loadMore}
							disabled={loadingMore}
							className="border-t border-border py-2.5 text-center text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/60 disabled:opacity-50"
						>
							{loadingMore ? 'Loading…' : 'Load more'}
						</button>
					) : null}
				</div>

				<div className={cn('min-w-0 flex-1 overflow-y-auto', !selectedId && 'hidden md:block')}>
					<Outlet />
				</div>
			</div>

			<CommandPalette open={paletteOpen} onClose={closePalette} />

			<Sheet open={navigationOpen} onClose={() => setNavigationOpen(false)} title="Navigation">
				<AppRailMobileNav {...railNavProps} onNavigate={() => setNavigationOpen(false)} />
			</Sheet>
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
	return (
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
