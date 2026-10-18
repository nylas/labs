/**
 * Whether two addresses come from the same organisation: the one test behind
 * the lookalike-sender notice and the inert links it announces, so the two
 * never disagree.
 *
 * There is no public suffix list here, and private suffixes (github.io,
 * herokuapp.com) hand sibling hosts to strangers under any top-level domain.
 * So only the same host, or a subdomain of the other, matches: siblings such
 * as mail.example.com and news.example.com are strangers until proven
 * otherwise. A guess errs toward the warning, never toward silence.
 */

/**
 * A second level under a two-letter country code that a registrant cannot own:
 * co.uk, ne.jp, com.au, ac.jp, gov.uk, gouv.fr, govt.nz. Any two- or
 * three-letter label counts, so an unlisted public suffix still splits its
 * registrants apart.
 */
const PUBLIC_SECOND_LEVEL = /^(?:[a-z]{2,3}|gouv|govt|info|priv)$/

/** The host an address came from, lowercased, without empty labels: Mail.Example.com. → mail.example.com. */
function hostOf(email: string): string {
	const host = email.trim().toLowerCase().split('@')[1] ?? ''
	return host.split('.').filter(Boolean).join('.')
}

/** How many labels a host's registrable domain has: 3 under a public second level, else 2. */
function registrableLabels(labels: string[]): 2 | 3 {
	return labels.length >= 3 &&
		(labels.at(-1) as string).length === 2 &&
		PUBLIC_SECOND_LEVEL.test(labels.at(-2) as string)
		? 3
		: 2
}

/** The registrable part of an address's domain, for naming it: mail.meridianbank.com → meridianbank.com. */
export function organisationDomain(email: string): string {
	const labels = hostOf(email).split('.')
	return labels.slice(-registrableLabels(labels)).join('.')
}

/** Whether `child` is a subdomain of `parent`; a bare top-level domain is nobody's parent. */
const within = (child: string, parent: string): boolean =>
	parent.includes('.') && child.endsWith(`.${parent}`)

/**
 * Whether two addresses write from the same organisation's domain: the same
 * host, or one a subdomain of the other. An address without a domain matches
 * nothing.
 */
export function sameSenderDomain(a: string, b: string): boolean {
	const hostA = hostOf(a)
	const hostB = hostOf(b)
	if (!hostA || !hostB) return false
	return hostA === hostB || within(hostA, hostB) || within(hostB, hostA)
}
