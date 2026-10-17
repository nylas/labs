/**
 * Facts a reader may know about a message from its provider headers. Header
 * values are untrusted sender-controlled text: they are read here, on the
 * server, and only the derived booleans and short validated strings below ever
 * leave it. Nothing here stores or logs a header value.
 */
export type MessageHeaderFacts = {
	/** DMARC passed, or SPF and DKIM both passed aligned with the From domain. */
	verified: boolean
	/** DMARC failed: the message is not from the domain it names. */
	authFailed: boolean
	/** The Reply-To address, only when it differs from the From address. */
	replyTo?: string
	/** The List-Id identifier, such as `eng-all.example.com`. */
	listId?: string
	listUnsubscribe: boolean
	/** An https unsubscribe link from List-Unsubscribe. */
	unsubscribeUrl?: string
	/** A mailto unsubscribe address, offered only when there is no https link. */
	unsubscribeMailto?: string
	/** The sender's UTC offset, in minutes, from the Date header. */
	dateOffsetMinutes?: number
}

export type ThreadHeaderFacts = { byMessage: Record<string, MessageHeaderFacts> }

/** A header in its original position; `unusable` when its value cannot be read (empty or over-long). */
type HeaderPair = { name: string; value: string; unusable?: true }

/** A header longer than this is not something a reader needs a fact from. */
const MAX_HEADER_VALUE_LENGTH = 8_192
const MAX_ADDRESS_LENGTH = 254
const MAX_LIST_ID_LENGTH = 255
const MAX_UNSUBSCRIBE_URL_LENGTH = 2_048
const MAX_UNSUBSCRIBE_SUBJECT_LENGTH = 200
const MAX_OFFSET_MINUTES = 14 * 60
const EMAIL_PATTERN = /^[^\s@<>()",;:\\[\]]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/
const LIST_ID_PATTERN = /^[A-Za-z0-9._-]+$/
const HOST_PATTERN = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/
/** Second-level labels under a two-letter country code that a registrant cannot own (`co.uk`). */
const PUBLIC_SECOND_LEVELS = new Set(['ac', 'co', 'com', 'edu', 'gov', 'net', 'org'])
/** Microsoft 365 writes Authentication-Results without an authserv-id; its hops are these sites. */
const MICROSOFT_SITES = new Set(['outlook.com', 'office365.com'])

/** RFC 5322 obsolete zone names that still appear in Date headers. */
const NAMED_ZONES: Record<string, number> = {
	UT: 0,
	UTC: 0,
	GMT: 0,
	Z: 0,
	EST: -300,
	EDT: -240,
	CST: -360,
	CDT: -300,
	MST: -420,
	MDT: -360,
	PST: -480,
	PDT: -420,
}

/**
 * Name/value pairs from an untrusted provider header list, in order; names
 * lower-cased. A header whose value cannot be read keeps its place, marked
 * unusable, so it can never let a lower, sender-written header of the same
 * name stand in for it.
 */
function headerPairs(headers: unknown): HeaderPair[] {
	if (!Array.isArray(headers)) return []
	const pairs: HeaderPair[] = []
	for (const header of headers as Array<{ name?: unknown; value?: unknown } | null>) {
		if (typeof header?.name !== 'string') continue
		const name = header.name.trim().toLowerCase()
		const value = typeof header.value === 'string' ? header.value.trim() : ''
		if (!name) continue
		if (value === '' || value.length > MAX_HEADER_VALUE_LENGTH)
			pairs.push({ name, value: '', unusable: true })
		else pairs.push({ name, value })
	}
	return pairs
}

/**
 * The topmost header of a name: the receiving server adds its own above
 * anything the sender wrote. When that header is unusable the answer is
 * nothing; a lower header is never read in its place.
 */
function firstHeader(pairs: HeaderPair[], name: string): string | undefined {
	const pair = pairs.find((candidate) => candidate.name === name)
	return pair && !pair.unusable ? pair.value : undefined
}

function validAddress(value: string): string | undefined {
	const address = value.trim()
	return address.length <= MAX_ADDRESS_LENGTH && EMAIL_PATTERN.test(address) ? address : undefined
}

/** Quoted strings and comments, which may hold anything, including text that looks like an address. */
function withoutQuotedText(value: string): string {
	return value.replace(/"(?:[^"\\]|\\.)*"/g, ' ').replace(/\((?:[^()\\]|\\.)*\)/g, ' ')
}

/** The first address in an address header: `Name <a@b.c>` or a bare `a@b.c`. */
function firstAddress(value: string): string | undefined {
	const cleaned = withoutQuotedText(value)
	const bracketed = /<([^<>]*)>/.exec(cleaned)
	if (bracketed) return validAddress(bracketed[1] as string)
	return validAddress(cleaned.split(',')[0] as string)
}

function domainOf(value: string | undefined): string | undefined {
	const domain = value?.slice(value.lastIndexOf('@') + 1).toLowerCase()
	return domain && HOST_PATTERN.test(domain) ? domain : undefined
}

