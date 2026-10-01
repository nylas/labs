import type { Calendar, Event } from '@nylas-labs/cli-kit/v3'
import { describe, expect, it } from 'vitest'
import { contrast, mixOklab, parseOklch, token } from '../../../../test/oklch.js'
import {
	calendarColor,
	calendarColors,
	EVENT_COLOR_LIMITS,
	eventAccessibleName,
	eventColor,
	eventColorStyle,
	eventRsvp,
	eventRsvpLabel,
	hexToOklch,
} from './calendar-ui-model.js'

const cal = (fields: Partial<Calendar>) => ({ id: 'c', name: 'Team', ...fields }) as Calendar

// Provider colours across the hue wheel, plus the extremes that are hardest to keep readable.
const PROVIDER_COLOURS = [
	'#000000',
	'#ffffff',
	'#808080',
	'#ff0000',
	'#00ff00',
	'#0000ff',
	'#ffff00',
	'#00ffff',
	'#ff00ff',
	'#039BE5',
	'#F6BF26',
	'#D50000',
	'#33B679',
	'#7986CB',
	'#3F51B5',
]

describe('provider colour parsing', () => {
	it('converts a six-digit hex to its OKLCH hue so a calendar keeps the colour its owner picked', () => {
		expect(hexToOklch('#ff0000')?.h).toBeCloseTo(29.2, 0)
		expect(hexToOklch('#00ff00')?.h).toBeCloseTo(142.5, 0)
		expect(hexToOklch('#0000ff')?.h).toBeCloseTo(264.1, 0)
		expect(hexToOklch('#ff0000')?.l).toBeCloseTo(0.628, 2)
		expect(hexToOklch('#ff0000')?.c).toBeCloseTo(0.258, 2)
		expect(hexToOklch('#FFFFFF')?.l).toBeCloseTo(1, 3)
		expect(hexToOklch('#ffffff')?.c).toBeCloseTo(0, 3)
		expect(hexToOklch('#000000')?.l).toBe(0)
	})

	it.each([
		['three-digit shorthand', '#fff'],
		['a missing hash', 'ff0000'],
		['eight digits', '#ff0000ff'],
		['non-hex digits', '#gg0000'],
		['a colour name', 'red'],
		['surrounding space', ' #ff0000 '],
		['a trailing newline', '#ff0000\n'],
		['a CSS injection attempt', '#ff0000;background:url(https://evil.example)'],
		['an empty string', ''],
		['undefined', undefined],
		['null', null],
		['a number', 0xff0000],
	])('rejects %s because the value comes from the provider and is written into a style', (_label, value) => {
		expect(hexToOklch(value)).toBeNull()
	})
})

