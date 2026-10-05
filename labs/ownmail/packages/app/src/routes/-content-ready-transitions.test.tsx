// @vitest-environment jsdom
import type { QueryClient } from '@tanstack/react-query'
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { act, fireEvent, waitFor, within } from '@testing-library/react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Content-ready transitions (design.md): every identity-changing transition is
// exercised here with the real router, the real route components and a real
// QueryClient. Only the server boundary is replaced, so a held server call
// freezes the app in exactly the state a slow network would.
vi.mock('@tanstack/react-start', () => ({
	createServerFn: () => {
		const builder: Record<string, unknown> = {
			handler: (fn: unknown) => fn,
			inputValidator: () => builder,
			validator: () => builder,
			middleware: () => builder,
		}
		return builder
	},
}))
vi.mock('@tanstack/react-start/server', () => ({
	getRequest: () => new Request('http://ownmail.local/'),
}))
vi.mock('#server/platform', () => ({
	platform: async () => ({ env: {} }),
	usingDevMocks: async () => true,
}))

const fns = vi.hoisted(() => ({
	getMailboxInfo: vi.fn(),
	getAccountCapabilities: vi.fn(),
	updateMailboxDisplayName: vi.fn(),
	resetMailboxPassword: vi.fn(),
	getFolders: vi.fn(),
	createFolder: vi.fn(),
	updateFolder: vi.fn(),
	deleteFolder: vi.fn(),
	getThreads: vi.fn(),
	getThreadMessages: vi.fn(),
	markThreadRead: vi.fn(),
	sendMessage: vi.fn(),
	updateThreadState: vi.fn(),
	saveDraft: vi.fn(),
	getDraft: vi.fn(),
	sendDraft: vi.fn(),
	deleteDraft: vi.fn(),
	listDrafts: vi.fn(),
	getContacts: vi.fn(),
	getContact: vi.fn(),
	createContact: vi.fn(),
	updateContact: vi.fn(),
	deleteContact: vi.fn(),
	searchContacts: vi.fn(),
	saveComposeRecipients: vi.fn(),
}))
vi.mock('#server/fns', () => fns)

const calendarFns = vi.hoisted(() => ({
	createCalendar: vi.fn(),
	updateCalendar: vi.fn(),
	deleteCalendar: vi.fn(),
	getEvents: vi.fn(),
	createEvent: vi.fn(),
	updateEvent: vi.fn(),
	deleteEvent: vi.fn(),
	rsvpEvent: vi.fn(),
}))
vi.mock('#features/calendar/server/calendar-fns', () => calendarFns)

Element.prototype.scrollIntoView = vi.fn()
window.scrollTo = vi.fn()

import { accountScope, resetAccountScope } from '#app/lib/account-scope'
import { setSwitchingTo } from '#app/lib/account-switch-status'
import {
	defaultUserPreferences,
	userPreferencesTestApi,
	writeUserPreferences,
} from '#app/preferences/user-preferences'
import { mailboxInfoQueryOptions } from '#app/query/mailbox-info'
import { getRouter } from '../router.js'

const ADA = 'ada@ownmail.com'
const GRACE = 'grace@ownmail.com'
const GRACE_HANDLE = 'b'.repeat(43)

const accounts = (active: string) => [
	{ email: ADA, handle: 'a'.repeat(43), active: active === ADA },
	{ email: GRACE, handle: GRACE_HANDLE, active: active === GRACE },
]

const thread = (id: string, subject: string, folders = ['inbox']) => ({
	id,
	subject,
	snippet: `${subject} snippet`,
	participants: [{ name: 'Sender', email: 'sender@example.com' }],
	folders,
	unread: false,
	starred: false,
	latest_message_received_date: 1_700_000_000,
})

const detail = (id: string, subject: string) => ({
	thread: thread(id, subject),
	messages: [
		{
			id: `${id}-message`,
			thread_id: id,
			subject,
			from: [{ name: 'Sender', email: 'sender@example.com' }],
			to: [{ email: ADA }],
			date: 1_700_000_000,
			body: `<p>${subject} body</p>`,
			snippet: `${subject} snippet`,
		},
	],
	mailboxEmail: ADA,
})

const fetchMock = vi.fn()
let mounted: { root: Root } | undefined

function hold<T>() {
	return Promise.withResolvers<T>()
}

function page() {
	return within(document.body)
}

function pageText() {
	return document.body.textContent ?? ''
}

async function mountApp(path: string) {
	const router = getRouter()
	router.update({ ...router.options, history: createMemoryHistory({ initialEntries: [path] }) })
	await router.load()
	const root = createRoot(document)
	mounted = { root }
	await act(async () => root.render(<RouterProvider router={router} />))
	return { router, queryClient: router.options.context.queryClient as QueryClient }
}

