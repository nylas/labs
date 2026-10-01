// @vitest-environment jsdom
import { MutationObserver, QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const router = vi.hoisted(() => ({
	pathname: '/mail/f/inbox/t/thread-1',
	navigate: vi.fn(),
	invalidate: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
	useRouter: () => ({ navigate: router.navigate, invalidate: router.invalidate }),
	useRouterState: (options: { select: (state: { location: { pathname: string } }) => unknown }) =>
		options.select({ location: { pathname: router.pathname } }),
}))
vi.mock('#server/fns', () => ({
	deleteDraft: vi.fn(),
	getMailboxInfo: vi.fn(),
	saveDraft: vi.fn(),
	sendDraft: vi.fn(),
	updateThreadState: vi.fn(),
}))
vi.mock('#features/calendar/server/calendar-fns', () => ({
	createEvent: vi.fn(),
	deleteEvent: vi.fn(),
	getEvents: vi.fn(),
	rsvpEvent: vi.fn(),
	updateEvent: vi.fn(),
}))

import { mailMutationTestApi } from '#features/mail/state/mail-mutations'
import { mailKeys } from '#features/mail/state/mail-queries'
import { runTrackedWrite } from '#shared/lib/tracked-write'
import { AccountSwitchLoader } from '../components/AccountSwitchLoader.js'
import { mailboxInfoQueryOptions } from '../query/mailbox-info.js'
import { createOwnmailQueryClient } from '../query/query-provider.js'
import { accountScope, observeAccount, resetAccountScope } from './account-scope.js'
import {
	ACCOUNT_SWITCH_BLOCKED_MESSAGE,
	accountSwitchDestination,
	documentNavigation,
	requestAccountSwitch,
	useAccountSwitch,
} from './account-switch.js'
import { AccountSwitchInProgressError, setSwitchingTo } from './account-switch-status.js'

const ada = { email: 'ada@ownmail.com', handle: 'a'.repeat(43), active: true }
const grace = { email: 'grace@ownmail.com', handle: 'b'.repeat(43), active: false }

function Switcher({ holdMutation = false }: { holdMutation?: boolean }) {
	const { blocked, switching, onSubmit } = useAccountSwitch([ada, grace])
	const pending = useMutation({ mutationFn: () => new Promise(() => {}) })
	return (
		<>
			<form onSubmit={onSubmit} aria-label="grace">
				<input type="hidden" name="account" value={grace.handle} />
				<button type="submit">Switch to Grace</button>
			</form>
			<form onSubmit={onSubmit} aria-label="ada">
				<input type="hidden" name="account" value={ada.handle} />
				<button type="submit">Stay on Ada</button>
			</form>
			<form onSubmit={onSubmit} aria-label="unknown">
				<input type="hidden" name="account" value="forged-handle" />
				<button type="submit">Forged</button>
			</form>
			{holdMutation ? (
				<button type="button" onClick={() => pending.mutate()}>
					Start saving
				</button>
			) : null}
			<p data-testid="state">{`${blocked ? 'blocked' : 'ready'}:${switching ?? 'idle'}`}</p>
			{switching ? <AccountSwitchLoader email={switching} /> : null}
		</>
	)
}

function renderSwitcher(client: QueryClient, props: { holdMutation?: boolean } = {}) {
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	)
	return render(<Switcher {...props} />, { wrapper })
}

const fetchMock = vi.fn()

beforeEach(() => {
	vi.stubGlobal('fetch', fetchMock)
	router.navigate.mockResolvedValue(undefined)
	router.invalidate.mockResolvedValue(undefined)
})

afterEach(() => {
	cleanup()
	act(() => setSwitchingTo(null))
	resetAccountScope()
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
	fetchMock.mockReset()
	router.navigate.mockReset()
	router.invalidate.mockReset()
	router.pathname = '/mail/f/inbox/t/thread-1'
	document.body.innerHTML = ''
})

describe('accountSwitchDestination', () => {
	it('keeps people in their section without carrying over entity pages from the previous inbox', () => {
		expect(accountSwitchDestination('/mail/f/inbox/t/thread-1')).toBe('/')
		expect(accountSwitchDestination('/')).toBe('/')
		expect(accountSwitchDestination('/calendar/week')).toBe('/calendar/week')
		expect(accountSwitchDestination('/calendar/day/extra')).toBe('/calendar/day')
		expect(accountSwitchDestination('/calendar/not-a-view')).toBe('/calendar')
		expect(accountSwitchDestination('/calendar')).toBe('/calendar')
		expect(accountSwitchDestination('/contacts/contact-1')).toBe('/contacts')
		expect(accountSwitchDestination('/settings')).toBe('/settings')
		expect(accountSwitchDestination('/contactsfoo')).toBe('/')
	})
})

