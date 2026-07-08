import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LOGIN_PATH } from '../components/route-paths.js'

// createServerFn is a chainable builder in @tanstack/react-start. The test stub keeps
// that shape but makes the resulting server fn directly invocable: calling it runs the
// real `.validator()` (so input normalization is exercised) then the `.handler()`.
vi.mock('@tanstack/react-start', () => ({
	createServerFn: () => {
		let validator: ((input: unknown) => unknown) | undefined
		const api = {
			validator(fn: (input: unknown) => unknown) {
				validator = fn
				return api
			},
			handler(fn: (ctx: { data: unknown }) => unknown) {
				return (opts?: { data?: unknown }) => {
					const data = validator ? validator(opts?.data) : opts?.data
					return fn({ data })
				}
			},
		}
		return api
	},
}))

vi.mock('@tanstack/react-start/server', () => ({
	getRequest: () => new Request('http://ownmail.local/'),
}))

// redirect() is thrown as a control-flow signal; model it as an error carrying the target.
vi.mock('@tanstack/react-router', () => ({
	redirect: (opts: { to: string }) => Object.assign(new Error('REDIRECT'), { to: opts.to }),
}))

const { mailboxFromRequest } = vi.hoisted(() => ({ mailboxFromRequest: vi.fn() }))
vi.mock('./nylas.js', () => ({
	mailboxFromRequest: (request: Request) => mailboxFromRequest(request),
}))

const { createEvent, deleteEvent, getEvents, rsvpEvent, updateEvent } = await import('./calendar-fns.js')

type CalStub = { id: string; is_primary: boolean; name: string }

function makeMailbox(calendars: CalStub[], overrides: Record<string, unknown> = {}) {
	return {
		listCalendars: vi.fn(async () => ({ data: calendars })),
		listEvents: vi.fn(async (query: { calendar_id: string }) => ({
			data: [{ id: `evt-${query.calendar_id}`, calendar_id: query.calendar_id }],
		})),
		createEvent: vi.fn(async () => ({ data: { id: 'evt-created' } })),
		updateEvent: vi.fn(async () => ({ data: {} })),
		deleteEvent: vi.fn(async () => undefined),
		sendRsvp: vi.fn(async () => ({ data: { ok: true } })),
		...overrides,
	}
}

function resolveMailbox(calendars: CalStub[], overrides: Record<string, unknown> = {}) {
	const mailbox = makeMailbox(calendars, overrides)
	mailboxFromRequest.mockResolvedValue({ mailbox, email: 'ada@ownmail.com' })
	return mailbox
}

const RANGE = { start: 1_800_000_000, end: 1_800_003_600 }
const CREATE = { title: 'Planning', startTime: 1_800_000_000, endTime: 1_800_003_600 }

