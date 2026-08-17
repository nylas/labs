import type { Message } from '@nylas-labs/cli-kit/v3'
import { parse, serialize } from 'parse5'
import { platform } from '#server/platform'

const IMAGE_SOURCE_TTL_MS = 14 * 24 * 60 * 60 * 1000
const MAX_REMOTE_SOURCE_LENGTH = 4_096
const MAX_IMAGE_SOURCES_PER_MESSAGE = 256
const MAX_PROVIDER_ID_LENGTH = 1_000
const TOKEN_VERSION = 1
const encoder = new TextEncoder()

export const EMAIL_IMAGE_PATH_PREFIX = '/email-images/'

export type EmailImageSource =
	| { expiresAt: number; kind: 'remote'; trackingHint: boolean; url: string; version: 1 }
	| { attachmentId: string; expiresAt: number; kind: 'attachment'; messageId: string; version: 1 }

export type ImageProtectedMessage = Message & {
	/** Server-attested tokens for inline attachments. Provider lookalikes are discarded. */
	ownmailImageTokens?: Record<string, string>
	ownmailImagesAttested?: true
}

type ParseNode = {
	attrs?: Array<{ name: string; value: string }>
	childNodes?: ParseNode[]
	nodeName: string
	tagName?: string
	value?: string
}

function base64url(bytes: Uint8Array): string {
	let binary = ''
	for (const byte of bytes) binary += String.fromCharCode(byte)
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function fromBase64url(value: string): Uint8Array | null {
	if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 12_000) return null
	try {
		const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
		const binary = atob(normalized)
		const decoded = Uint8Array.from(binary, (character) => character.charCodeAt(0))
		return base64url(decoded) === value ? decoded : null
	} catch {
		return null
	}
}

async function imageTokenKey(): Promise<CryptoKey> {
	const { env } = await platform()
	return crypto.subtle.importKey(
		'raw',
		encoder.encode(env.SESSION_SECRET),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign', 'verify'],
	)
}

/** Sign a server-attested source so the image route cannot be used as an open proxy. */
export async function signEmailImageSource(source: EmailImageSource): Promise<string> {
	const payload = encoder.encode(JSON.stringify(source))
	const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await imageTokenKey(), payload))
	return `${base64url(payload)}.${base64url(signature)}`
}

/** Verify and strictly decode an image source token. Invalid and expired values fail closed. */
export async function verifyEmailImageSource(
	token: string,
	now = Date.now(),
): Promise<EmailImageSource | null> {
	const parts = token.split('.')
	if (parts.length !== 2) return null
	const [encodedPayload, encodedSignature] = parts as [string, string]
	const payload = fromBase64url(encodedPayload)
	const signature = fromBase64url(encodedSignature)
	if (!payload || !signature || signature.length !== 32) return null
	if (
		!(await crypto.subtle.verify(
			'HMAC',
			await imageTokenKey(),
			signature.slice().buffer,
			payload.slice().buffer,
		))
	)
		return null

	let parsed: unknown
	try {
		parsed = JSON.parse(new TextDecoder().decode(payload))
	} catch {
		return null
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
	const source = parsed as Record<string, unknown>
	if (
		source.version !== TOKEN_VERSION ||
		typeof source.expiresAt !== 'number' ||
		!Number.isSafeInteger(source.expiresAt) ||
		source.expiresAt < now ||
		source.expiresAt > now + IMAGE_SOURCE_TTL_MS + 60_000
	) {
		return null
	}
	if (source.kind === 'remote') {
		if (
			Object.keys(source).some(
				(key) => !['version', 'kind', 'url', 'trackingHint', 'expiresAt'].includes(key),
			) ||
			typeof source.url !== 'string' ||
			typeof source.trackingHint !== 'boolean' ||
			!normalizedRemoteUrl(source.url)
		) {
			return null
		}
		return source as EmailImageSource
	}
	if (source.kind === 'attachment') {
		if (
			Object.keys(source).some(
				(key) => !['version', 'kind', 'attachmentId', 'messageId', 'expiresAt'].includes(key),
			) ||
			!validProviderId(source.attachmentId) ||
			!validProviderId(source.messageId)
		) {
			return null
		}
		return source as EmailImageSource
	}
	return null
}

function validProviderId(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		value.length > 0 &&
		value.length <= MAX_PROVIDER_ID_LENGTH &&
		!/[\r\n\0]/.test(value)
	)
}

function normalizedRemoteUrl(value: string): string | null {
	if (value.length === 0 || value.length > MAX_REMOTE_SOURCE_LENGTH || /[\r\n\0]/.test(value)) return null
	try {
		const parsed = new URL(value.startsWith('//') ? `https:${value}` : value)
		if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null
		return parsed.toString()
	} catch {
		return null
	}
}

