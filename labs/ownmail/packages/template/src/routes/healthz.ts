import { createFileRoute } from '@tanstack/react-router'
import { platform } from '../server/platform.js'

export const Route = createFileRoute('/healthz')({
	server: {
		handlers: {
			GET: async () => {
				const { env, kv } = await platform()
				return Response.json({
					ok: true,
					app: env.APP_NAME,
					templateVersion: env.TEMPLATE_VERSION,
					sessions: kv ? 'kv' : 'stateless',
				})
			},
		},
	},
})