/** Starts a navigation and returns the pending view the router shows for it. */
async function navigateUntilPending(navigate: () => unknown, pendingTestId: string) {
	await act(async () => {
		void navigate()
		// The router commits its pending matches on a timer; let that settle so
		// the returned element is the pending view that stays on screen.
		await new Promise((resolve) => setTimeout(resolve, 20))
	})
	return page().getByTestId(pendingTestId)
}

beforeEach(() => {
	vi.stubGlobal('fetch', fetchMock)
	// The version poll is irrelevant here; a failed poll changes nothing.
	fetchMock.mockImplementation(async () => new Response('{}', { status: 500 }))
	fns.getMailboxInfo.mockResolvedValue({ email: ADA, appName: 'OwnMail', accounts: accounts(ADA) })
	fns.getFolders.mockResolvedValue([
		{ id: 'inbox', name: 'Inbox' },
		{ id: 'sent', name: 'Sent' },
	])
	fns.listDrafts.mockResolvedValue([])
})

afterEach(async () => {
	await act(async () => mounted?.root.unmount())
	mounted = undefined
	act(() => setSwitchingTo(null))
	resetAccountScope()
	userPreferencesTestApi.reset()
	vi.unstubAllGlobals()
	vi.resetAllMocks()
	window.localStorage.clear()
})

describe('account switch', () => {
	it('unmounts the previous inbox instead of covering it, and never re-seeds its data into the next inbox', async () => {
		fns.getFolders.mockResolvedValue([
			{ id: 'inbox', name: 'Inbox', unread_count: 12 },
			{ id: 'ada-receipts', name: 'Ada receipts' },
		])
		fns.getThreads.mockResolvedValue({ threads: [thread('ada-1', 'Ada quarterly invoice')] })
		const { queryClient } = await mountApp('/mail/f/inbox')
		expect(pageText()).toContain('Ada quarterly invoice')
		expect(pageText()).toContain('Ada receipts')

		const auth = hold<Response>()
		fetchMock.mockImplementation(async (url: string) =>
			url === '/auth' ? auth.promise : new Response('{}', { status: 500 }),
		)
		const graceForm = document.querySelector<HTMLFormElement>(
			`form[action="/auth"]:has(input[value="${GRACE_HANDLE}"])`,
		)
		fireEvent.submit(graceForm as HTMLFormElement)

		// While the session rotates, the app itself is gone: a cover would leave
		// Ada's folders, counts and subjects in the DOM and her observers mounted.
		const loader = await waitFor(() => page().getByText(/Switching to/))
		expect(loader.closest('[role="status"]')).toHaveAttribute('aria-live', 'polite')
		expect(loader).toHaveTextContent(`Switching to ${GRACE}…`)
		expect(pageText()).not.toContain('Ada quarterly invoice')
		expect(pageText()).not.toContain('Ada receipts')
		expect(page().queryByRole('navigation', { name: 'Primary' })).toBeNull()
		expect(document.querySelector('.backdrop-blur-sm')).toBeNull()
		// Glass may only show the current screen's content, so a transition cover is never glass.
		expect(document.querySelector('.glass-bar, .glass-panel')).toBeNull()

		fns.getMailboxInfo.mockResolvedValue({ email: GRACE, appName: 'OwnMail', accounts: accounts(GRACE) })
		fns.getFolders.mockResolvedValue([
			{ id: 'inbox', name: 'Inbox' },
			{ id: 'grace-notes', name: 'Grace notes' },
		])
		fns.getThreads.mockResolvedValue({ threads: [thread('grace-1', 'Grace launch plan')] })
		await act(async () => auth.resolve(new Response(null, { status: 204 })))

		await waitFor(() => expect(pageText()).toContain('Grace launch plan'))
		expect(pageText()).toContain('Grace notes')
		expect(pageText()).not.toContain('Switching to')
		// A still-mounted observer would have written Ada's folders back into the
		// cleared cache as fresh initial data, and Grace would have inherited them.
		expect(pageText()).not.toContain('Ada')
		const cached = JSON.stringify(
			queryClient
				.getQueryCache()
				.getAll()
				.map((query) => query.state.data),
		)
		expect(cached).toContain('Grace launch plan')
		expect(cached).not.toContain('Ada')
		// Every entry is filed under Grace; nothing is left under Ada's keys.
		expect(accountScope()).toBe(GRACE)
		const keys = queryClient
			.getQueryCache()
			.getAll()
			.map((query) => query.queryKey)
		expect(keys.filter((key) => key[0] === 'mail').every((key) => key[1] === GRACE)).toBe(true)
	})

	it('drops the previous inbox when the session changes in another tab, instead of blending the two', async () => {
		fns.getFolders.mockResolvedValue([
			{ id: 'inbox', name: 'Inbox' },
			{ id: 'ada-receipts', name: 'Ada receipts' },
		])
		fns.getThreads.mockResolvedValue({ threads: [thread('ada-1', 'Ada quarterly invoice')] })
		const { queryClient } = await mountApp('/mail/f/inbox')
		expect(pageText()).toContain('Ada quarterly invoice')
		expect(accountScope()).toBe(ADA)

		// Another tab switches inbox: the shared cookie now answers for Grace.
		const graceInfo = hold<unknown>()
		fns.getMailboxInfo.mockReturnValue(graceInfo.promise)
		fns.getFolders.mockResolvedValue([
			{ id: 'inbox', name: 'Inbox' },
			{ id: 'grace-notes', name: 'Grace notes' },
		])
		fns.getThreads.mockResolvedValue({ threads: [thread('grace-1', 'Grace launch plan')] })
		// This tab comes back into focus and refetches what it is showing.
		await act(async () => {
			void queryClient.invalidateQueries({ refetchType: 'active' })
			await new Promise((resolve) => setTimeout(resolve, 20))
		})
		// Until the mailbox answers, Grace's data can only land under Ada's keys;
		// the moment it does, the tab must stop presenting it as Ada's.
		await act(async () => {
			graceInfo.resolve({ email: GRACE, appName: 'OwnMail', accounts: accounts(GRACE) })
			await new Promise((resolve) => setTimeout(resolve, 0))
		})
		fns.getMailboxInfo.mockResolvedValue({ email: GRACE, appName: 'OwnMail', accounts: accounts(GRACE) })

		await waitFor(() => expect(pageText()).toContain('Grace notes'))
		await waitFor(() => expect(pageText()).not.toContain('Switching to'))
		expect(pageText()).toContain('Grace launch plan')
		expect(pageText()).not.toContain('Ada')
		expect(accountScope()).toBe(GRACE)
		const queries = queryClient.getQueryCache().getAll()
		expect(JSON.stringify(queries.map((query) => query.state.data))).not.toContain('Ada')
		expect(JSON.stringify(queries.map((query) => query.queryKey))).not.toContain(ADA)
	})
})

