import { createFileRoute } from '@tanstack/react-router'
import { type ChangeVersions, readChangeVersions } from '../server/change-version.js'
import { platform, usingDevMocks } from '../server/platform.js'
import { getSession } from '../server/session.js'

/** Cheap scoped change signal: clients poll this and refetch domains whose counter moved. */
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
		return versionJson({ version: 0, domains: { mail: 0, contacts: 0, calendar: 0 } })
	}

	const session = await getSession(request)
	if (!session) return new Response('Unauthorized', { status: 401 })
	const { kv } = await platform()
	return versionJson(await readChangeVersions(kv, session.grantId))
}

function versionJson(version: ChangeVersions): Response {
	return Response.json(version, { headers: { 'Cache-Control': 'no-store' } })
}