describe('requestAccountSwitch', () => {
	it('posts only the opaque handle to the hardened switch endpoint and asks for a no-redirect receipt', async () => {
		fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
		await expect(requestAccountSwitch(grace.handle)).resolves.toBe(true)
		expect(fetchMock).toHaveBeenCalledWith('/auth', {
			method: 'POST',
			credentials: 'same-origin',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: `account=${grace.handle}`,
		})
	})

	it('treats a refusal, a redirect, or a network error as not switched', async () => {
		fetchMock.mockResolvedValueOnce(new Response('Forbidden', { status: 403 }))
		await expect(requestAccountSwitch(grace.handle)).resolves.toBe(false)
		fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }))
		await expect(requestAccountSwitch(grace.handle)).resolves.toBe(false)
		fetchMock.mockRejectedValueOnce(new TypeError('offline'))
		await expect(requestAccountSwitch(grace.handle)).resolves.toBe(false)
	})
})

describe('useAccountSwitch', () => {
	it('switches in place: no document reload, previous inbox data gone, same section reloaded', async () => {
		router.pathname = '/calendar/week'
		const client = new QueryClient()
		observeAccount(ada.email)
		const adaFolders = mailKeys.folders()
		client.setQueryData(adaFolders, [{ id: 'inbox', name: 'Ada inbox' }])
		client.setQueryData(['calendar', ada.email, 'range', 1, 2], { events: [{ id: 'ada-event' }] })
		// A lingering optimistic journal from Ada's inbox must not replay later.
		const operation = await mailMutationTestApi
			.managerFor(client)
			.begin({ type: 'folders.reconciled', folders: [{ id: 'inbox', name: 'Ada inbox' }] as never })
		const assign = vi.spyOn(documentNavigation, 'assign').mockImplementation(() => {})
		let finishSwitch: (response: Response) => void = () => {}
		fetchMock.mockReturnValue(new Promise((resolve) => (finishSwitch = resolve)))
		const order: string[] = []
		router.navigate.mockImplementation(async (options) => {
			order.push(`navigate:${options.to}:${client.getQueryCache().getAll().length}`)
			// A mailbox request from before the cookie rotated answers late...
			observeAccount(ada.email)
			// ...and the destination's loader caches the inbox the session now points at.
			client.setQueryData(mailboxInfoQueryOptions().queryKey, { email: grace.email, appName: 'OwnMail' })
		})
		router.invalidate.mockImplementation(async () => order.push('invalidate'))

		renderSwitcher(client)
		fireEvent.click(screen.getByRole('button', { name: 'Switch to Grace' }))

		expect(await screen.findByRole('status')).toHaveTextContent('Switching to grace@ownmail.com…')
		expect(screen.getByTestId('state')).toHaveTextContent('ready:grace@ownmail.com')
		await act(async () => finishSwitch(new Response(null, { status: 204 })))

		await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('ready:idle'))
		expect(screen.queryByRole('status')).toBeNull()
		expect(order).toEqual(['navigate:/calendar/week:0', 'invalidate'])
		expect(client.getQueryData(adaFolders)).toBeUndefined()
		expect(operation.commit()).toBe(true)
		expect(client.getQueryData(adaFolders)).toBeUndefined()
		// Keys built from here on belong to Grace, whatever order responses arrived in.
		expect(accountScope()).toBe(grace.email)
		expect(mailKeys.folders()).not.toEqual(adaFolders)
		expect(assign).not.toHaveBeenCalled()
	})

	it('refuses to switch while a write is pending so its optimistic snapshot cannot cross inboxes', async () => {
		const client = new QueryClient()
		renderSwitcher(client, { holdMutation: true })
		fireEvent.click(screen.getByRole('button', { name: 'Start saving' }))
		await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('blocked:idle'))

		fireEvent.click(screen.getByRole('button', { name: 'Switch to Grace' }))

		expect(fetchMock).not.toHaveBeenCalled()
		expect(screen.getByTestId('state')).toHaveTextContent('blocked:idle')
		expect(ACCOUNT_SWITCH_BLOCKED_MESSAGE).toMatch(/before switching inboxes/)
	})

	it('ignores the current inbox, unknown handles, and repeat submissions while switching', async () => {
		const client = new QueryClient()
		fetchMock.mockReturnValue(new Promise(() => {}))
		renderSwitcher(client)

		fireEvent.click(screen.getByRole('button', { name: 'Stay on Ada' }))
		fireEvent.click(screen.getByRole('button', { name: 'Forged' }))
		expect(fetchMock).not.toHaveBeenCalled()

		fireEvent.click(screen.getByRole('button', { name: 'Switch to Grace' }))
		fireEvent.click(screen.getByRole('button', { name: 'Switch to Grace' }))
		await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
	})

	it('falls back to a native form post of the chosen handle when the in-app switch fails', async () => {
		const client = new QueryClient()
		client.setQueryData(mailKeys.folders(), [])
		fetchMock.mockResolvedValue(new Response('Forbidden', { status: 403 }))
		const submitted: FormData[] = []
		const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(function (
			this: HTMLFormElement,
		) {
			expect(this.getAttribute('action')).toBe('/auth')
			expect(this.method).toBe('post')
			submitted.push(new FormData(this))
		})

		renderSwitcher(client)
		fireEvent.click(screen.getByRole('button', { name: 'Switch to Grace' }))

		await waitFor(() => expect(submit).toHaveBeenCalledOnce())
		expect(submitted[0]?.getAll('account')).toEqual([grace.handle])
		// The page is leaving; the transition stays visible and nothing was cleared in place.
		expect(screen.getByRole('status')).toHaveTextContent('grace@ownmail.com')
		expect(client.getQueryData(mailKeys.folders())).toEqual([])
		expect(router.navigate).not.toHaveBeenCalled()
	})

	it('loads the destination as a document if in-app navigation fails after the session rotated', async () => {
		router.pathname = '/contacts/contact-1'
		fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
		router.navigate.mockRejectedValue(new Error('loader failed'))
		const assign = vi.spyOn(documentNavigation, 'assign').mockImplementation(() => {})

		renderSwitcher(new QueryClient())
		fireEvent.click(screen.getByRole('button', { name: 'Switch to Grace' }))

		await waitFor(() => expect(assign).toHaveBeenCalledWith('/contacts'))
		expect(screen.getByRole('status')).toHaveTextContent('grace@ownmail.com')
	})
})

