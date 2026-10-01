import { type Event, NylasApiError } from '@nylas-labs/cli-kit/v3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LOGIN_PATH } from '#app/config/route-paths'

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

const { setResponseHeader } = vi.hoisted(() => ({ setResponseHeader: vi.fn() }))
vi.mock('@tanstack/react-start/server', () => ({
	getRequest: () => new Request('http://ownmail.local/'),
	setResponseHeader: (name: string, value: string) => setResponseHeader(name, value),
}))

// redirect() is thrown as a control-flow signal; model it as an error carrying the target.
vi.mock('@tanstack/react-router', () => ({
	redirect: (opts: { to: string }) => Object.assign(new Error('REDIRECT'), { to: opts.to }),
}))

const { mailboxFromRequest } = vi.hoisted(() => ({ mailboxFromRequest: vi.fn() }))
vi.mock('#server/nylas', () => ({
	mailboxFromRequest: (request: Request) => mailboxFromRequest(request),
}))

const { platform } = vi.hoisted(() => ({ platform: vi.fn() }))
vi.mock('#server/platform', () => ({ platform: () => platform() }))

const {
	MAX_CALENDAR_PAGES,
	MAX_EVENT_PAGES_PER_CALENDAR,
	createCalendar,
	createEvent,
	deleteCalendar,
	deleteEvent,
	getEvents,
	rsvpEvent,
	updateCalendar,
	updateEvent,
} = await import('./calendar-fns.js')

type CalStub = { id: string; is_primary: boolean; name: string }

function makeMailbox(calendars: CalStub[], overrides: Record<string, unknown> = {}) {
	return {
		listCalendars: vi.fn(async () => ({ data: calendars })),
		listEvents: vi.fn(async (query: { calendar_id: string }) => ({
			data: [
				{
					id: `evt-${query.calendar_id}`,
					calendar_id: query.calendar_id,
					when: { start_time: 1_800_000_000, end_time: 1_800_003_600 },
				},
			],
		})),
		createEvent: vi.fn(async () => ({ data: { id: 'evt-created' } })),
		createCalendar: vi.fn(async (body: { name: string }) => ({ data: { id: 'cal-created', ...body } })),
		updateCalendar: vi.fn(async (calendarId: string, body: { name: string }) => ({
			data: { id: calendarId, ...body },
		})),
		deleteCalendar: vi.fn(async () => undefined),
		updateEvent: vi.fn(async (eventId: string) => ({ data: { id: eventId } })),
		deleteEvent: vi.fn(async () => undefined),
		sendRsvp: vi.fn(async () => ({ data: { ok: true } })),
		...overrides,
	}
}

function resolveMailbox(calendars: CalStub[], overrides: Record<string, unknown> = {}) {
	const mailbox = makeMailbox(calendars, overrides)
	mailboxFromRequest.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-123' })
	return mailbox
}

const RANGE = { start: 1_800_000_000, end: 1_800_003_600 }
const CREATE = { title: 'Planning', startTime: 1_800_000_000, endTime: 1_800_003_600 }

