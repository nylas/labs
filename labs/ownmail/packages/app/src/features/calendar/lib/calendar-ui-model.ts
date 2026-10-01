import type { Calendar, Event } from '@nylas-labs/cli-kit/v3'
import type { CSSProperties } from 'react'
import type { EventTone } from '#shared/lib/color-tone'
import { eventTimes } from './calendar.js'

/** Token tone used when a calendar has no usable colour of its own. */
export function calendarTone(calendar: Pick<Calendar, 'id' | 'name'>, index = 0): EventTone {
	return namedCalendarTone(`${calendar.name ?? ''} ${calendar.id ?? ''}`) ?? fallbackTone(index)
}

function namedCalendarTone(value: string): EventTone | undefined {
	const normalized = value.toLowerCase()
	if (/work/.test(normalized)) return 'blue'
	if (/focus/.test(normalized)) return 'amber'
	if (/social/.test(normalized)) return 'rose'
	if (/personal|primary/.test(normalized)) return 'teal'
	return undefined
}

function fallbackTone(index: number): EventTone {
	/* v8 ignore next -- `index % 4` is always 0-3 and the tuple has four entries, so the indexed access is never undefined and the `?? 'blue'` fallback is unreachable -- @preserve */
	return (['blue', 'teal', 'amber', 'rose'] as const)[index % 4] ?? 'blue'
}

export type Oklch = { l: number; c: number; h: number }

/**
 * Converts a provider colour to OKLCH. The value is untrusted, so only an exact
 * `#rrggbb` string is accepted; anything else yields null and never reaches CSS.
 */
export function hexToOklch(hex: unknown): Oklch | null {
	if (typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex)) return null
	const [r, g, b] = [1, 3, 5].map((offset) => {
		const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
		return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
	}) as [number, number, number]
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
	const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
	const bAxis = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
	return {
		l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		c: Math.hypot(a, bAxis),
		h: ((Math.atan2(bAxis, a) * 180) / Math.PI + 360) % 360,
	}
}

/**
 * Lightness and chroma limits per theme. They bracket the named event tokens,
 * so any provider hue yields a tint that keeps foreground text readable and a
 * swatch that stays visible against the card.
 */
export const EVENT_COLOR_LIMITS = {
	light: { minL: 0.5, maxL: 0.62, maxC: 0.13 },
	dark: { minL: 0.68, maxL: 0.8, maxC: 0.12 },
} as const

/** A calendar's hue for each theme, as CSS colour values. */
export type EventColor = { light: string; dark: string }

function clampedColor(color: Oklch, limits: { minL: number; maxL: number; maxC: number }): string {
	const l = Math.min(Math.max(color.l, limits.minL), limits.maxL)
	const c = Math.min(color.c, limits.maxC)
	return `oklch(${l.toFixed(3)} ${c.toFixed(3)} ${color.h.toFixed(1)})`
}

function toneColor(tone: EventTone): EventColor {
	const token = `var(--event-${tone})`
	return { light: token, dark: token }
}

/**
 * The colour every event on a calendar is drawn in: the calendar's own hue,
 * clamped per theme, or a named event token when it has no valid colour.
 */
export function calendarColor(calendar: Pick<Calendar, 'id' | 'name' | 'hex_color'>, index = 0): EventColor {
	const color = hexToOklch(calendar.hex_color)
	if (!color) return toneColor(calendarTone(calendar, index))
	return {
		light: clampedColor(color, EVENT_COLOR_LIMITS.light),
		dark: clampedColor(color, EVENT_COLOR_LIMITS.dark),
	}
}

/** Colours keyed by calendar id; the fallback token follows the calendar's position, not the event's. */
export function calendarColors(
	calendars: readonly Pick<Calendar, 'id' | 'name' | 'hex_color'>[],
): Map<string, EventColor> {
	return new Map(calendars.map((calendar, index) => [calendar.id, calendarColor(calendar, index)]))
}

/** An event is always its calendar's colour; one on an unknown calendar uses the first event token. */
export function eventColor(
	event: Pick<Event, 'calendar_id'>,
	colors: ReadonlyMap<string, EventColor>,
): EventColor {
	return colors.get(event.calendar_id) ?? toneColor('blue')
}

/** Inline custom properties read by the `.event-color` class, which picks the value for the active theme. */
export function eventColorStyle(color: EventColor): CSSProperties {
	return { '--event-c-light': color.light, '--event-c-dark': color.dark } as CSSProperties
}

/** True when a participant or organizer address is the given mailbox, ignoring case and stray space. */
export function isSameEmail(candidate: unknown, email: string): boolean {
	const mailbox = email.trim().toLowerCase()
	return mailbox !== '' && typeof candidate === 'string' && candidate.trim().toLowerCase() === mailbox
}

/** How the signed-in user has answered an event. */
export type EventRsvp = 'accepted' | 'tentative' | 'awaiting' | 'declined'

/**
 * The signed-in user's answer, from their own participant entry. The organizer
 * and events the user is not invited to (their own) count as accepted.
 */
export function eventRsvp(event: Pick<Event, 'participants' | 'organizer'>, email: string): EventRsvp {
	if (isSameEmail(event.organizer?.email, email)) return 'accepted'
	const status = event.participants?.find((participant) => isSameEmail(participant.email, email))?.status
	if (status === 'no') return 'declined'
	if (status === 'maybe') return 'tentative'
	if (status === 'noreply') return 'awaiting'
	return 'accepted'
}

/** Words for an answer that is otherwise shown only by outline and strikethrough; null when accepted. */
export function eventRsvpLabel(rsvp: EventRsvp): string | null {
	if (rsvp === 'declined') return 'Declined'
	if (rsvp === 'tentative') return 'Tentative'
	if (rsvp === 'awaiting') return 'Not yet answered'
	return null
}

/** Accessible name for an event chip: title, when, and any answer that is not a plain acceptance. */
export function eventAccessibleName(title: string, when: string, rsvp: EventRsvp): string {
	return [title, when, eventRsvpLabel(rsvp)].filter(Boolean).join(', ')
}

export function eventHour(event: Event): { startHour: number; endHour: number; allDay: boolean } {
	const times = eventTimes(event)
	if (!times) return { startHour: 0, endHour: 0, allDay: false }
	return {
		startHour: times.start.getHours() + times.start.getMinutes() / 60,
		endHour: times.end.getHours() + times.end.getMinutes() / 60,
		allDay: times.allDay,
	}
}
