import { createFileRoute } from '@tanstack/react-router'
import { platform, usingDevMocks } from '../server/platform.js'
import { getSession } from '../server/session.js'

/** Cheap change signal: clients poll this and refetch when the number moves. */
export const Route = createFileRoute('/api/version')({
	server: {
		handlers: {
			GET: async ({ request }) => versionResponse(request),
		},
	},
})

export async function versionResponse(
	request: Request,
	options: { devMocks?: boolean } = {},
): Promise<Response> {
	if (options.devMocks ?? (await usingDevMocks())) {
		return versionJson(0)
	}

	const session = await getSession(request)
	if (!session) return new Response('Unauthorized', { status: 401 })
	const { kv } = await platform()
	// Without KV there is no webhook counter; a constant version means clients
	// simply never see a change signal (slow polling still works).
	const version = kv ? ((await kv.get(`version:${session.grantId}`)) ?? '0') : '0'
	return versionJson(Number(version))
}

function versionJson(version: number): Response {
	return Response.json({ version }, { headers: { 'Cache-Control': 'no-store' } })
}