describe('first render', () => {
	async function serverHtml(path: string) {
		const router = getRouter()
		router.update({ ...router.options, history: createMemoryHistory({ initialEntries: [path] }) })
		await router.load()
		const host = document.createElement('div')
		host.innerHTML = renderToString(<RouterProvider router={router} />)
		return within(host)
	}

	beforeEach(() => {
		// This device has saved choices the server cannot know about.
		writeUserPreferences({
			...defaultUserPreferences(),
			readingPane: 'none',
			listDensity: 'condensed',
			primaryTimezone: 'Pacific/Auckland',
			hiddenCalendarsByAccount: { [ADA]: ['primary'] },
		})
	})

	it('renders actual inbox rows on the server before preference hydration', async () => {
		fns.getThreads.mockResolvedValue({ threads: [thread('inbox-1', 'Inbox only subject')] })

		const html = await serverHtml('/mail/f/inbox')

		// The folders around the list do not depend on a preference and are real.
		expect(html.getByRole('heading', { level: 1 })).toHaveTextContent('Inbox')
		expect(html.queryByTestId('thread-list-skeleton')).toBeNull()
		expect(html.queryByText('Inbox only subject')).not.toBeNull()

		// In the browser the saved layout is there on the first render.
		await mountApp('/mail/f/inbox')
		expect(page().queryByTestId('folder-pending')).toBeNull()
		expect(pageText()).toContain('Inbox only subject')
		expect(page().getByRole('button', { name: 'Reading pane: No split' })).toBeInTheDocument()
		// The saved list density is there too: rows never paint at the default height first.
		expect(page().getByText('Inbox only subject').closest('[data-density]')).toHaveAttribute(
			'data-density',
			'condensed',
		)
	})

	it('renders the search placeholder on the server', async () => {
		fns.getThreads.mockResolvedValue({ threads: [thread('beta-1', 'Beta result')] })

		const html = await serverHtml('/mail/search?q=beta')

		expect(html.queryByTestId('search-pending')).not.toBeNull()
		expect(html.queryByText('Beta result')).toBeNull()
	})

	it('renders an empty calendar grid on the server, not events in the wrong timezone or from hidden calendars', async () => {
		const calendar = { id: 'primary', name: 'Ada calendar', is_primary: true }
		calendarFns.getEvents.mockResolvedValue({
			calendar,
			calendars: [calendar],
			events: [
				{
					id: 'hidden-1',
					calendar_id: 'primary',
					title: 'Hidden on this device',
					when: { object: 'timespan', start_time: 1_772_452_800, end_time: 1_772_456_400 },
				},
			],
		})

		const html = await serverHtml('/calendar/month?date=2026-03-02')

		expect(html.queryByTestId('calendar-pending')).not.toBeNull()
		expect(html.getByRole('heading', { level: 1 })).toHaveTextContent('March 2026')
		// With defaults, the server would have painted an event this device hides.
		expect(html.queryByText('Hidden on this device')).toBeNull()

		await mountApp('/calendar/month?date=2026-03-02')
		expect(page().queryByTestId('calendar-pending')).toBeNull()
		expect(pageText()).not.toContain('Hidden on this device')
	})

	it('renders an empty settings page on the server, not default choices that change after hydration', async () => {
		fns.getAccountCapabilities.mockResolvedValue({ passwordResetEnabled: false })

		const html = await serverHtml('/settings')

		expect(html.queryByTestId('settings-pending')).not.toBeNull()
		expect(html.queryByLabelText('Darken email content automatically')).toBeNull()

		await mountApp('/settings')
		expect(page().getByRole('combobox', { name: /Primary timezone/ })).toHaveValue('Pacific/Auckland')
	})
})

