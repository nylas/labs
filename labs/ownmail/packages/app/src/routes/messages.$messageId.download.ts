import { createFileRoute } from '@tanstack/react-router'
import { nylas } from '#server/nylas'
import { usingDevMocks } from '#server/platform'
import { getSession } from '#server/session'

const MAX_PROVIDER_MESSAGE_ID_LENGTH = 1000
const MAX_RAW_MIME_BASE64URL_LENGTH = 50 * 1024 * 1024

export const Route = createFileRoute('/messages/$messageId/download')({
	server: {
		handlers: {
			GET: async ({ request, params }) => {
				if (await usingDevMocks()) {
					if (!validNylasMessageId(params.messageId)) {
						return new Response('Bad request', { status: 400 })
					}
					return rawEmailResponse(
						new TextEncoder().encode(
							'MIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nLocal mock email.\r\n',
						),
						params.messageId,
					)
				}

				const session = await getSession(request)
				if (!session) return new Response('Unauthorized', { status: 401 })
				if (!validNylasMessageId(params.messageId)) {
					return new Response('Bad request', { status: 400 })
				}

				try {
					const result = await (await nylas()).forGrant(session.grantId).getRawMime(params.messageId)
					const rawMime = (result as { data?: { raw_mime?: unknown } } | null)?.data?.raw_mime
					const bytes = decodeRawMime(rawMime)
					if (!bytes) return new Response('Raw email unavailable', { status: 404 })
					return rawEmailResponse(bytes, params.messageId)
				} catch {
					return new Response('Raw email unavailable', { status: 404 })
				}
			},
		},
	},
})

export function validNylasMessageId(value: string | null | undefined): value is string {
	if (!value || value.length > MAX_PROVIDER_MESSAGE_ID_LENGTH) return false
	for (const char of value) {
		if (char.charCodeAt(0) < 32) return false
	}
	return true
}

/** Decode Nylas's Base64url payload after validating its alphabet, padding, and size. */
export function decodeRawMime(value: unknown, maxLength = MAX_RAW_MIME_BASE64URL_LENGTH): Uint8Array | null {
	if (
		typeof value !== 'string' ||
		value.length === 0 ||
		value.length > maxLength ||
		!/^[A-Za-z0-9_-]+={0,2}$/.test(value)
	) {
		return null
	}
	const unpadded = value.replace(/=+$/, '')
	const suppliedPadding = value.length - unpadded.length
	const requiredPadding = (4 - (unpadded.length % 4)) % 4
	if (unpadded.length % 4 === 1 || (suppliedPadding > 0 && suppliedPadding !== requiredPadding)) {
		return null
	}
	const normalized = unpadded.replaceAll('-', '+').replaceAll('_', '/')
	const padded = normalized.padEnd(normalized.length + requiredPadding, '=')
	try {
		const binary = atob(padded)
		const bytes = new Uint8Array(binary.length)
		for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
		return bytes
	} catch {
		return null
	}
}

export function rawEmailFilename(messageId: string): string {
	const safe = [...messageId]
		.map((char) => (/[A-Za-z0-9._-]/.test(char) ? char : '_'))
		.join('')
		.slice(0, 64)
		.replace(/^[._-]+|[._-]+$/g, '')
	return `message-${safe || 'email'}.eml`
}

function rawEmailResponse(bytes: Uint8Array, messageId: string): Response {
	return new Response(bytes.buffer as ArrayBuffer, {
		status: 200,
		headers: {
			'Content-Type': 'message/rfc822',
			'Content-Disposition': `attachment; filename="${rawEmailFilename(messageId)}"`,
			'Cache-Control': 'no-store',
			'X-Content-Type-Options': 'nosniff',
		},
	})
}
