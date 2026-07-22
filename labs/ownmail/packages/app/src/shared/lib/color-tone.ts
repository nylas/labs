export type EventTone = 'blue' | 'teal' | 'amber' | 'rose'

export function eventColorClass(tone: EventTone, kind: 'bg' | 'text' | 'border'): string {
	const prefix = kind === 'bg' ? 'bg' : kind === 'text' ? 'text' : 'border'
	return `${prefix}-[var(--event-${tone})]`
}

export function eventChipClass(tone: EventTone): string {
	return `event-chip text-[var(--event-${tone})] border border-[var(--event-${tone})]/20`
}

export function labelBadgeClass(tone: EventTone): string {
	const bgOpacity = tone === 'amber' ? '10' : '8'
	return `label-badge border border-[var(--event-${tone})]/20 bg-[var(--event-${tone})]/${bgOpacity} text-[var(--event-${tone})]`
}
