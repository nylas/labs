import type { ProjectState } from './schema.js'

const MAX_APP_DOMAINS = 50

export function normalizeAppDomain(value: string): string {
	const normalized = value.trim().toLowerCase().replace(/\.$/, '')
	if (!isAppDomain(normalized)) {
		throw new Error('Enter an app hostname such as mail.example.com (no https://, path, port, or wildcard).')
	}
	return normalized
}

export function isAppDomain(value: string): boolean {
	if (value.length < 4 || value.length > 253 || /[^a-z0-9.-]/.test(value)) return false
	const labels = value.split('.')
	if (labels.length < 2 || labels.some((label) => !isDomainLabel(label))) return false
	const topLevel = labels.at(-1)
	return Boolean(topLevel && (/^[a-z]{2,63}$/.test(topLevel) || /^xn--[a-z0-9-]{1,59}$/.test(topLevel)))
}

export function projectAppDomains(project: Pick<ProjectState, 'appDomain' | 'appDomains'>): string[] {
	const domains = new Set<string>()
	if (project.appDomain) domains.add(project.appDomain)
	for (const domain of project.appDomains ?? []) domains.add(domain)
	return [...domains].slice(0, MAX_APP_DOMAINS)
}

export function addProjectAppDomain(project: ProjectState, domain: string): void {
	assertProjectAppDomainCapacity(project, domain)
	const domains = new Set(projectAppDomains(project))
	domains.add(domain)
	project.appDomains = [...domains]
}

export function assertProjectAppDomainCapacity(
	project: Pick<ProjectState, 'appDomain' | 'appDomains'>,
	domain: string,
): void {
	const domains = new Set(projectAppDomains(project))
	if (!domains.has(domain) && domains.size >= MAX_APP_DOMAINS) {
		throw new Error(`OwnMail supports at most ${MAX_APP_DOMAINS} custom app domains per project.`)
	}
}

function isDomainLabel(label: string): boolean {
	return label.length >= 1 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
}
