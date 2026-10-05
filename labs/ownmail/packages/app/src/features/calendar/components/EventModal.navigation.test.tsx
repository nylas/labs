// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
	createBrowserHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Link,
	Outlet,
	RouterProvider,
} from '@tanstack/react-router'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventModal } from './EventModal.js'

const { createEvent } = vi.hoisted(() => ({ createEvent: vi.fn() }))
vi.mock('#features/calendar/server/calendar-fns', () => ({
	createEvent,
	deleteEvent: vi.fn(),
	rsvpEvent: vi.fn(),
	updateEvent: vi.fn(),
}))
vi.mock('#server/fns', () => ({ searchContacts: vi.fn().mockResolvedValue([]) }))

beforeAll(() => {
	window.scrollTo = vi.fn()
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	)
	Element.prototype.scrollIntoView = vi.fn()
	Element.prototype.hasPointerCapture = vi.fn(() => false)
	Element.prototype.setPointerCapture = vi.fn()
	Element.prototype.releasePointerCapture = vi.fn()
})

let history: ReturnType<typeof createBrowserHistory>
beforeEach(() => {
	window.history.replaceState(null, '', '/calendar')
	createEvent.mockReset().mockResolvedValue({ eventId: 'created' })
})
afterEach(() => {
	cleanup()
	history?.destroy()
})

async function renderCalendar(editing = false) {
	const root = createRootRoute({
		component: () => (
			<>
				<Link to="/mail">Go to mail</Link>
				<Outlet />
			</>
		),
	})
	const calendar = createRoute({
		getParentRoute: () => root,
		path: '/calendar',
		component: () => (
			<EventModal
				event={
					editing
						? {
								id: 'e1',
								title: 'Meeting',
								calendar_id: 'cal1',
								when: { object: 'timespan', start_time: 1783515600, end_time: 1783519200 },
							}
						: null
				}
				startInEdit={editing}
				defaultStart={new Date(2026, 6, 8, 9)}
				calendarId="cal1"
				calendarName="Work"
				calendars={[]}
				onClose={vi.fn()}
			/>
		),
	})
	const mail = createRoute({
		getParentRoute: () => root,
		path: '/mail',
		component: () => <h1>Mail destination</h1>,
	})
	history = createBrowserHistory()
	const router = createRouter({ routeTree: root.addChildren([calendar, mail]), history })
	render(
		<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
			<RouterProvider router={router} />
		</QueryClientProvider>,
	)
	await screen.findByLabelText('Title')
	return router
}

describe('EventModal navigation protection', () => {
	it('allows navigation and reload without prompting for a pristine event', async () => {
		const user = userEvent.setup()
		await renderCalendar()
		const unload = new Event('beforeunload', { cancelable: true })
		window.dispatchEvent(unload)
		expect(unload.defaultPrevented).toBe(false)
		await user.click(screen.getByRole('link', { name: 'Go to mail' }))
		await screen.findByRole('heading', { name: 'Mail destination' })
	})

	it('keeps edited content on cancelled module navigation, then proceeds only on discard', async () => {
		const user = userEvent.setup()
		await renderCalendar()
		fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Keep meeting' } })
		await user.click(screen.getByRole('link', { name: 'Go to mail' }))
		await screen.findByRole('dialog', { name: 'Discard event changes?' })
		await user.click(screen.getByRole('button', { name: 'Keep editing' }))
		expect(screen.getByLabelText('Title')).toHaveValue('Keep meeting')
		expect(window.location.pathname).toBe('/calendar')
		await user.click(screen.getByRole('link', { name: 'Go to mail' }))
		await user.click(await screen.findByRole('button', { name: 'Discard changes' }))
		await screen.findByRole('heading', { name: 'Mail destination' })
	})

	it('requests the browser reload warning only while unsaved changes exist', async () => {
		await renderCalendar()
		fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Unsaved meeting' } })
		const unload = new Event('beforeunload', { cancelable: true })
		window.dispatchEvent(unload)
		expect(unload.defaultPrevented).toBe(true)
		fireEvent.change(screen.getByLabelText('Title'), { target: { value: '' } })
		const cleanUnload = new Event('beforeunload', { cancelable: true })
		window.dispatchEvent(cleanUnload)
		expect(cleanUnload.defaultPrevented).toBe(false)
	})

	it('intercepts browser Back and keeps the intended destination for explicit discard', async () => {
		const user = userEvent.setup()
		const router = await renderCalendar()
		await router.navigate({ to: '/mail' })
		await screen.findByRole('heading', { name: 'Mail destination' })
		await router.navigate({ to: '/calendar' })
		await screen.findByRole('heading', { name: 'New event' })
		fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Back protection' } })
		history.back()
		await screen.findByRole('dialog', { name: 'Discard event changes?' })
		await user.keyboard('{Escape}')
		await waitFor(() => expect(window.location.pathname).toBe('/calendar'))
		expect(screen.getByLabelText('Title')).toHaveValue('Back protection')
		history.back()
		await user.click(await screen.findByRole('button', { name: 'Discard changes' }))
		await screen.findByRole('heading', { name: 'Mail destination' })
	})
})

it('protects an existing event edit during navigation and releases its blocker after discard', async () => {
	const user = userEvent.setup()
	const router = await renderCalendar(true)
	fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Changed meeting' } })
	// Calling navigation directly also covers browser/command-driven transitions outside the modal.
	void router.navigate({ to: '/mail' })
	await screen.findByRole('dialog', { name: 'Discard event changes?' })
	await user.click(screen.getByRole('button', { name: 'Discard changes' }))
	await screen.findByRole('heading', { name: 'Mail destination' })
})

it('keeps the pending event save mounted when a route change is requested', async () => {
	const user = userEvent.setup()
	createEvent.mockImplementation(() => new Promise(() => {}))
	const router = await renderCalendar()
	await user.click(screen.getByRole('button', { name: 'Save event' }))
	void router.navigate({ to: '/mail' })
	await waitFor(() => expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled())
	expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled()
	expect(screen.queryByRole('dialog', { name: 'Discard event changes?' })).not.toBeInTheDocument()
	expect(window.location.pathname).toBe('/calendar')
})
