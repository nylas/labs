import type { Calendar, Event } from '@nylas-labs/cli-kit/v3'
import type { EventTone } from '#shared/lib/color-tone'
import { eventTimes } from './calendar.js'

const TONE_RGB: Record<EventTone, [number, number, number]> = {
	blue: [37, 99, 235],
	teal: [20, 184, 166],
	amber: [245, 158, 11],
	rose: [244, 63, 94],
}

export function toneFromHex(hex?: string): EventTone | undefined {
	const rgb = parseHexColor(hex)
	if (!rgb) return undefined
	let closest: EventTone = 'blue'
	let closestDistance = Number.POSITIVE_INFINITY
	for (const tone of Object.keys(TONE_RGB) as EventTone[]) {
		const color = TONE_RGB[tone]
		const distance = (rgb[0] - color[0]) ** 2 + (rgb[1] - color[1]) ** 2 + (rgb[2] - color[2]) ** 2
		if (distance < closestDistance) {
			closest = tone
			closestDistance = distance
		}
	}
	return closest
}

export function calendarTone(calendar: Pick<Calendar, 'id' | 'name' | 'hex_color'>, index = 0): EventTone {
	return (
		toneFromHex(calendar.hex_color) ??
		namedCalendarTone(`${calendar.name ?? ''} ${calendar.id ?? ''}`) ??
		fallbackTone(index)
	)
}

export function eventTone(
	event: Event,
	index = 0,
	calendar?: Pick<Calendar, 'id' | 'name' | 'hex_color'>,
): EventTone {
	const titleTone = eventTitleTone(event.title ?? '')
	if (titleTone) return titleTone
	if (calendar) return calendarTone(calendar, index)
	const calendarIdTone = namedCalendarTone(event.calendar_id ?? '')
	if (calendarIdTone) return calendarIdTone
	const contextualTone = eventTitleContextTone(event.title ?? '')
	if (contextualTone) return contextualTone
	return fallbackTone(index)
}

function parseHexColor(hex?: string): [number, number, number] | undefined {
	const value = hex?.trim().replace(/^#/, '')
	if (!value) return undefined
	const normalized =
		value.length === 3
			? value
					.split('')
					.map((char) => `${char}${char}`)
					.join('')
			: value
	if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return undefined
	return [
		Number.parseInt(normalized.slice(0, 2), 16),
		Number.parseInt(normalized.slice(2, 4), 16),
		Number.parseInt(normalized.slice(4, 6), 16),
	]
}

function namedCalendarTone(value: string): EventTone | undefined {
	const normalized = value.toLowerCase()
	if (/work/.test(normalized)) return 'blue'
	if (/focus/.test(normalized)) return 'amber'
	if (/social/.test(normalized)) return 'rose'
	if (/personal|primary/.test(normalized)) return 'teal'
	return undefined
}

function eventTitleTone(title: string): EventTone | undefined {
	const normalized = title.toLowerCase()
	if (/flight|dinner|coffee|lunch/.test(normalized)) return 'rose'
	if (/dentist|home|gym|hike|dipsea/.test(normalized)) return 'teal'
	if (/pay rent|rent|focus|writing|sprint|prs|deep/.test(normalized)) return 'amber'
	return undefined
}

function eventTitleContextTone(title: string): EventTone | undefined {
	const normalized = title.toLowerCase()
	if (/roadmap|manager|standup|design system|planning|team|work/.test(normalized)) return 'blue'
	if (/travel|social/.test(normalized)) return 'rose'
	return undefined
}

function fallbackTone(index: number): EventTone {
	/* v8 ignore next -- `index % 4` is always 0-3 and the tuple has four entries, so the indexed access is never undefined and the `?? 'blue'` fallback is unreachable -- @preserve */
	return (['blue', 'teal', 'amber', 'rose'] as const)[index % 4] ?? 'blue'
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