describe('folder switch', () => {
	it('shows the destination folder over a skeleton, never the previous folder under a new highlight', async () => {
		const sent = hold<unknown>()
		fns.getThreads.mockImplementation(({ data }: { data: { folderId?: string } }) =>
			data.folderId === 'sent'
				? sent.promise
				: Promise.resolve({ threads: [thread('inbox-1', 'Inbox only subject')] }),
		)
		window.localStorage.setItem('ownmail:user-preferences:v1', JSON.stringify({ listDensity: 'compact' }))
		const { router } = await mountApp('/mail/f/inbox')
		expect(pageText()).toContain('Inbox only subject')
		const inboxList = document.querySelector('[data-slot="scroll-area-viewport"]') as HTMLElement
		inboxList.scrollTop = 120
		fireEvent.scroll(inboxList)

		const pending = await navigateUntilPending(
			() => router.navigate({ to: '/mail/f/$folderId', params: { folderId: 'sent' } }),
			'folder-pending',
		)

		// The sidebar already highlights Sent; the list beside it must agree.
		expect(within(pending).getByRole('heading', { level: 1 })).toHaveTextContent('Sent')
		expect(within(pending).getByTestId('thread-list-skeleton')).toBeInTheDocument()
		expect(pageText()).not.toContain('Inbox only subject')
		// The placeholder rows are list rows at the saved density, so they have
		// the height of the rows that replace them and nothing shifts.
		const skeleton = within(pending).getByTestId('thread-list-skeleton')
		expect(skeleton.closest('section')).toHaveAttribute('data-density', 'compact')
		expect(skeleton.querySelectorAll('.thread-row')).toHaveLength(6)
		expect(skeleton.querySelector('.thread-row-snippet')).not.toBeEmptyDOMElement()

		await act(async () => sent.resolve({ threads: [thread('sent-1', 'Sent only subject', ['sent'])] }))
		await waitFor(() => expect(pageText()).toContain('Sent only subject'))
		expect(page().queryByTestId('folder-pending')).toBeNull()
		expect(pageText()).not.toContain('Inbox only subject')

		// The router carries a scrolled element's offset to whatever replaces it;
		// Inbox's offset must not become Sent's.
		const sentList = document.querySelector('[data-slot="scroll-area-viewport"]') as HTMLElement
		expect(sentList.scrollTop).toBe(0)

		// Returning to a cached folder shows no pending view, so the route stays
		// mounted. Its list is still a new scroll area that starts at the top.
		sentList.scrollTop = 80
		fireEvent.scroll(sentList)
		await act(async () => router.navigate({ to: '/mail/f/$folderId', params: { folderId: 'inbox' } }))
		await waitFor(() => expect(pageText()).toContain('Inbox only subject'))
		const returnedList = document.querySelector('[data-slot="scroll-area-viewport"]') as HTMLElement
		expect(returnedList).not.toBe(sentList)
		expect(returnedList.scrollTop).toBe(0)
	})
})