function proxyPath(token: string): string {
	return `${EMAIL_IMAGE_PATH_PREFIX}${token}?mode=automatic&theme=light`
}

function attr(node: ParseNode, name: string): { name: string; value: string } | undefined {
	return node.attrs?.find((candidate) => candidate.name.toLowerCase() === name)
}

function isImageResourceAttribute(node: ParseNode, name: string): boolean {
	if (['src', 'poster', 'background'].includes(name)) return true
	return ['href', 'xlink:href'].includes(name) && ['image', 'use'].includes(node.tagName as string)
}

function numericCssDimension(value: string): number | null {
	const match = value.match(/^\s*(\d+(?:\.\d+)?)\s*(?:px)?\s*$/i)
	return match?.[1] ? Number(match[1]) : null
}

function trackingElementHint(node: ParseNode): boolean {
	if (node.tagName !== 'img') return false
	const width = numericCssDimension(attr(node, 'width')?.value ?? '')
	const height = numericCssDimension(attr(node, 'height')?.value ?? '')
	const style = attr(node, 'style')?.value ?? ''
	const styleWidth = numericCssDimension(style.match(/(?:^|;)\s*width\s*:\s*([^;]+)/i)?.[1] ?? '')
	const styleHeight = numericCssDimension(style.match(/(?:^|;)\s*height\s*:\s*([^;]+)/i)?.[1] ?? '')
	return [width, height, styleWidth, styleHeight].some((dimension) => dimension !== null && dimension <= 2)
}

function trackingUrlHint(value: string): boolean {
	try {
		const url = new URL(value)
		return /(?:^|[\W_])(?:beacon|open|pixel|track(?:ing)?)(?:[\W_]|$)/i.test(`${url.hostname}${url.pathname}`)
	} catch {
		/* v8 ignore next -- callers provide values already accepted by normalizedRemoteUrl -- @preserve */
		return false
	}
}

function splitSrcset(value: string): string[] {
	const candidates: string[] = []
	let start = 0
	let quote = ''
	let parentheses = 0
	for (let index = 0; index < value.length; index += 1) {
		const character = value.charAt(index)
		if (quote) {
			if (character === quote && value[index - 1] !== '\\') quote = ''
			continue
		}
		if (character === '"' || character === "'") quote = character
		else if (character === '(') parentheses += 1
		else if (character === ')') parentheses = Math.max(0, parentheses - 1)
		else if (character === ',' && parentheses === 0) {
			candidates.push(value.slice(start, index))
			start = index + 1
		}
	}
	candidates.push(value.slice(start))
	return candidates
}

function rewriteSrcset(value: string, sources: Map<string, string>): string {
	return splitSrcset(value)
		.map((candidate) => {
			const match = candidate.match(/^(\s*)(\S+)([\s\S]*)$/)
			if (!match) return candidate
			const [, leading, resource, suffix] = match as unknown as [string, string, string, string]
			const remote = normalizedRemoteUrl(resource)
			const replacement = remote ? sources.get(remote) : undefined
			return replacement ? `${leading}${replacement}${suffix}` : candidate
		})
		.join(',')
}

