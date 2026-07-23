import { createFileRoute } from '@tanstack/react-router'
import { nylas } from '#server/nylas'
import { usingDevMocks } from '#server/platform'
import { getSession } from '#server/session'

export const Route = createFileRoute('/attachments/$attachmentId')({
	server: {
		handlers: {
			/**
			 * Streams an attachment download. Auth via session cookie; the grant
			 * id comes from the session, so users can only reach their own mail.
			 */
			GET: async ({ request, params }) => {
				if (await usingDevMocks()) {
					const attachment = attachmentDownloadFilename(params.attachmentId)
					return new Response(`Local mock attachment: ${attachment}\n`, {
						headers: {
							'Content-Type': 'text/plain; charset=utf-8',
							/* v8 ignore next -- attachmentDownloadFilename always returns a non-empty string (falls back to 'attachment'), so the || 'attachment' guard is unreachable -- @preserve */
							'Content-Disposition': `attachment; filename="${attachment || 'attachment'}.txt"`,
							'Cache-Control': 'no-store',
						},
					})
				}
				const session = await getSession(request)
				if (!session) return new Response('Unauthorized', { status: 401 })

				const url = new URL(request.url)
				const messageId = url.searchParams.get('message_id')
				if (
					!validNylasAttachmentDownloadId(messageId) ||
					!validNylasAttachmentDownloadId(params.attachmentId)
				) {
					return new Response('Bad request', { status: 400 })
				}

				const upstream = await (await nylas())
					.forGrant(session.grantId)
					.downloadAttachment(params.attachmentId, messageId)
				if (!upstream.ok || !upstream.body) {
					return new Response('Attachment unavailable', { status: 404 })
				}
				const headers = new Headers()
				headers.set('Content-Type', upstream.headers.get('Content-Type') ?? 'application/octet-stream')
				const disposition = upstream.headers.get('Content-Disposition')
				headers.set('Content-Disposition', disposition ?? 'attachment')
				headers.set('Cache-Control', 'no-store')
				return new Response(upstream.body, { status: 200, headers })
			},
		},
	},
})

export function validNylasAttachmentDownloadId(value: string | null | undefined): value is string {
	if (!value || value.length > 1000) return false
	for (const char of value) {
		if (char.charCodeAt(0) < 32) return false
	}
	return true
}

export function attachmentDownloadFilename(attachmentId: string): string {
	const safe = [...attachmentId]
		.map((char) => {
			const code = char.charCodeAt(0)
			return code < 32 || char === '"' || char === '/' || char === '\\' ? '_' : char
		})
		.join('')
		.trim()
	return hasMeaningfulFilenameChar(safe) ? safe : 'attachment'
}

function hasMeaningfulFilenameChar(value: string): boolean {
	for (const char of value) {
		if (/[A-Za-z0-9]/.test(char)) return true
	}
	return false
}
