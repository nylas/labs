import type { Event } from '@nylas-labs/cli-kit/v3'
import type { EventColor } from './calendar-ui-model.js'
import { calendarColor } from './calendar-ui-model.js'

/** How many people one availability lookup may name. */
export const MAX_FREE_BUSY_PEOPLE = 5
/** The longest range one lookup may cover: a week plus a day on each side for the display time zone. */
export const MAX_FREE_BUSY_RANGE_SECONDS = 60 * 60 * 24 * 10
/** The most busy slots kept per person, so an unexpected response cannot flood the grid. */
export const MAX_FREE_BUSY_SLOTS = 500
const MAX_EMAIL_LENGTH = 254

/** Shown as-is to the person. Neither says which address or provider was involved. */
export const FREE_BUSY_FAILED_MESSAGE = 'Could not load availability. Try again shortly.'
export const FREE_BUSY_RATE_LIMITED_MESSAGE = 'Availability is temporarily rate limited. Try again shortly.'

/**
 * Lowercase letters, digits and a small set of punctuation, then a dotted
 * host name. An allow-list rather than "anything with an @", because the value
 * is sent to the provider.
 */
const EMAIL_ALLOW_LIST =
	/^[a-z0-9._%+-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/

/** The canonical (trimmed, lowercase) form of an address that may be looked up, or null. */
export function freeBusyEmail(value: unknown): string | null {
	if (typeof value !== 'string') return null
	const email = value.trim().toLowerCase()
	return email.length <= MAX_EMAIL_LENGTH && EMAIL_ALLOW_LIST.test(email) ? email : null
}

/** A busy period in Unix seconds. It carries times only. */
export type BusySlot = { start: number; end: number }

/** One person's availability: busy periods, or `unavailable` when the provider could not share them. */
export type FreeBusyPerson = { email: string; busy: BusySlot[]; unavailable: boolean }

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function busySlots(value: unknown[], range: BusySlot): BusySlot[] {
	const slots: BusySlot[] = []
	for (const slot of value) {
		if (!isRecord(slot)) continue
		const { start_time: start, end_time: end, status } = slot
		if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) continue
		// A slot with no status is a busy period; anything explicitly not busy is left out.
		if (status !== undefined && status !== 'busy') continue
		const clipped = {
			start: Math.max(start as number, range.start),
			end: Math.min(end as number, range.end),
		}
		if (clipped.end > clipped.start) slots.push(clipped)
		if (slots.length === MAX_FREE_BUSY_SLOTS) break
	}
	return slots.sort((a, b) => a.start - b.start)
}

/**
 * Reduces a provider free/busy response to times for exactly the people asked
 * about. Everything else in the response is dropped here: entries for other
 * addresses, provider error text, and any field that is not a start or an end.
 * A person with an error or no entry is reported as unavailable.
 */
export function freeBusyPeople(emails: readonly string[], data: unknown, range: BusySlot): FreeBusyPerson[] {
	const entries = Array.isArray(data) ? data.filter(isRecord) : []
	return emails.map((email) => {
		const entry = entries.find((candidate) => freeBusyEmail(candidate.email) === email)
		if (!entry || !Array.isArray(entry.time_slots)) return { email, busy: [], unavailable: true }
		return { email, busy: busySlots(entry.time_slots, range), unavailable: false }
	})
}

/** Someone whose availability is overlaid on the grid. */
export type MeetWithPerson = { email: string; name?: string }

/** The name shown in the legend and on busy blocks: the contact's name, or the address. */
export function personLabel(person: MeetWithPerson): string {
	return person.name?.trim() || person.email
}

/** One hue per slot in the list, so a person keeps their colour while others are added. */
const PERSON_HEX_COLORS = ['#7c3aed', '#0891b2', '#c2410c', '#be185d', '#4d7c0f'] as const

/** The swatch and block colour for the person at `index`, clamped for contrast like calendar colours. */
export function personColor(index: number): EventColor {
	const hex_color = PERSON_HEX_COLORS[index % PERSON_HEX_COLORS.length] as string
	return calendarColor({ id: `person-${index}`, name: '', hex_color })
}

const BUSY_BLOCK_ID_PREFIX = 'free-busy:'

/** True for the placeholder events that stand for a colleague's busy time. */
export function isBusyBlock(event: Pick<Event, 'id'>): boolean {
	return event.id.startsWith(BUSY_BLOCK_ID_PREFIX)
}

/** The index of the person a busy block belongs to. */
export function busyBlockPersonIndex(event: Pick<Event, 'id'>): number {
	return Number(event.id.split(':')[1])
}

/**
 * Busy periods as placeholder events, so the grid lays them out beside the
 * person's own events instead of drawing over them. Each carries the person's
 * name and nothing else.
 */
export function busyBlocks(people: readonly MeetWithPerson[], results: readonly FreeBusyPerson[]): Event[] {
	return people.flatMap((person, index) => {
		const result = results.find((candidate) => candidate.email === person.email)
		return (result?.busy ?? []).map(
			(slot): Event => ({
				id: `${BUSY_BLOCK_ID_PREFIX}${index}:${slot.start}`,
				calendar_id: '',
				title: personLabel(person),
				when: { object: 'timespan', start_time: slot.start, end_time: slot.end },
			}),
		)
	})
}

/** What the legend says about one person, in words. */
export function personStatus(result: FreeBusyPerson | undefined, loading: boolean): string {
	if (!result) return loading ? 'Checking availability…' : 'Availability not loaded'
	if (result.unavailable) return 'Availability not shared'
	if (result.busy.length === 0) return 'No busy times'
	return result.busy.length === 1 ? '1 busy time' : `${result.busy.length} busy times`
}