describe('search query change', () => {
	function searchResults(q: string) {
		return q === 'alpha'
			? { threads: [thread('alpha-1', 'Alpha result')] }
			: { threads: [thread('beta-1', 'Beta result'), thread('beta-2', 'Beta follow-up')] }
	}

	it('never shows the previous query’s results under the new query', async () => {
		const beta = hold<unknown>()
		fns.getThreads.mockImplementation(({ data }: { data: { q: string } }) =>
			data.q === 'beta' ? beta.promise : Promise.resolve(searchResults(data.q)),
		)
		const { router } = await mountApp('/mail/search?q=alpha')
		expect(pageText()).toContain('Alpha result')

		const pending = await navigateUntilPending(
			() => router.navigate({ to: '/mail/search', search: { q: 'beta', folderId: 'sent' } }),
			'search-pending',
		)

		expect(within(pending).getByRole('heading', { level: 1 })).toHaveTextContent('Sent')
		expect(within(pending).getByTestId('thread-list-skeleton')).toBeInTheDocument()
		expect(pageText()).not.toContain('Alpha result')

		await act(async () => beta.resolve(searchResults('beta')))
		await waitFor(() => expect(pageText()).toContain('Beta result'))
		expect(pageText()).not.toContain('Alpha result')
	})

	it('keeps the rows of the same search while a selected result loads, at the same scroll offset', async () => {
		const opened = hold<unknown>()
		fns.getThreads.mockImplementation(async ({ data }: { data: { q: string } }) => searchResults(data.q))
		fns.getThreadMessages.mockReturnValue(opened.promise)
		const { router } = await mountApp('/mail/search?q=beta')
		const list = page().getByText('Beta follow-up').closest('.overflow-y-auto') as HTMLElement
		list.scrollTop = 64
		fireEvent.scroll(list)

		const pending = await navigateUntilPending(
			() => router.navigate({ to: '/mail/search', search: { q: 'beta', threadId: 'beta-2' } }),
			'search-pending',
		)

		// Same query and folder: the list identity has not changed, only the reader's.
		expect(within(pending).getByRole('heading', { name: 'Search results' })).toBeInTheDocument()
		expect(within(pending).getByText('Beta result')).toBeInTheDocument()
		const pendingList = within(pending).getByText('Beta result').closest('.overflow-y-auto') as HTMLElement
		expect(pendingList.scrollTop).toBe(64)
		expect(within(pending).getByTestId('thread-reader-pending')).toHaveTextContent('Beta follow-up')

		await act(async () => opened.resolve(detail('beta-2', 'Beta follow-up')))
		await waitFor(() => expect(page().queryByTestId('search-pending')).toBeNull())
		const loadedList = page().getAllByText('Beta result')[0]?.closest('.overflow-y-auto') as HTMLElement
		expect(loadedList.scrollTop).toBe(64)
	})

	it('falls back to a skeleton for a blank query or one the loader will reject', async () => {
		fns.getThreads.mockImplementation(async ({ data }: { data: { q: string } }) => searchResults(data.q))
		const { router } = await mountApp('/mail/search?q=beta')
		const folders = hold<unknown>()
		fns.getFolders.mockReturnValue(folders.promise)

		const blank = await navigateUntilPending(
			() => router.navigate({ to: '/mail/search', search: { q: ' ', threadId: 'beta-2' } }),
			'search-pending',
		)
		expect(within(blank).getByTestId('thread-list-skeleton')).toBeInTheDocument()
		expect(within(blank).queryByTestId('thread-reader-pending')).toBeNull()
		expect(pageText()).not.toContain('Beta result')

		const rejected = await navigateUntilPending(
			() => router.navigate({ to: '/mail/search', search: { q: 'x'.repeat(5000) } }),
			'search-pending',
		)
		expect(within(rejected).getByTestId('thread-list-skeleton')).toBeInTheDocument()
		expect(pageText()).not.toContain('Beta result')
		await act(async () => folders.resolve([]))
	})
})

describe('contact selection', () => {
	const ada = {
		id: 'c-ada',
		given_name: 'Ada',
		surname: 'Lovelace',
		notes: 'Ada-only note',
		emails: [{ email: 'ada@example.com' }],
	}
	const grace = {
		id: 'c-grace',
		given_name: 'Grace',
		surname: 'Hopper',
		notes: 'Grace-only note',
		emails: [{ email: 'grace@example.com' }],
	}

	beforeEach(() => {
		fns.getContacts.mockResolvedValue({ contacts: [ada, grace] })
	})

	it('shows the selected contact’s name over a skeleton, never the previous contact’s details or confirmation', async () => {
		const loadGrace = hold<unknown>()
		const loadUnlisted = hold<unknown>()
		fns.getContact.mockImplementation(({ data }: { data: { contactId: string } }) =>
			data.contactId === 'c-ada'
				? Promise.resolve(ada)
				: data.contactId === 'c-grace'
					? loadGrace.promise
					: loadUnlisted.promise,
		)
		const { router } = await mountApp('/contacts/c-ada')
		fireEvent.click(page().getByRole('button', { name: 'Delete' }))
		expect(page().getByRole('button', { name: 'Confirm delete' })).toBeInTheDocument()

		const pending = await navigateUntilPending(
			() => router.navigate({ to: '/contacts/$contactId', params: { contactId: 'c-grace' } }),
			'contact-pending',
		)

		// The list already highlights Grace; the pane beside it must not still be Ada.
		expect(within(pending).getByRole('heading', { level: 1 })).toHaveTextContent('Grace Hopper')
		expect(pageText()).not.toContain('Ada-only note')
		expect(page().queryByRole('button', { name: 'Confirm delete' })).toBeNull()

		await act(async () => loadGrace.resolve(grace))
		await waitFor(() => expect(pageText()).toContain('Grace-only note'))
		expect(page().queryByRole('button', { name: 'Confirm delete' })).toBeNull()

		// A contact that is not in the loaded list has no known name yet.
		const unlisted = await navigateUntilPending(
			() => router.navigate({ to: '/contacts/$contactId', params: { contactId: 'c-unlisted' } }),
			'contact-pending',
		)
		expect(within(unlisted).getByRole('heading', { level: 1 })).toHaveTextContent('Loading contact…')
		expect(pageText()).not.toContain('Grace-only note')
		await act(async () => loadUnlisted.resolve({ ...ada, id: 'c-unlisted' }))
	})

	it('does not carry a delete confirmation to another contact that loads without a pending view', async () => {
		fns.getContact.mockImplementation(async ({ data }: { data: { contactId: string } }) =>
			data.contactId === 'c-ada' ? ada : grace,
		)
		const { router } = await mountApp('/contacts/c-ada')
		await act(async () => {
			await router.preloadRoute({ to: '/contacts/$contactId', params: { contactId: 'c-grace' } })
		})
		fireEvent.click(page().getByRole('button', { name: 'Delete' }))

		await act(async () => router.navigate({ to: '/contacts/$contactId', params: { contactId: 'c-grace' } }))

		await waitFor(() => expect(pageText()).toContain('Grace-only note'))
		expect(page().queryByRole('button', { name: 'Confirm delete' })).toBeNull()
	})
})