describe('per-calendar event colour', () => {
	it('keeps the calendar hue in both themes while clamping lightness and chroma', () => {
		for (const hex of PROVIDER_COLOURS) {
			const source = hexToOklch(hex)
			const color = calendarColor(cal({ hex_color: hex }))
			for (const theme of ['light', 'dark'] as const) {
				const [l, c, h] = (/^oklch\((.+)\)$/.exec(color[theme])?.[1] ?? '').split(' ').map(Number)
				expect(h).toBeCloseTo(source?.h as number, 1)
				expect(l).toBeGreaterThanOrEqual(EVENT_COLOR_LIMITS[theme].minL)
				expect(l).toBeLessThanOrEqual(EVENT_COLOR_LIMITS[theme].maxL)
				expect(c).toBeLessThanOrEqual(EVENT_COLOR_LIMITS[theme].maxC)
			}
		}
	})

	it('keeps event text readable on the tinted fill for any provider colour, in both themes', () => {
		for (const hex of PROVIDER_COLOURS) {
			const color = calendarColor(cal({ hex_color: hex }))
			for (const theme of ['light', 'dark'] as const) {
				const card = parseOklch(token('--card', theme))
				const text = parseOklch(token('--foreground', theme))
				// styles.css: .event-chip fills with 30% of the hue over the card.
				const fill = mixOklab(parseOklch(color[theme]), card, 0.3)
				expect(contrast(text, fill), `${hex} ${theme} text on fill`).toBeGreaterThanOrEqual(4.5)
			}
		}
	})

	it('keeps the sidebar swatch and the dashed RSVP outline visible against the card (3:1)', () => {
		for (const hex of PROVIDER_COLOURS) {
			const color = calendarColor(cal({ hex_color: hex }))
			for (const theme of ['light', 'dark'] as const) {
				const card = parseOklch(token('--card', theme))
				expect(contrast(parseOklch(color[theme]), card), `${hex} ${theme}`).toBeGreaterThanOrEqual(3)
			}
		}
	})

	it('keeps the fallback event tokens readable under the same tinted fill', () => {
		for (const tone of ['blue', 'teal', 'amber', 'rose']) {
			for (const theme of ['light', 'dark'] as const) {
				const card = parseOklch(token('--card', theme))
				const text = parseOklch(token('--foreground', theme))
				const fill = mixOklab(parseOklch(token(`--event-${tone}`, theme)), card, 0.3)
				expect(contrast(text, fill), `${tone} ${theme}`).toBeGreaterThanOrEqual(4.5)
			}
		}
	})

	it('falls back to a named event token when the calendar has no colour or an invalid one', () => {
		expect(calendarColor(cal({ name: 'Social' }))).toEqual({
			light: 'var(--event-rose)',
			dark: 'var(--event-rose)',
		})
		const hostile = '#ff0000;background:url(https://evil.example)'
		const color = calendarColor(cal({ hex_color: hostile }), 2)
		expect(color).toEqual({ light: 'var(--event-amber)', dark: 'var(--event-amber)' })
		expect(JSON.stringify(color)).not.toContain('evil')
	})

	it('gives uncoloured calendars distinct tokens by their position in the list', () => {
		const colors = calendarColors(['a', 'b', 'c', 'd', 'e'].map((id) => cal({ id, name: id })))
		expect([...colors.values()].map((color) => color.light)).toEqual([
			'var(--event-blue)',
			'var(--event-teal)',
			'var(--event-amber)',
			'var(--event-rose)',
			'var(--event-blue)',
		])
	})

	it('colours an event by its calendar alone, whatever its title says', () => {
		const colors = calendarColors([cal({ id: 'personal', hex_color: '#14b8a6' })])
		const personal = colors.get('personal')
		// "Flight" and "rent" used to recolour an event; the calendar now always wins.
		for (const title of ['Flight to Lisbon', 'Pay rent', 'Roadmap review', undefined]) {
			expect(eventColor({ title, calendar_id: 'personal' } as Event, colors)).toBe(personal)
		}
	})

	it('uses the first event token for an event whose calendar is not in the list', () => {
		expect(eventColor({ calendar_id: 'gone' }, calendarColors([]))).toEqual({
			light: 'var(--event-blue)',
			dark: 'var(--event-blue)',
		})
	})

	it('hands both theme values to CSS so the stylesheet, not script, picks the active theme', () => {
		expect(eventColorStyle({ light: 'oklch(0.5 0.1 250.0)', dark: 'oklch(0.7 0.1 250.0)' })).toEqual({
			'--event-c-light': 'oklch(0.5 0.1 250.0)',
			'--event-c-dark': 'oklch(0.7 0.1 250.0)',
		})
	})
})

