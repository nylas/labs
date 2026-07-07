import { type GrantScopedClient, NylasV3Client } from '@nylas-labs/cli-kit/v3'
import { platform } from './platform.js'
import { getSession } from './session.js'

let client: NylasV3Client | null = null

export async function nylas(): Promise<NylasV3Client> {
	if (!client) {
		const { env } = await platform()
		client = new NylasV3Client(env.NYLAS_API_KEY, env.NYLAS_REGION, fetch, env.NYLAS_API_BASE_URL)
	}
	return client
}

/** Resolves the caller's mailbox from the session cookie — the only path to a grant id. */
export async function mailboxFromRequest(
	request: Request,
): Promise<{ mailbox: GrantScopedClient; email: string } | null> {
	const session = await getSession(request)
	if (!session) return null
	return { mailbox: (await nylas()).forGrant(session.grantId), email: session.email }
}