describe('calendar date or view change', () => {
	const seconds = (iso: string) => Math.floor(new Date(iso).getTime() / 1000)
	const calendar = { id: 'primary', name: 'Ada calendar', is_primary: true }
	const event = (id: string, title: string, day: string) => ({
		id,
		calendar_id: 'primary',
		title,
		when: {
			object: 'timespan',
			start_time: seconds(`${day}T12:00:00`),
			end_time: seconds(`${day}T13:00:00`),
		},
	})
	const marchEvent = event('march-1', 'March standup', '2026-03-10')
	const juneEvent = event('june-1', 'June review', '2026-06-10')
	const inRange = (range: { start: number; end: number }, candidate: typeof marchEvent) =>
		candidate.when.start_time >= range.start && candidate.when.end_time <= range.end

	function serveEvents(june: Promise<unknown>) {
		calendarFns.getEvents.mockImplementation(({ data }: { data: { start: number; end: number } }) =>
			inRange(data, juneEvent)
				? june
				: Promise.resolve({
						calendar,
						calendars: [calendar],
						events: inRange(data, marchEvent) ? [marchEvent] : [],
					}),
		)
	}

	it('shows the destination range’s title over an empty grid, never the previous range’s events', async () => {
		const june = hold<unknown>()
		serveEvents(june.promise)
		const { router, queryClient } = await mountApp('/calendar/month?date=2026-03-02')
		expect(page().getByRole('heading', { level: 1 })).toHaveTextContent('March 2026')
		expect(pageText()).toContain('March standup')

		const pending = await navigateUntilPending(
			() =>
				router.navigate({ to: '/calendar/$view', params: { view: 'month' }, search: { date: '2026-06-01' } }),
			'calendar-pending',
		)

		expect(within(pending).getByRole('heading', { level: 1 })).toHaveTextContent('June 2026')
		expect(within(pending).getByRole('navigation', { name: 'Primary' })).toBeInTheDocument()
		expect(pageText()).not.toContain('March standup')
		expect(pageText()).not.toContain('March 2026')

		await act(async () => june.resolve({ calendar, calendars: [calendar], events: [juneEvent] }))
		await waitFor(() => expect(pageText()).toContain('June review'))
		expect(pageText()).not.toContain('March standup')

		// A view change is an identity change too. Before the mailbox is known
		// there is no rail to draw, only the destination's title.
		const week = hold<unknown>()
		calendarFns.getEvents.mockReturnValue(week.promise)
		queryClient.removeQueries({ queryKey: mailboxInfoQueryOptions().queryKey })
		const info = hold<unknown>()
		fns.getMailboxInfo.mockReturnValue(info.promise)
		const weekPending = await navigateUntilPending(
			() =>
				router.navigate({ to: '/calendar/$view', params: { view: 'day' }, search: { date: '2026-09-15' } }),
			'calendar-pending',
		)
		expect(within(weekPending).getByRole('heading', { level: 1 })).toHaveTextContent('September 2026')
		expect(within(weekPending).queryByRole('navigation', { name: 'Primary' })).toBeNull()
		expect(pageText()).not.toContain('June review')
		await act(async () => {
			info.resolve({ email: ADA, appName: 'OwnMail', accounts: accounts(ADA) })
			week.resolve({ calendar, calendars: [calendar], events: [] })
		})
	})

	it('does not show a failed new-event draft’s error on an existing event', async () => {
		serveEvents(new Promise(() => {}))
		calendarFns.createEvent.mockRejectedValue(new Error('offline'))
		await mountApp('/calendar/month?date=2026-03-02')
		// The create action is New event, at the top of the calendar sidebar.
		fireEvent.click(
			within(document.getElementById('calendar-sidebar') as HTMLElement).getByRole('button', {
				name: 'New event',
			}),
		)
		fireEvent.click(page().getByRole('button', { name: 'Save event' }))
		await waitFor(() => expect(pageText()).toContain('Could not save the event'))

		// The composer floats over the grid, so an existing event can be opened
		// while the draft is still up. Its dialog is a different event.
		fireEvent.click(page().getByText('March standup').closest('button') as HTMLElement)

		// On desktop the event opens in the details pane beside the grid.
		const pane = await waitFor(() => page().getByRole('complementary', { name: 'Event details' }))
		expect(pane).toHaveTextContent('March standup')
		expect(pane).not.toHaveTextContent('Could not save the event')

		// Editing it from the pane replaces the draft with that event's own editor.
		fireEvent.click(within(pane).getByRole('button', { name: /Edit/ }))
		const dialog = await waitFor(() => page().getByRole('dialog', { name: 'Event details' }))
		expect(dialog).toHaveTextContent('Save changes')
		expect(dialog).not.toHaveTextContent('Could not save the event')
	})
})

