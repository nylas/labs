import { createFileRoute } from '@tanstack/react-router'
import {
	type EmailImageMode,
	type EmailImageTheme,
	fetchRemoteImage,
	processEmailImage,
} from '#features/mail/server/email-image-proxy'
import { verifyEmailImageSource } from '#features/mail/server/email-image-sources'
import { nylas } from '#server/nylas'
import { getSession } from '#server/session'

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024
const TRANSPARENT_TRACKING_PIXEL = Uint8Array.from(
	atob(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==',
	),
	(character) => character.charCodeAt(0),
)

function requestedMode(url: URL): EmailImageMode | null {
	const mode = url.searchParams.get('mode') ?? 'automatic'
	return mode === 'automatic' || mode === 'original' ? mode : null
}

function requestedTheme(url: URL): EmailImageTheme | null {
	const theme = url.searchParams.get('theme') ?? 'light'
	return theme === 'dark' || theme === 'light' ? theme : null
}

function unavailable(): Response {
	return new Response('Image unavailable', {
		status: 404,
		headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
	})
}

function trackingResponse(): Response {
	return new Response(TRANSPARENT_TRACKING_PIXEL.slice().buffer, {
		status: 200,
		headers: {
			'Cache-Control': 'private, max-age=86400',
			'Content-Length': String(TRANSPARENT_TRACKING_PIXEL.length),
			'Content-Security-Policy': "default-src 'none'; sandbox",
			'Content-Type': 'image/png',
			'Cross-Origin-Resource-Policy': 'same-origin',
			'X-Content-Type-Options': 'nosniff',
			'X-OwnMail-Image-Class': 'tracking',
		},
	})
}

async function attachmentBytes(
	grantId: string,
	attachmentId: string,
	messageId: string,
): Promise<Uint8Array> {
	const response = await (await nylas()).forGrant(grantId).downloadAttachment(attachmentId, messageId)
	const declared = Number(response.headers.get('content-length'))
	if (!response.ok || !response.body || (Number.isFinite(declared) && declared > MAX_ATTACHMENT_BYTES)) {
		throw new Error('Image unavailable')
	}
	const bytes = new Uint8Array(await response.arrayBuffer())
	if (bytes.length > MAX_ATTACHMENT_BYTES) throw new Error('Image unavailable')
	return bytes
}

export const Route = createFileRoute('/email-images/$token')({
	server: {
		handlers: {
			GET: async ({ request, params }) => {
				const session = await getSession(request)
				if (!session) {
					return new Response('Unauthorized', {
						status: 401,
						headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
					})
				}
				const url = new URL(request.url)
				const mode = requestedMode(url)
				const theme = requestedTheme(url)
				if (!mode || !theme) {
					return new Response('Bad request', {
						status: 400,
						headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
					})
				}

				const source = await verifyEmailImageSource(params.token)
				if (!source) return unavailable()
				if (source.kind === 'remote' && source.trackingHint) return trackingResponse()

				try {
					const bytes =
						source.kind === 'remote'
							? await fetchRemoteImage(source.url, { blockedOrigin: url.origin })
							: await attachmentBytes(session.grantId, source.attachmentId, source.messageId)
					const processed = await processEmailImage(bytes, mode, theme)
					if (processed.classification === 'tracking') return trackingResponse()
					return new Response(processed.bytes.slice().buffer, {
						status: 200,
						headers: {
							'Cache-Control': 'private, max-age=3600',
							'Content-Length': String(processed.bytes.length),
							'Content-Security-Policy': "default-src 'none'; sandbox",
							'Content-Type': processed.contentType,
							'Cross-Origin-Resource-Policy': 'same-origin',
							'X-Content-Type-Options': 'nosniff',
							'X-OwnMail-Image-Class': processed.classification,
						},
					})
				} catch {
					return unavailable()
				}
			},
		},
	},
})

export const emailImageRouteHelpers = { requestedMode, requestedTheme }
