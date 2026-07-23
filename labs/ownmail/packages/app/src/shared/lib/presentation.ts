export function formatListDate(epochSeconds?: number): string {
	if (!epochSeconds) return ''
	const date = new Date(epochSeconds * 1000)
	const now = new Date()
	if (date.toDateString() === now.toDateString()) {
		return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
	}
	const diffDays = Math.floor((startOfLocalDay(now).getTime() - startOfLocalDay(date).getTime()) / 86_400_000)
	if (diffDays > 0 && diffDays < 7) {
		return date.toLocaleDateString(undefined, { weekday: 'short' })
	}
	return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function startOfLocalDay(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function initials(nameOrEmail: string): string {
	/* v8 ignore next -- `String.prototype.split` always yields a non-empty array, so `[0]` is never nullish and the `?? nameOrEmail` fallback is unreachable -- @preserve */
	const source = nameOrEmail.includes('@') ? (nameOrEmail.split('@')[0] ?? nameOrEmail) : nameOrEmail
	return source
		.split(/[.\s_-]+/)
		.map((part) => part[0])
		.filter(Boolean)
		.slice(0, 2)
		.join('')
		.toUpperCase()
}