/** Relaxed DMARC alignment: the same domain, or one a subdomain of the other. */
function aligned(domain: string | undefined, fromDomain: string | undefined): boolean {
	if (!domain || !fromDomain) return false
	return domain === fromDomain || domain.endsWith(`.${fromDomain}`) || fromDomain.endsWith(`.${domain}`)
}

type AuthResult = { method: string; result: string; domain?: string }

const METHOD_RESULT = /^\s*(dmarc|spf|dkim)\s*=\s*([a-z]+)/i

/** The registrable site of a host, roughly: its last two labels, or three under `co.uk`-style suffixes. */
function siteOf(host: string): string | undefined {
	const normalized = host.trim().toLowerCase().replace(/\.$/, '')
	if (!HOST_PATTERN.test(normalized)) return undefined
	const labels = normalized.split('.')
	const tld = labels.at(-1) as string
	const second = labels.at(-2) as string
	const keep = tld.length === 2 && PUBLIC_SECOND_LEVELS.has(second) && labels.length > 2 ? 3 : 2
	return labels.slice(-keep).join('.')
}

/** The host that received the message last: the `by` of the topmost Received header, which the sender cannot write. */
function receivingHost(pairs: HeaderPair[]): string | undefined {
	const received = firstHeader(pairs, 'received')
	if (!received) return undefined
	return /\bby\s+([^\s;()]+)/i.exec(withoutQuotedText(received))?.[1]?.toLowerCase()
}

/** Google's last hop is `by` an internal IPv6 address; its earlier hop is `by mx.google.com`. */
function googleReceived(host: string): boolean {
	return /^[0-9a-f:]+$/.test(host) && host.includes(':')
}

/**
 * The method results of the topmost Authentication-Results header, and only
 * when the receiving provider wrote it (RFC 8601 §5 has receivers drop any
 * copy of their own id from outside). That is when its authserv-id is the
 * receiving host's site, `mx.google.com` behind Google's last hop, or a
 * Microsoft 365 header, which carries no id, behind a Microsoft hop.
 * Anything else may have been written by the sender, so it says nothing.
 */
function trustedAuthenticationResults(pairs: HeaderPair[]): AuthResult[] {
	const value = firstHeader(pairs, 'authentication-results')
	const host = receivingHost(pairs)
	if (!value || !host) return []
	const segments = value.replace(/\([^()]*\)/g, ' ').split(';')
	const hostSite = siteOf(host)
	let results: string[]
	if (METHOD_RESULT.test(segments[0] as string)) {
		if (!hostSite || !MICROSOFT_SITES.has(hostSite)) return []
		results = segments
	} else {
		const authservId = (segments[0] as string).trim().split(/\s+/)[0]?.toLowerCase() ?? ''
		const trusted =
			(hostSite !== undefined && siteOf(authservId) === hostSite) ||
			(authservId === 'mx.google.com' && (googleReceived(host) || hostSite === 'google.com'))
		if (!trusted) return []
		results = segments.slice(1)
	}
	const parsed: AuthResult[] = []
	for (const entry of results) {
		const match = METHOD_RESULT.exec(entry)
		if (!match) continue
		const property = /\b(?:header\.from|smtp\.mailfrom|header\.d|header\.i)\s*=\s*"?([^\s";]+)/i.exec(entry)
		const domain = domainOf(property?.[1])
		parsed.push({
			method: (match[1] as string).toLowerCase(),
			result: (match[2] as string).toLowerCase(),
			...(domain ? { domain } : {}),
		})
	}
	return parsed
}

function listId(value: string | undefined): string | undefined {
	if (!value) return undefined
	const id = (/<([^<>]*)>/.exec(value)?.[1] ?? value).trim()
	return id.length <= MAX_LIST_ID_LENGTH && LIST_ID_PATTERN.test(id) ? id : undefined
}

function httpsUnsubscribe(candidate: string): string | undefined {
	if (candidate.length > MAX_UNSUBSCRIBE_URL_LENGTH) return undefined
	try {
		const url = new URL(candidate)
		return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined
	} catch {
		return undefined
	}
}

function mailtoUnsubscribe(candidate: string): string | undefined {
	if (!/^mailto:/i.test(candidate)) return undefined
	const [rawAddress = '', query = ''] = candidate.slice('mailto:'.length).split('?', 2)
	let address: string | undefined
	let subject: string | null = null
	try {
		address = validAddress(decodeURIComponent(rawAddress))
		subject = new URLSearchParams(query).get('subject')
	} catch {
		return undefined
	}
	if (!address) return undefined
	const safeSubject = subject
		?.replace(/[\r\n]/g, ' ')
		.trim()
		.slice(0, MAX_UNSUBSCRIBE_SUBJECT_LENGTH)
	return `mailto:${address}${safeSubject ? `?subject=${encodeURIComponent(safeSubject)}` : ''}`
}

/** An https link wins; a mailto address is kept only when no link is offered. */
function unsubscribeTarget(
	value: string,
): Partial<Pick<MessageHeaderFacts, 'unsubscribeUrl' | 'unsubscribeMailto'>> {
	const candidates = [...value.matchAll(/<([^<>]*)>/g)].map((match) => (match[1] as string).trim())
	for (const candidate of candidates) {
		const url = httpsUnsubscribe(candidate)
		if (url) return { unsubscribeUrl: url }
	}
	for (const candidate of candidates) {
		const mailto = mailtoUnsubscribe(candidate)
		if (mailto) return { unsubscribeMailto: mailto }
	}
	return {}
}