const CSS_URL = /url\(\s*(?:(['"])(.*?)\1|([^)]*?))\s*\)/giu

function remoteCssUrls(value: string): string[] {
	return Array.from(value.matchAll(CSS_URL)).flatMap((match) => {
		/* v8 ignore next -- CSS_URL always captures either a quoted or bare value -- @preserve */
		const remote = normalizedRemoteUrl((match[2] ?? match[3] ?? '').trim())
		return remote ? [remote] : []
	})
}

function rewriteCssUrls(value: string, sources: Map<string, string>): string {
	return value.replace(CSS_URL, (original, _quote: string, quoted: string, bare: string) => {
		const remote = normalizedRemoteUrl((quoted ?? bare).trim())
		const replacement = remote ? sources.get(remote) : undefined
		return replacement ? `url("${replacement}")` : original
	})
}

function walk(node: ParseNode, visit: (node: ParseNode) => void): void {
	visit(node)
	for (const child of node.childNodes ?? []) walk(child, visit)
}

/**
 * Replace provider-controlled remote image references with signed, same-origin
 * proxy paths before the message crosses the server/browser boundary.
 */
export async function protectMessageImageSources(message: Message): Promise<ImageProtectedMessage> {
	const providerMessage = message as ImageProtectedMessage
	const {
		ownmailImageTokens: _providerTokenLookalike,
		ownmailImagesAttested: _providerAttestationLookalike,
		...cleanMessage
	} = providerMessage
	// Bucket expirations so identical authenticated sources receive stable tokens
	// during the cache window without extending any token beyond one full TTL.
	const expiresAt = (Math.floor(Date.now() / IMAGE_SOURCE_TTL_MS) + 1) * IMAGE_SOURCE_TTL_MS
	const attachmentTokens: Record<string, string> = {}
	for (const attachment of message.attachments ?? []) {
		if (!attachment.is_inline || !validProviderId(attachment.id) || !validProviderId(message.id)) continue
		attachmentTokens[attachment.id] = await signEmailImageSource({
			version: TOKEN_VERSION,
			kind: 'attachment',
			attachmentId: attachment.id,
			messageId: message.id,
			expiresAt,
		})
	}

	if (typeof message.body !== 'string' || !message.body.trim()) {
		const hasAttachmentTokens = Object.keys(attachmentTokens).length > 0
		return {
			...cleanMessage,
			...(hasAttachmentTokens
				? { ownmailImagesAttested: true as const, ownmailImageTokens: attachmentTokens }
				: {}),
		}
	}

	const document = parse(message.body) as unknown as ParseNode
	const requests = new Map<string, { trackingHint: boolean; url: string }>()
	walk(document, (node) => {
		const elementTrackingHint = trackingElementHint(node)
		for (const attribute of node.attrs ?? []) {
			const name = attribute.name.toLowerCase()
			if (isImageResourceAttribute(node, name)) {
				const remote = normalizedRemoteUrl(attribute.value)
				if (remote && requests.size < MAX_IMAGE_SOURCES_PER_MESSAGE) {
					requests.set(remote, {
						url: remote,
						trackingHint: elementTrackingHint || trackingUrlHint(remote),
					})
				}
			}
			if (name === 'srcset') {
				for (const candidate of splitSrcset(attribute.value)) {
					const [resource] = candidate.trim().split(/\s+/, 1) as [string]
					const remote = normalizedRemoteUrl(resource)
					if (remote && requests.size < MAX_IMAGE_SOURCES_PER_MESSAGE) {
						requests.set(remote, {
							url: remote,
							trackingHint: elementTrackingHint || trackingUrlHint(remote),
						})
					}
				}
			}
			if (name === 'style') {
				for (const remote of remoteCssUrls(attribute.value)) {
					if (requests.size >= MAX_IMAGE_SOURCES_PER_MESSAGE) break
					requests.set(remote, { url: remote, trackingHint: trackingUrlHint(remote) })
				}
			}
		}
		if (node.tagName === 'style') {
			const children = node.childNodes as ParseNode[]
			for (const child of children) {
				/* v8 ignore next -- parse5 represents style contents exclusively as text nodes -- @preserve */
				if (typeof child.value !== 'string') continue
				for (const remote of remoteCssUrls(child.value)) {
					if (requests.size >= MAX_IMAGE_SOURCES_PER_MESSAGE) break
					requests.set(remote, { url: remote, trackingHint: trackingUrlHint(remote) })
				}
			}
		}
	})

	if (requests.size === 0) {
		const hasAttachmentTokens = Object.keys(attachmentTokens).length > 0
		return {
			...cleanMessage,
			...(hasAttachmentTokens
				? { ownmailImagesAttested: true as const, ownmailImageTokens: attachmentTokens }
				: {}),
		}
	}

	const protectedSources = new Map<string, string>()
	await Promise.all(
		Array.from(requests.values(), async (request) => {
			const token = await signEmailImageSource({
				version: TOKEN_VERSION,
				kind: 'remote',
				url: request.url,
				trackingHint: request.trackingHint,
				expiresAt,
			})
			protectedSources.set(request.url, proxyPath(token))
		}),
	)

	walk(document, (node) => {
		for (const attribute of node.attrs ?? []) {
			const name = attribute.name.toLowerCase()
			if (isImageResourceAttribute(node, name)) {
				const remote = normalizedRemoteUrl(attribute.value)
				const replacement = remote ? protectedSources.get(remote) : undefined
				if (replacement) attribute.value = replacement
			} else if (name === 'srcset') {
				attribute.value = rewriteSrcset(attribute.value, protectedSources)
			} else if (name === 'style') {
				attribute.value = rewriteCssUrls(attribute.value, protectedSources)
			}
		}
		if (node.tagName === 'style') {
			const children = node.childNodes as ParseNode[]
			for (const child of children) {
				/* v8 ignore next -- parse5 represents style contents exclusively as text nodes -- @preserve */
				if (typeof child.value === 'string') child.value = rewriteCssUrls(child.value, protectedSources)
			}
		}
	})

	return {
		...cleanMessage,
		ownmailImagesAttested: true,
		body: serialize(document as never),
		...(Object.keys(attachmentTokens).length > 0 ? { ownmailImageTokens: attachmentTokens } : {}),
	}
}