describe('calendar server functions', () => {
	beforeEach(() => {
		mailboxFromRequest.mockReset()
	})

	it('aggregates events across every calendar and reports the primary calendar', async () => {
		const mailbox = resolveMailbox([
			{ id: 'work', is_primary: false, name: 'Work' },
			{ id: 'primary', is_primary: true, name: 'Personal' },
		])

		const result = await getEvents({ data: RANGE })

		expect(mailbox.listEvents).toHaveBeenCalledTimes(2)
		expect(result.calendar.id).toBe('primary')
		expect(result.events.map((event) => event.id)).toEqual(['evt-work', 'evt-primary'])
	})

	it('falls back to the first calendar when none is marked primary', async () => {
		resolveMailbox([
			{ id: 'work', is_primary: false, name: 'Work' },
			{ id: 'side', is_primary: false, name: 'Side' },
		])

		const result = await getEvents({ data: RANGE })

		expect(result.calendar.id).toBe('work')
	})

	it('fails when the account exposes no calendars', async () => {
		resolveMailbox([])

		await expect(getEvents({ data: RANGE })).rejects.toThrow('No calendar found on this account.')
	})

	it('redirects unauthenticated callers to the login page instead of leaking a grant', async () => {
		mailboxFromRequest.mockResolvedValue(null)

		await expect(getEvents({ data: RANGE })).rejects.toMatchObject({ to: LOGIN_PATH })
	})

	it('creates an event with every optional field on the addressed calendar', async () => {
		const mailbox = resolveMailbox([{ id: 'work', is_primary: true, name: 'Work' }])

		const result = await createEvent({
			data: {
				...CREATE,
				description: 'Deck review',
				location: 'Aurora room',
				participants: ['grace@vercel.com'],
				calendarId: 'work',
			},
		})

		expect(result).toEqual({ eventId: 'evt-created' })
		expect(mailbox.createEvent).toHaveBeenCalledWith(
			{
				title: 'Planning',
				description: 'Deck review',
				location: 'Aurora room',
				when: { start_time: 1_800_000_000, end_time: 1_800_003_600 },
				participants: [{ email: 'grace@vercel.com' }],
			},
			'work',
		)
	})

	it('creates a bare event on the primary calendar when no calendar or optional fields are given', async () => {
		const mailbox = resolveMailbox([{ id: 'primary', is_primary: true, name: 'Personal' }])

		await createEvent({ data: CREATE })

		expect(mailbox.createEvent).toHaveBeenCalledWith(
			{ title: 'Planning', when: { start_time: 1_800_000_000, end_time: 1_800_003_600 } },
			'primary',
		)
	})

	it('rejects a create request that names an unknown calendar', async () => {
		resolveMailbox([{ id: 'primary', is_primary: true, name: 'Personal' }])

		await expect(createEvent({ data: { ...CREATE, calendarId: 'ghost' } })).rejects.toThrow(
			'Calendar not found.',
		)
	})

	it('updates every mutable field when they are all supplied', async () => {
		const mailbox = resolveMailbox([{ id: 'primary', is_primary: true, name: 'Personal' }])

		const result = await updateEvent({
			data: {
				eventId: 'event#1',
				title: 'Renamed',
				description: 'New notes',
				location: 'HQ',
				startTime: 1_800_000_000,
				endTime: 1_800_003_600,
			},
		})

		expect(result).toEqual({ ok: true })
		expect(mailbox.updateEvent).toHaveBeenCalledWith(
			'event#1',
			{
				title: 'Renamed',
				description: 'New notes',
				location: 'HQ',
				when: { start_time: 1_800_000_000, end_time: 1_800_003_600 },
			},
			'primary',
		)
	})

	it('updates only the time window, leaving text fields untouched', async () => {
		const mailbox = resolveMailbox([{ id: 'primary', is_primary: true, name: 'Personal' }])

		await updateEvent({
			data: { eventId: 'event#1', startTime: 1_800_000_000, endTime: 1_800_003_600 },
		})

		expect(mailbox.updateEvent).toHaveBeenCalledWith(
			'event#1',
			{ when: { start_time: 1_800_000_000, end_time: 1_800_003_600 } },
			'primary',
		)
	})

	it('updates only text fields, omitting the time window entirely', async () => {
		const mailbox = resolveMailbox([{ id: 'primary', is_primary: true, name: 'Personal' }])

		await updateEvent({ data: { eventId: 'event#1', title: 'Renamed' } })

		expect(mailbox.updateEvent).toHaveBeenCalledWith('event#1', { title: 'Renamed' }, 'primary')
	})

	it('deletes an event on the addressed calendar', async () => {
		const mailbox = resolveMailbox([{ id: 'work', is_primary: true, name: 'Work' }])

		const result = await deleteEvent({ data: { eventId: 'event#1', calendarId: 'work' } })

		expect(result).toEqual({ ok: true })
		expect(mailbox.deleteEvent).toHaveBeenCalledWith('event#1', 'work')
	})

	it('sends an RSVP for an event', async () => {
		const mailbox = resolveMailbox([{ id: 'primary', is_primary: true, name: 'Personal' }])

		const result = await rsvpEvent({ data: { eventId: 'event#1', status: 'yes' } })

		expect(result).toEqual({ ok: true })
		expect(mailbox.sendRsvp).toHaveBeenCalledWith('event#1', 'primary', 'yes')
	})
})