describe('thread switch', () => {
	it('shows the next conversation’s subject over a skeleton, never the previous conversation or its failed action', async () => {
		fns.getThreads.mockResolvedValue({
			threads: [thread('t-1', 'First subject'), thread('t-2', 'Second subject')],
		})
		const second = hold<unknown>()
		fns.getThreadMessages.mockImplementation(({ data }: { data: { threadId: string } }) =>
			data.threadId === 't-1' ? Promise.resolve(detail('t-1', 'First subject')) : second.promise,
		)
		fns.updateThreadState.mockRejectedValue(new Error('offline'))
		const { router } = await mountApp('/mail/f/inbox/t/t-1')
		const reader = page().getByTestId('thread-reader')
		fireEvent.click(within(reader).getByRole('button', { name: 'Star' }))
		await waitFor(() => expect(within(reader).getByRole('alert')).toHaveTextContent('Action failed'))
		// The failed star was rolled back in the cached thread the control reads.
		expect(within(reader).getByRole('button', { name: 'Star' })).toBeInTheDocument()

		const pending = await navigateUntilPending(
			() =>
				router.navigate({
					to: '/mail/f/$folderId/t/$threadId',
					params: { folderId: 'inbox', threadId: 't-2' },
				}),
			'thread-reader-pending',
		)

		expect(within(pending).getByRole('heading', { level: 1 })).toHaveTextContent('Second subject')
		expect(page().queryByTestId('thread-reader')).toBeNull()
		expect(pageText()).not.toContain('Action failed')
		// The list beside the reader is the same folder and stays.
		expect(pageText()).toContain('First subject')

		await act(async () =>
			second.resolve({
				...detail('t-2', 'Second subject'),
				thread: { ...thread('t-2', 'Second subject'), starred: true },
			}),
		)
		const nextReader = await waitFor(() => page().getByTestId('thread-reader'))
		expect(pageText()).not.toContain('Action failed')
		expect(within(nextReader).getByRole('button', { name: 'Unstar' })).toBeInTheDocument()
	})

	it('does not carry a failed action to a conversation that opens without a pending view', async () => {
		fns.getThreads.mockResolvedValue({
			threads: [thread('t-1', 'First subject'), thread('t-2', 'Second subject')],
		})
		fns.getThreadMessages.mockImplementation(async ({ data }: { data: { threadId: string } }) =>
			detail(data.threadId, data.threadId === 't-1' ? 'First subject' : 'Second subject'),
		)
		fns.updateThreadState.mockRejectedValue(new Error('offline'))
		const { router } = await mountApp('/mail/f/inbox/t/t-1')
		const target = {
			to: '/mail/f/$folderId/t/$threadId',
			params: { folderId: 'inbox', threadId: 't-2' },
		} as const
		await act(async () => {
			await router.preloadRoute(target)
		})
		fireEvent.click(within(page().getByTestId('thread-reader')).getByRole('button', { name: 'Star' }))
		await waitFor(() => expect(pageText()).toContain('Action failed'))
		await act(async () => router.navigate(target))

		await waitFor(() =>
			expect(
				within(page().getByTestId('thread-reader')).getByRole('heading', { level: 1 }),
			).toHaveTextContent('Second subject'),
		)
		expect(pageText()).not.toContain('Action failed')
	})

	it('opens the next conversation at its top, not at the previous conversation’s scroll offset', async () => {
		fns.getThreads.mockResolvedValue({
			threads: [thread('t-1', 'First subject'), thread('t-2', 'Second subject')],
		})
		fns.getThreadMessages.mockImplementation(async ({ data }: { data: { threadId: string } }) =>
			detail(data.threadId, data.threadId === 't-1' ? 'First subject' : 'Second subject'),
		)
		const { router } = await mountApp('/mail/f/inbox/t/t-1')
		const target = {
			to: '/mail/f/$folderId/t/$threadId',
			params: { folderId: 'inbox', threadId: 't-2' },
		} as const
		await act(async () => {
			await router.preloadRoute(target)
		})
		const firstReader = page().getByRole('region', { name: 'Thread conversation' })
		firstReader.scrollTop = 240
		fireEvent.scroll(firstReader)

		await act(async () => router.navigate(target))
		await waitFor(() =>
			expect(
				within(page().getByTestId('thread-reader')).getByRole('heading', { level: 1 }),
			).toHaveTextContent('Second subject'),
		)

		// The router carries a scrolled element's offset to whatever element
		// replaces it; a different conversation is not the same content.
		const nextReader = page().getByRole('region', { name: 'Thread conversation' })
		expect(nextReader).not.toBe(firstReader)
		expect(nextReader.scrollTop).toBe(0)
	})
})

