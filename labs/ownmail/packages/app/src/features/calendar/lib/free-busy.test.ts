import { describe, expect, it } from 'vitest'
import { eventTimes } from './calendar.js'
import {
	busyBlockPersonIndex,
	busyBlocks,
	FREE_BUSY_FAILED_MESSAGE,
	FREE_BUSY_RATE_LIMITED_MESSAGE,
	freeBusyEmail,
	freeBusyPeople,
	isBusyBlock,
	MAX_FREE_BUSY_SLOTS,
	personColor,
	personLabel,
	personStatus,
} from './free-busy.js'

const range = { start: 1000, end: 9000 }

describe('addresses that may be looked up', () => {
	it('accepts an ordinary address and returns it trimmed and lowercased', () => {
		expect(freeBusyEmail('  Ada.Lovelace+cal@Example.CO.uk ')).toBe('ada.lovelace+cal@example.co.uk')
	})

	it('rejects anything outside the allow-list instead of passing it to the provider', () => {
		for (const value of [
			'',
			'ada',
			'ada@',
			'@example.com',
			'ada@example',
			'ada@-example.com',
			'ada@example-.com',
			'ada@exa mple.com',
			'ada@example.com, eve@example.com',
			'ada@example.com\nbcc: eve@example.com',
			'"ada"@example.com',
			'ada<script>@example.com',
			'ada@[127.0.0.1]',
			`${'a'.repeat(250)}@example.com`,
			42,
			null,
			undefined,
			['ada@example.com'],
		]) {
			expect(freeBusyEmail(value)).toBeNull()
		}
	})
})

describe('reducing a provider response to times', () => {
	it('free/busy results carry only start and end times, never event details', () => {
		const people = freeBusyPeople(
			['ada@example.com'],
			[
				{
					email: 'ada@example.com',
					object: 'free_busy',
					time_slots: [
						{
							start_time: 2000,
							end_time: 3000,
							status: 'busy',
							object: 'time_slot',
							// Not part of the API, but nothing beyond times may survive this boundary.
							title: 'Confidential board meeting',
							location: 'Room 4',
						},
					],
				},
			],
			range,
		)
		expect(people).toEqual([
			{ email: 'ada@example.com', busy: [{ start: 2000, end: 3000 }], unavailable: false },
		])
		expect(JSON.stringify(people)).not.toContain('Confidential')
	})

	it('answers only for the people asked about, in the order asked', () => {
		const people = freeBusyPeople(
			['bob@example.com', 'ada@example.com'],
			[
				{ email: 'Ada@Example.com', time_slots: [{ start_time: 2000, end_time: 3000 }] },
				{ email: 'mallory@example.com', time_slots: [{ start_time: 2000, end_time: 3000 }] },
				{ email: 'bob@example.com', time_slots: [] },
			],
			range,
		)
		expect(people.map((person) => person.email)).toEqual(['bob@example.com', 'ada@example.com'])
		expect(people[0]).toEqual({ email: 'bob@example.com', busy: [], unavailable: false })
		expect(people[1]?.busy).toEqual([{ start: 2000, end: 3000 }])
	})

	it('reports a person as unavailable without repeating the provider error text', () => {
		const people = freeBusyPeople(
			['nobody@example.com', 'missing@example.com'],
			[{ email: 'nobody@example.com', object: 'error', error: 'Unable to resolve nobody@example.com' }],
			range,
		)
		expect(people).toEqual([
			{ email: 'nobody@example.com', busy: [], unavailable: true },
			{ email: 'missing@example.com', busy: [], unavailable: true },
		])
		expect(JSON.stringify(people)).not.toContain('Unable to resolve')
	})

	it('treats a response that is not a list as nobody being available', () => {
		expect(freeBusyPeople(['ada@example.com'], undefined, range)).toEqual([
			{ email: 'ada@example.com', busy: [], unavailable: true },
		])
		expect(freeBusyPeople(['ada@example.com'], ['nonsense', null], range)[0]?.unavailable).toBe(true)
	})

	it('keeps only well-formed busy slots, clipped to the requested range and in order', () => {
		const [person] = freeBusyPeople(
			['ada@example.com'],
			[
				{
					email: 'ada@example.com',
					time_slots: [
						{ start_time: 8000, end_time: 12_000, status: 'busy' },
						{ start_time: 500, end_time: 1500 },
						{ start_time: 4000, end_time: 5000, status: 'free' },
						{ start_time: 3000, end_time: 2000 },
						{ start_time: '2000', end_time: 3000 },
						{ start_time: 2000, end_time: 2.5 },
						{ start_time: 20_000, end_time: 30_000 },
						'slot',
						null,
					],
				},
			],
			range,
		)
		expect(person?.busy).toEqual([
			{ start: 1000, end: 1500 },
			{ start: 8000, end: 9000 },
		])
	})

	it('caps the slots kept per person so an unexpected response cannot flood the grid', () => {
		const time_slots = Array.from({ length: MAX_FREE_BUSY_SLOTS + 50 }, (_, index) => ({
			start_time: 1000 + index * 2,
			end_time: 1001 + index * 2,
		}))
		const [person] = freeBusyPeople(['ada@example.com'], [{ email: 'ada@example.com', time_slots }], {
			start: 0,
			end: 100_000,
		})
		expect(person?.busy).toHaveLength(MAX_FREE_BUSY_SLOTS)
	})
})