describe('calendar server functions', () => {
	beforeEach(() => {
		mailboxFromRequest.mockReset()
		platform.mockReset().mockResolvedValue({ kv: null })
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

	const pagedEvent = (calendarId: string, page: number) => ({
		id: `evt-${calendarId}-${page}`,
		calendar_id: calendarId,
		when: { start_time: 1_800_000_000, end_time: 1_800_003_600 },
	})

	it('follows event page tokens until the range is complete, so a busy calendar is not cut at one page', async () => {
		const mailbox = resolveMailbox([{ id: 'primary', is_primary: true, name: 'Personal' }], {
			listEvents: vi.fn(async (query: { calendar_id: string; page_token?: string }) => {
				const page = query.page_token ? Number(query.page_token) : 0
				return {
					data: [pagedEvent(query.calendar_id, page)],
					...(page < 2 ? { next_cursor: String(page + 1) } : {}),
				}
			}),
		})

		const result = await getEvents({ data: RANGE })

		expect(mailbox.listEvents).toHaveBeenCalledTimes(3)
		expect(mailbox.listEvents.mock.calls.map(([query]) => query.page_token)).toEqual([undefined, '1', '2'])
		// Every page repeats the range and calendar: a token alone must not widen the query.
		expect(mailbox.listEvents).toHaveBeenLastCalledWith({
			calendar_id: 'primary',
			start: RANGE.start,
			end: RANGE.end,
			limit: 200,
			expand_recurring: true,
			page_token: '2',
		})
		expect(result.events.map((event) => event.id)).toEqual([
			'evt-primary-0',
			'evt-primary-1',
			'evt-primary-2',
		])
		expect(result.truncated).toBe(false)
	})

	it('follows calendar page tokens so an account with many calendars shows all of them', async () => {
		const mailbox = resolveMailbox([], {
			listCalendars: vi.fn(async (query: { page_token?: string }) =>
				query.page_token
					? { data: [{ id: 'late', is_primary: false, name: 'Late' }], next_cursor: '' }
					: { data: [{ id: 'primary', is_primary: true, name: 'Personal' }], next_cursor: 'page-2' },
			),
		})

		const result = await getEvents({ data: RANGE })

		expect(mailbox.listCalendars.mock.calls.map(([query]) => query.page_token)).toEqual([undefined, 'page-2'])
		expect(result.calendars.map((calendar) => calendar.id)).toEqual(['primary', 'late'])
		expect(result.events.map((event) => event.id)).toEqual(['evt-primary', 'evt-late'])
		expect(result.truncated).toBe(false)
	})

	it('stops at the event page ceiling and reports it instead of dropping events silently', async () => {
		const mailbox = resolveMailbox(
			[
				{ id: 'endless', is_primary: true, name: 'Endless' },
				{ id: 'small', is_primary: false, name: 'Small' },
			],
			{
				listEvents: vi.fn(async (query: { calendar_id: string; page_token?: string }) =>
					query.calendar_id === 'endless'
						? { data: [pagedEvent('endless', Number(query.page_token ?? 0))], next_cursor: 'again' }
						: { data: [pagedEvent('small', 0)] },
				),
			},
		)

		const result = await getEvents({ data: RANGE })

		const endlessCalls = mailbox.listEvents.mock.calls.filter(([query]) => query.calendar_id === 'endless')
		expect(endlessCalls).toHaveLength(MAX_EVENT_PAGES_PER_CALENDAR)
		// What was loaded is still shown; the flag tells the grid it is incomplete.
		expect(result.events).toHaveLength(MAX_EVENT_PAGES_PER_CALENDAR + 1)
		expect(result.truncated).toBe(true)
	})

	it('stops at the calendar page ceiling and reports it', async () => {
		let page = 0
		const mailbox = resolveMailbox([], {
			listCalendars: vi.fn(async () => {
				page += 1
				return {
					data: [{ id: `cal-${page}`, is_primary: page === 1, name: `Cal ${page}` }],
					next_cursor: 'more',
				}
			}),
		})

		const result = await getEvents({ data: RANGE })

		expect(mailbox.listCalendars).toHaveBeenCalledTimes(MAX_CALENDAR_PAGES)
		expect(result.calendars).toHaveLength(MAX_CALENDAR_PAGES)
		expect(result.truncated).toBe(true)
	})

	it('does not fetch events for calendars the user has hidden, but still lists those calendars', async () => {
		const mailbox = resolveMailbox([
			{ id: 'work', is_primary: false, name: 'Work' },
			{ id: 'primary', is_primary: true, name: 'Personal' },
			{ id: 'holidays', is_primary: false, name: 'Holidays' },
		])

		const result = await getEvents({ data: { ...RANGE, hiddenCalendarIds: ['work', 'holidays'] } })

		expect(mailbox.listEvents).toHaveBeenCalledTimes(1)
		expect(mailbox.listEvents).toHaveBeenCalledWith(expect.objectContaining({ calendar_id: 'primary' }))
		expect(result.events.map((event) => event.id)).toEqual(['evt-primary'])
		// The sidebar still needs every calendar so a hidden one can be shown again.
		expect(result.calendars.map((calendar) => calendar.id)).toEqual(['work', 'primary', 'holidays'])
		expect(result.truncated).toBe(false)
	})

	it('uses hidden ids only to narrow the grant own calendars, never as something to fetch', async () => {
		const mailbox = resolveMailbox([{ id: 'primary', is_primary: true, name: 'Personal' }])

		const result = await getEvents({ data: { ...RANGE, hiddenCalendarIds: ['someone-elses-calendar'] } })

		expect(mailbox.listEvents).toHaveBeenCalledTimes(1)
		expect(mailbox.listEvents).toHaveBeenCalledWith(expect.objectContaining({ calendar_id: 'primary' }))
		expect(result.events.map((event) => event.id)).toEqual(['evt-primary'])
	})

	it('authorizes a write against a calendar that is only on a later page of the calendar list', async () => {
		const mailbox = resolveMailbox([], {
			listCalendars: vi.fn(async (query: { page_token?: string }) =>
				query.page_token
					? { data: [{ id: 'late', is_primary: false, name: 'Late' }] }
					: { data: [{ id: 'primary', is_primary: true, name: 'Personal' }], next_cursor: 'page-2' },
			),
		})

		await createEvent({ data: { ...CREATE, calendarId: 'late' } })

		expect(mailbox.createEvent).toHaveBeenCalledWith(expect.objectContaining({ title: 'Planning' }), 'late')
	})

	it('drops malformed live event records without dropping valid events from another calendar', async () => {
		const mailbox = resolveMailbox(
			[
				{ id: 'work', is_primary: false, name: 'Work' },
				{ id: 'primary', is_primary: true, name: 'Personal' },
			],
			{
				listEvents: vi.fn(async (query: { calendar_id: string }) => ({
					data: [
						query.calendar_id === 'work'
							? {
									id: 'valid-work',
									calendar_id: 'work',
									when: { start_time: 1_800_000_000, end_time: 1_800_003_600 },
								}
							: { id: 'valid-primary', calendar_id: 'primary', when: { date: '2027-01-01' } },
						null,
						{ id: 'null-when', calendar_id: query.calendar_id, when: null },
						{ id: 'bad-span', calendar_id: query.calendar_id, when: { start_time: 10, end_time: 10 } },
						{ id: 'bad-date', calendar_id: query.calendar_id, when: { date: '2027-02-30' } },
					] as unknown as Event[],
				})),
			},
		)

		const result = await getEvents({ data: RANGE })

		expect(mailbox.listEvents).toHaveBeenCalledTimes(2)
		expect(result.events.map((event) => event.id)).toEqual(['valid-work', 'valid-primary'])
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

	it('treats a malformed calendar list as empty instead of crashing the calendar view', async () => {
		resolveMailbox([], { listCalendars: vi.fn(async () => ({ data: undefined })) })

		await expect(getEvents({ data: RANGE })).rejects.toThrow('No calendar found on this account.')
	})

	it.each([
		[new NylasApiError('expired', 401), 'Your mailbox session expired. Sign in again and retry.'],
		[new NylasApiError('forbidden', 403), 'Your mailbox session expired. Sign in again and retry.'],
		[new NylasApiError('limited', 429), 'Your mailbox is temporarily rate limited. Try again shortly.'],
		[
			new Error('offline'),
			'Something went wrong talking to your calendar. Check your connection and try again.',
		],
	])('maps calendar-list failures to a safe recovery message', async (error, message) => {
		resolveMailbox([], { listCalendars: vi.fn().mockRejectedValue(error) })

		await expect(getEvents({ data: RANGE })).rejects.toThrow(message)
	})

	it('maps event-list failures to a safe recovery message', async () => {
		resolveMailbox([{ id: 'primary', is_primary: true, name: 'Personal' }], {
			listEvents: vi.fn().mockRejectedValue(new Error('offline')),
		})

		await expect(getEvents({ data: RANGE })).rejects.toThrow(
			'Something went wrong talking to your calendar. Check your connection and try again.',
		)
	})

	it('redirects unauthenticated callers to the login page instead of leaking a grant', async () => {
		mailboxFromRequest.mockResolvedValue(null)

		await expect(getEvents({ data: RANGE })).rejects.toMatchObject({ to: LOGIN_PATH })
	})

	it('creates, renames, and deletes writable non-primary calendars', async () => {
		const mailbox = resolveMailbox([
			{ id: 'primary', is_primary: true, name: 'Personal' },
			{ id: 'work', is_primary: false, name: 'Work' },
		])

		expect(await createCalendar({ data: { name: ' Projects ' } })).toEqual({
			calendar: { id: 'cal-created', name: 'Projects' },
		})
		expect(await updateCalendar({ data: { calendarId: 'work', name: ' Roadmap ' } })).toEqual({
			calendar: { id: 'work', name: 'Roadmap' },
		})
		expect(await deleteCalendar({ data: { calendarId: 'work' } })).toEqual({
			removedCalendarId: 'work',
		})
		expect(mailbox.createCalendar).toHaveBeenCalledWith({ name: 'Projects' })
		expect(mailbox.updateCalendar).toHaveBeenCalledWith('work', { name: 'Roadmap' })
		expect(mailbox.deleteCalendar).toHaveBeenCalledWith('work')
	})

	it('fails closed for missing, read-only, and primary calendar management targets', async () => {
		const mailbox = resolveMailbox([
			{ id: 'primary', is_primary: true, name: 'Personal' },
			{ id: 'shared', is_primary: false, name: 'Shared', read_only: true },
		] as never)

		await expect(updateCalendar({ data: { calendarId: 'missing', name: 'Nope' } })).rejects.toThrow(
			'This calendar cannot be changed.',
		)
		await expect(updateCalendar({ data: { calendarId: 'shared', name: 'Nope' } })).rejects.toThrow(
			'This calendar cannot be changed.',
		)
		await expect(deleteCalendar({ data: { calendarId: 'primary' } })).rejects.toThrow(
			'This calendar cannot be changed.',
		)
		expect(mailbox.updateCalendar).not.toHaveBeenCalled()
		expect(mailbox.deleteCalendar).not.toHaveBeenCalled()
	})

	it('maps each calendar management provider failure to a generic safe error', async () => {
		resolveMailbox([{ id: 'work', is_primary: false, name: 'Work' }], {
			createCalendar: vi.fn().mockRejectedValue(new Error('provider detail')),
		})
		await expect(createCalendar({ data: { name: 'Projects' } })).rejects.toThrow(
			'Something went wrong talking to your calendar.',
		)

		resolveMailbox([{ id: 'work', is_primary: false, name: 'Work' }], {
			updateCalendar: vi.fn().mockRejectedValue(new Error('provider detail')),
		})
		await expect(updateCalendar({ data: { calendarId: 'work', name: 'Projects' } })).rejects.toThrow(
			'Something went wrong talking to your calendar.',
		)

		resolveMailbox([{ id: 'work', is_primary: false, name: 'Work' }], {
			deleteCalendar: vi.fn().mockRejectedValue(new Error('provider detail')),
		})
		await expect(deleteCalendar({ data: { calendarId: 'work' } })).rejects.toThrow(
			'Something went wrong talking to your calendar.',
		)
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

		expect(result).toEqual({ eventId: 'evt-created', event: { id: 'evt-created' } })
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

	it('creates an all-day event with Nylas date-only payload semantics', async () => {
		const mailbox = resolveMailbox([{ id: 'primary', is_primary: true, name: 'Personal' }])

		await createEvent({ data: { title: 'Holiday', allDayDate: '2027-12-25' } })

		expect(mailbox.createEvent).toHaveBeenCalledWith(
			{ title: 'Holiday', when: { date: '2027-12-25' } },
			'primary',
		)
	})

	it.each([
		[
			{ frequency: 'weekly' as const, interval: 2 as const, weekdays: ['MO', 'FR'] as const },
			['RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR'],
		],
		[{ frequency: 'yearly' as const, interval: 1 as const }, ['RRULE:FREQ=YEARLY']],
	])('creates recurring events with timezone-aware Nylas payloads', async (recurrence, expectedRule) => {
		const mailbox = resolveMailbox([{ id: 'primary', is_primary: true, name: 'Personal' }])

		await createEvent({
			data: {
				...CREATE,
				timezone: 'America/Toronto',
				recurrence,
			},
		})

		expect(mailbox.createEvent).toHaveBeenCalledWith(
			{
				title: 'Planning',
				when: {
					start_time: 1_800_000_000,
					end_time: 1_800_003_600,
					start_timezone: 'America/Toronto',
					end_timezone: 'America/Toronto',
				},
				recurrence: expectedRule,
			},
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

		expect(result).toEqual({ event: { id: 'event#1' } })
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

		expect(result).toEqual({ removedEventId: 'event#1', calendarId: 'work' })
		expect(mailbox.deleteEvent).toHaveBeenCalledWith('event#1', 'work')
	})

	it('sends an RSVP for an event', async () => {
		const mailbox = resolveMailbox([{ id: 'primary', is_primary: true, name: 'Personal' }])

		const result = await rsvpEvent({ data: { eventId: 'event#1', status: 'yes' } })

		expect(result).toEqual({
			eventId: 'event#1',
			calendarId: 'primary',
			status: 'yes',
		})
		expect(mailbox.sendRsvp).toHaveBeenCalledWith('event#1', 'primary', 'yes')
	})

	it('keeps provider failures generic for update, delete, and RSVP mutations', async () => {
		const failure = new Error('sensitive provider detail')
		resolveMailbox([{ id: 'primary', is_primary: true, name: 'Personal' }], {
			updateEvent: vi.fn().mockRejectedValue(failure),
			deleteEvent: vi.fn().mockRejectedValue(failure),
			sendRsvp: vi.fn().mockRejectedValue(failure),
		})
		const message = 'Something went wrong talking to your calendar. Check your connection and try again.'

		await expect(updateEvent({ data: { eventId: 'event#1', title: 'Private' } })).rejects.toThrow(message)
		await expect(deleteEvent({ data: { eventId: 'event#1' } })).rejects.toThrow(message)
		await expect(rsvpEvent({ data: { eventId: 'event#1', status: 'yes' } })).rejects.toThrow(message)
	})

	it('keeps provider failures generic when creating an event', async () => {
		resolveMailbox([{ id: 'primary', is_primary: true, name: 'Personal' }], {
			createEvent: vi.fn().mockRejectedValue(new Error('sensitive provider detail')),
		})
		await expect(createEvent({ data: CREATE })).rejects.toThrow(
			'Something went wrong talking to your calendar. Check your connection and try again.',
		)
	})
})
