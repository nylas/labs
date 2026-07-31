import type { ProjectState } from './schema.js'
import { DEFAULT_SITE_NAME, SiteNameSchema } from './schema.js'

const GENERIC_SUBDOMAINS = new Set(['app', 'email', 'inbox', 'mail', 'webmail'])
const COMMON_SECOND_LEVEL_SUFFIXES = new Set(['ac', 'co', 'com', 'edu', 'gov', 'net', 'org'])

export function normalizeSiteName(value: string): string {
	return SiteNameSchema.parse(value)
}

export function siteNameValidationError(value: string | undefined): string | undefined {
	const parsed = SiteNameSchema.safeParse(value ?? '')
	return parsed.success ? undefined : (parsed.error.issues[0] as { message: string }).message
}

export function inferSiteName(domain: string): string {
	const labels = domain.trim().toLowerCase().replace(/\.$/, '').split('.').filter(Boolean)
	const brandLabel = selectBrandLabel(labels)
	const words = brandLabel.split(/[-_]+/).filter(Boolean).map(titleCase)
	const brand = words.join(' ') || 'My'
	return normalizeSiteName(/\bmail$/i.test(brand) ? brand : `${brand} Mail`)
}

export function configuredSiteName(project: Pick<ProjectState, 'siteName'>): string {
	return project.siteName ?? DEFAULT_SITE_NAME
}

function selectBrandLabel(labels: string[]): string {
	if (labels.length === 0) return 'my'
	if (labels.length >= 3 && labels.at(-2) === 'nylas' && labels.at(-1) === 'email') {
		return labels.slice(0, -2).join('-')
	}
	let suffixLength = 1
	const topLevelDomain = labels.at(-1) as string
	const secondLevelDomain = labels.at(-2) as string
	if (
		labels.length >= 3 &&
		topLevelDomain.length === 2 &&
		COMMON_SECOND_LEVEL_SUFFIXES.has(secondLevelDomain)
	) {
		suffixLength = 2
	}
	const registrableLabelIndex = Math.max(0, labels.length - suffixLength - 1)
	const registrableLabel = labels[registrableLabelIndex] as string
	const leadingLabel = labels[0] as string
	return leadingLabel && !GENERIC_SUBDOMAINS.has(leadingLabel) && labels.length > suffixLength + 1
		? leadingLabel
		: registrableLabel
}

function titleCase(value: string): string {
	if (/^[0-9]+$/.test(value)) return value
	return `${value.charAt(0).toLocaleUpperCase()}${value.slice(1)}`
}
