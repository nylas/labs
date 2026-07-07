import { resolveV3BaseUrl } from '@nylas-labs/cli-kit/v3'
import { createFileRoute } from '@tanstack/react-router'
import { platform, usingDevMocks } from '../server/platform.js'
import { getSession } from '../server/session.js'

export const Route = createFileRoute('/attachments/$attachmentId')({
	server: {
		handlers: {
			/**
			 * Streams an attachment download. Auth via session cookie; the grant
			 * id comes from the session, so users can only reach their own mail.
			 */
			GET: async ({ request, params }) => {
				const { env } = await platform()
				if (await usingDevMocks()) {
					const attachment = params.attachmentId.replace(/[^\w=-]/g, '')
					return new Response(`Local mock attachment: ${attachment}\n`, {
						headers: {
							'Content-Type': 'text/plain; charset=utf-8',
							'Content-Disposition': `attachment; filename="${attachment || 'attachment'}.txt"`,
							'Cache-Control': 'no-store',
						},
					})
				}
				const session = await getSession(request)
				if (!session) return new Response('Unauthorized', { status: 401 })

				const url = new URL(request.url)
				const messageId = url.searchParams.get('message_id')
				if (!messageId || !/^[\w=-]+$/.test(messageId) || !/^[\w=-]+$/.test(params.attachmentId)) {
					return new Response('Bad request', { status: 400 })
				}

				const upstream = await fetch(
					`${resolveV3BaseUrl(env.NYLAS_REGION, env.NYLAS_API_BASE_URL)}/v3/grants/${encodeURIComponent(session.grantId)}/attachments/${encodeURIComponent(
						params.attachmentId,
					)}/download?message_id=${encodeURIComponent(messageId)}`,
					{ headers: { Authorization: `Bearer ${env.NYLAS_API_KEY}` } },
				)
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