describe('people on the grid', () => {
	const people = [{ email: 'ada@example.com', name: 'Ada Lovelace' }, { email: 'bob@example.com' }]

	it('names a person by their contact name, falling back to the address', () => {
		expect(personLabel(people[0] as (typeof people)[number])).toBe('Ada Lovelace')
		expect(personLabel({ email: 'bob@example.com', name: '  ' })).toBe('bob@example.com')
		expect(personLabel({ email: 'bob@example.com' })).toBe('bob@example.com')
	})

	it('turns busy periods into placeholder events that carry the name and times and nothing else', () => {
		const blocks = busyBlocks(people, [
			{ email: 'bob@example.com', busy: [{ start: 2000, end: 3000 }], unavailable: false },
			{ email: 'ada@example.com', busy: [{ start: 4000, end: 5000 }], unavailable: false },
		])
		expect(blocks).toEqual([
			{
				id: 'free-busy:0:4000',
				calendar_id: '',
				title: 'Ada Lovelace',
				when: { object: 'timespan', start_time: 4000, end_time: 5000 },
			},
			{
				id: 'free-busy:1:2000',
				calendar_id: '',
				title: 'bob@example.com',
				when: { object: 'timespan', start_time: 2000, end_time: 3000 },
			},
		])
		// The grid can place them like any timed event.
		expect(eventTimes(blocks[0])?.allDay).toBe(false)
	})

	it('draws nothing for someone whose availability has not arrived', () => {
		expect(busyBlocks(people, [])).toEqual([])
	})

	it('tells busy blocks apart from real events and finds whose they are', () => {
		expect(isBusyBlock({ id: 'free-busy:1:2000' })).toBe(true)
		expect(isBusyBlock({ id: 'event-1' })).toBe(false)
		expect(busyBlockPersonIndex({ id: 'free-busy:3:2000' })).toBe(3)
	})

	it('gives each person their own colour, reusing the palette only beyond its length', () => {
		const colors = [0, 1, 2, 3, 4].map((index) => personColor(index).light)
		expect(new Set(colors).size).toBe(5)
		expect(personColor(5)).toEqual(personColor(0))
	})

	it('states each person in words, so the legend never depends on colour', () => {
		expect(personStatus(undefined, true)).toBe('Checking availability…')
		expect(personStatus(undefined, false)).toBe('Availability not loaded')
		expect(personStatus({ email: 'a@b.co', busy: [], unavailable: true }, false)).toBe(
			'Availability not shared',
		)
		expect(personStatus({ email: 'a@b.co', busy: [], unavailable: false }, false)).toBe('No busy times')
		expect(personStatus({ email: 'a@b.co', busy: [{ start: 1, end: 2 }], unavailable: false }, false)).toBe(
			'1 busy time',
		)
		expect(
			personStatus(
				{
					email: 'a@b.co',
					busy: [
						{ start: 1, end: 2 },
						{ start: 3, end: 4 },
					],
					unavailable: false,
				},
				true,
			),
		).toBe('2 busy times')
	})

	it('keeps the failure messages generic: no address, provider or status code', () => {
		for (const message of [FREE_BUSY_FAILED_MESSAGE, FREE_BUSY_RATE_LIMITED_MESSAGE]) {
			expect(message).not.toMatch(/@|nylas|429|\d{3}/i)
		}
	})
})