describe('RSVP state of the signed-in user', () => {
	const me = 'ada@ownmail.com'
	const invite = (status?: string, organizer = 'boss@ownmail.com') =>
		({
			organizer: { email: organizer },
			participants: [
				{ email: 'grace@ownmail.com', status: 'no' },
				{ email: 'Ada@OwnMail.com ', status },
			],
		}) as Pick<Event, 'participants' | 'organizer'>

	it('reads the answer from the user own participant entry, not from the first guest', () => {
		expect(eventRsvp(invite('yes'), me)).toBe('accepted')
		expect(eventRsvp(invite('maybe'), me)).toBe('tentative')
		expect(eventRsvp(invite('noreply'), me)).toBe('awaiting')
		expect(eventRsvp(invite('no'), me)).toBe('declined')
	})

	it('treats the organizer as attending even when their own entry is unanswered', () => {
		expect(eventRsvp(invite('noreply', 'ADA@ownmail.com'), me)).toBe('accepted')
	})

	it('treats events the user is not a guest of, or with no status, as accepted', () => {
		expect(eventRsvp({}, me)).toBe('accepted')
		expect(eventRsvp({ participants: [{ email: 'grace@ownmail.com', status: 'no' }] }, me)).toBe('accepted')
		expect(eventRsvp(invite(undefined), me)).toBe('accepted')
		expect(eventRsvp({ participants: [{ email: undefined as unknown as string, status: 'no' }] }, me)).toBe(
			'accepted',
		)
	})

	it('puts every non-accepted answer into words so it is distinguishable without colour', () => {
		expect(eventRsvpLabel('accepted')).toBeNull()
		expect(eventRsvpLabel('tentative')).toBe('Tentative')
		expect(eventRsvpLabel('awaiting')).toBe('Not yet answered')
		expect(eventRsvpLabel('declined')).toBe('Declined')
		const names = (['accepted', 'tentative', 'awaiting', 'declined'] as const).map((rsvp) =>
			eventAccessibleName('Sprint planning', '3 PM – 4 PM', { rsvp }),
		)
		expect(names).toEqual([
			'Sprint planning, 3 PM – 4 PM',
			'Sprint planning, 3 PM – 4 PM, Tentative',
			'Sprint planning, 3 PM – 4 PM, Not yet answered',
			'Sprint planning, 3 PM – 4 PM, Declined',
		])
		expect(new Set(names).size).toBe(4)
	})
})

describe('event states that the grid shows without words', () => {
	it('says an event has ended, because fading the chip is invisible to a screen reader', () => {
		const upcoming = eventAccessibleName('Standup', '9 AM – 10 AM', { rsvp: 'accepted', ended: false })
		const finished = eventAccessibleName('Standup', '9 AM – 10 AM', { rsvp: 'accepted', ended: true })
		expect(upcoming).toBe('Standup, 9 AM – 10 AM')
		expect(finished).toBe('Standup, 9 AM – 10 AM, Ended')
		expect(finished).not.toBe(upcoming)
	})

	it('appends the ended state the same way as the RSVP state, after it', () => {
		expect(eventAccessibleName('Sprint planning', '3 PM – 4 PM', { rsvp: 'declined', ended: true })).toBe(
			'Sprint planning, 3 PM – 4 PM, Declined, Ended',
		)
	})

	it('says when an all-day event runs beyond the visible days, which is otherwise only a cut-off edge', () => {
		const name = (continuesBefore: boolean, continuesAfter: boolean) =>
			eventAccessibleName('Vacation', 'All day', { rsvp: 'accepted', continuesBefore, continuesAfter })
		expect(name(false, false)).toBe('Vacation, All day')
		expect(name(true, false)).toBe('Vacation, All day, Started earlier')
		expect(name(false, true)).toBe('Vacation, All day, Continues later')
		expect(name(true, true)).toBe('Vacation, All day, Started earlier, Continues later')
	})

	it('gives every combination of visual state its own name', () => {
		const names = (['accepted', 'tentative', 'awaiting', 'declined'] as const).flatMap((rsvp) =>
			[false, true].flatMap((ended) =>
				[false, true].map((continuesAfter) =>
					eventAccessibleName('Offsite', 'All day', { rsvp, ended, continuesAfter }),
				),
			),
		)
		expect(new Set(names).size).toBe(names.length)
	})
})

describe('today tokens', () => {
	it.each(['light', 'dark'] as const)(
		'keeps the today pill text at 4.5:1 or better in the %s theme',
		(theme) => {
			const pill = parseOklch(token('--today', theme))
			const text = parseOklch(token('--today-fg', theme))
			expect(contrast(pill, text)).toBeGreaterThanOrEqual(4.5)
		},
	)
})