describe('inbox-switch write lock', () => {
	it('refuses to switch when a tracked write starts in the same tick, before the blocked state renders', async () => {
		const client = createOwnmailQueryClient()
		renderSwitcher(client)
		const pending = Promise.withResolvers<void>()
		const write = runTrackedWrite(client, () => pending.promise)

		// Settings saves and dialog edits bypass feature mutation hooks; the lock
		// must still see them even though React has not re-rendered `blocked` yet.
		fireEvent.click(screen.getByRole('button', { name: 'Switch to Grace' }))

		expect(fetchMock).not.toHaveBeenCalled()
		pending.resolve()
		await write
	})

	it('rejects writes that start mid-switch, such as a compose autosave timer, before they reach the server', async () => {
		const client = createOwnmailQueryClient()
		let finishSwitch: (response: Response) => void = () => {}
		fetchMock.mockReturnValue(new Promise<Response>((resolve) => (finishSwitch = resolve)))
		renderSwitcher(client)
		fireEvent.click(screen.getByRole('button', { name: 'Switch to Grace' }))
		await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('ready:grace@ownmail.com'))

		// The cookie is rotating: an inbox A draft saved now could land in inbox B.
		const saveDraft = vi.fn(async () => 'saved')
		await expect(runTrackedWrite(client, saveDraft)).rejects.toBeInstanceOf(AccountSwitchInProgressError)
		const autosave = new MutationObserver(client, { mutationFn: saveDraft })
		await expect(autosave.mutate()).rejects.toBeInstanceOf(AccountSwitchInProgressError)
		expect(saveDraft).not.toHaveBeenCalled()

		await act(async () => finishSwitch(new Response(null, { status: 204 })))
		await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('ready:idle'))
		await expect(runTrackedWrite(client, saveDraft)).resolves.toBe('saved')
	})
})