/** The zone at the end of a Date header. `-0000` means "zone unknown" and gives nothing. */
function dateOffsetMinutes(value: string | undefined): number | undefined {
	if (!value) return undefined
	const text = value.replace(/\([^()]*\)\s*$/, '').trim()
	const numeric = /([+-])(\d{2})(\d{2})$/.exec(text)
	if (numeric) {
		const [, sign, hours, minutes] = numeric
		const total = Number(hours) * 60 + Number(minutes)
		if (Number(minutes) >= 60 || total > MAX_OFFSET_MINUTES) return undefined
		if (sign === '-' && total === 0) return undefined
		return sign === '-' ? -total : total
	}
	const named = /\s([A-Za-z]{1,3})$/.exec(text)?.[1]?.toUpperCase()
	return named !== undefined ? NAMED_ZONES[named] : undefined
}

/**
 * The facts in one message's untrusted headers. `fromEmail` and `replyToEmail`
 * are the provider's parsed addresses; the From and Reply-To headers are read
 * only when they are missing.
 */
export function messageHeaderFacts(
	headers: unknown,
	fromEmail?: string,
	replyToEmail?: string,
): MessageHeaderFacts {
	const pairs = headerPairs(headers)
	const from = (fromEmail && validAddress(fromEmail)) || firstAddress(firstHeader(pairs, 'from') ?? '')
	const fromDomain = domainOf(from)
	const auth = trustedAuthenticationResults(pairs)
	const result = (method: string) => auth.filter((entry) => entry.method === method)
	const dmarc = result('dmarc')[0]?.result
	const alignedPass = (method: string) =>
		result(method).some((entry) => entry.result === 'pass' && aligned(entry.domain, fromDomain))
	const replyTo =
		(replyToEmail && validAddress(replyToEmail)) || firstAddress(firstHeader(pairs, 'reply-to') ?? '')
	const list = listId(firstHeader(pairs, 'list-id'))
	const unsubscribe = firstHeader(pairs, 'list-unsubscribe')
	const offset = dateOffsetMinutes(firstHeader(pairs, 'date'))
	return {
		verified: dmarc === 'pass' || (dmarc !== 'fail' && alignedPass('spf') && alignedPass('dkim')),
		authFailed: dmarc === 'fail',
		...(replyTo && replyTo.toLowerCase() !== from?.toLowerCase() ? { replyTo } : {}),
		...(list ? { listId: list } : {}),
		listUnsubscribe: unsubscribe !== undefined,
		...(unsubscribe ? unsubscribeTarget(unsubscribe) : {}),
		...(offset !== undefined ? { dateOffsetMinutes: offset } : {}),
	}
}

/** Raw headers shown to the reader are capped; a longer block is cut at a line boundary. */
export const MAX_RAW_HEADERS_LENGTH = 64 * 1024
/** Enough base64url of a raw message to hold any header block we would show (and then some). */
const RAW_MIME_PREFIX_LENGTH = 4 * Math.ceil((MAX_RAW_HEADERS_LENGTH * 2) / 3)

function base64UrlPrefixBytes(value: string): Uint8Array | null {
	if (!/^[A-Za-z0-9_-]+={0,2}$/.test(value)) return null
	const unpadded = value.replace(/=+$/, '')
	const prefix = unpadded.slice(0, RAW_MIME_PREFIX_LENGTH)
	// Drop a trailing partial quantum; a lone sextet cannot encode a byte.
	const usable = prefix.length % 4 === 1 ? prefix.slice(0, -1) : prefix
	const normalized = usable.replaceAll('-', '+').replaceAll('_', '/')
	const binary = atob(normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '='))
	return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

/**
 * The header block of a provider's base64url raw message, as plain text:
 * CRLF line endings, control characters other than tab removed, at most
 * `MAX_RAW_HEADERS_LENGTH` characters. Null when the payload is unusable.
 */
export function rawHeaderText(rawMime: unknown): string | null {
	if (typeof rawMime !== 'string' || rawMime.length === 0) return null
	const bytes = base64UrlPrefixBytes(rawMime)
	if (!bytes) return null
	const text = new TextDecoder('utf-8').decode(bytes)
	const end = /\r?\n\r?\n/.exec(text)?.index ?? text.length
	const lines = text
		.slice(0, end)
		.split(/\r\n|\r|\n/)
		// biome-ignore lint/suspicious/noControlCharactersInRegex: removing control characters is the point.
		.map((line) => line.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, ''))
	let joined = lines.join('\r\n')
	if (joined.length > MAX_RAW_HEADERS_LENGTH) {
		const cut = joined.lastIndexOf('\r\n', MAX_RAW_HEADERS_LENGTH)
		joined = joined.slice(0, cut > 0 ? cut : MAX_RAW_HEADERS_LENGTH)
	}
	return joined.trim() ? joined : null
}