describe('glass layer budget', () => {
	it('shows at most three glass surfaces in the Conversation view with a menu open, and the reply bar is not one', async () => {
		fns.getThreads.mockResolvedValue({ threads: [thread('inbox-1', 'Budget subject')] })
		fns.getThreadMessages.mockResolvedValue({
			...detail('inbox-1', 'Budget subject'),
			messages: [
				{ ...detail('inbox-1', 'Budget subject').messages[0], body: 'Plain first message' },
				{
					...detail('inbox-1', 'Budget subject').messages[0],
					id: 'inbox-1-reply',
					from: [{ name: 'Ada', email: ADA }],
					to: [{ email: 'sender@example.com' }],
					body: 'Plain reply',
				},
			],
		})
		fns.markThreadRead.mockResolvedValue({ ok: true })
		await mountApp('/mail/f/inbox/t/inbox-1')
		await waitFor(() => expect(page().getByTestId('thread-reader')).toBeInTheDocument())
		fireEvent.click(page().getByRole('button', { name: 'Conversation view' }))
		const replyBar = await waitFor(() => {
			const bar = document.querySelector<HTMLElement>('[data-slot="conversation-reply"]')
			expect(bar).not.toBeNull()
			return bar as HTMLElement
		})
		// The pinned reply bar stays solid: with both toolbars glass, a glass reply
		// bar would make a fourth surface as soon as any menu opens.
		expect(replyBar).toHaveClass('bg-background', 'sticky', 'bottom-0')
		expect(replyBar.className).not.toMatch(/glass-/)

		fireEvent.click(page().getByRole('button', { name: /^Reading pane:/ }))
		expect(page().getByRole('menu', { name: 'Reading pane' })).toHaveClass('glass-panel')

		const glass = [...document.querySelectorAll('.glass-bar, .glass-panel:not([data-glass="solid"])')]
		// List toolbar, reader toolbar and the open menu. The phone tab bar is hidden at this
		// width by CSS, and the rail's inbox menu stays closed inside its <details>.
		const visibleOnDesktop = glass.filter(
			(surface) => !surface.classList.contains('md:hidden') && !surface.closest('details:not([open])'),
		)
		expect(
			visibleOnDesktop.map((surface) => surface.getAttribute('data-slot') ?? surface.getAttribute('role')),
		).toEqual(['toolbar', 'menu', 'toolbar'])
		expect(visibleOnDesktop.length).toBeLessThanOrEqual(3)
	})
})

describe('warm history restoration', () => {
	it('restores the same interactive list and scroll position without awaiting server work', async () => {
		fns.getThreads.mockResolvedValue({ threads: [thread('inbox-1', 'Warm history subject')] })
		fns.getThreadMessages.mockResolvedValue(detail('inbox-1', 'Warm history subject'))
		const { router } = await mountApp('/mail/f/inbox')
		const list = document.querySelector('[data-mail-list]')
		const scroll = list?.querySelector('[data-slot="scroll-area-viewport"]') as HTMLElement
		scroll.scrollTop = 120
		await act(async () => {
			await router.navigate({
				to: '/mail/f/$folderId/t/$threadId',
				params: { folderId: 'inbox', threadId: 'inbox-1' },
			})
		})
		expect(page().getByTestId('thread-reader')).toBeInTheDocument()
		fns.getThreads.mockClear().mockReturnValue(new Promise(() => {}))
		fns.getFolders.mockClear().mockReturnValue(new Promise(() => {}))
		await act(async () => {
			router.history.back()
			await new Promise((resolve) => setTimeout(resolve, 30))
		})
		expect(document.querySelector('[data-mail-list]')).toBe(list)
		expect(list).not.toHaveClass('hidden')
		expect(scroll.scrollTop).toBe(120)
		expect(page().queryByTestId('thread-reader')).toBeNull()
		expect(fns.getThreads).not.toHaveBeenCalled()
		expect(fns.getFolders).not.toHaveBeenCalled()
		await act(async () => {
			fireEvent.click(page().getByRole('link', { name: /Open Warm history subject/ }))
		})
		expect(page().getByTestId('thread-reader')).toBeInTheDocument()
	})
})
