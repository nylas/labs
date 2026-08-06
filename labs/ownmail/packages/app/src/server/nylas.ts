import { type GrantScopedClient, NylasV3Client } from '@nylas-labs/cli-kit/v3'
import { createDevMailbox, devMailboxEmail, devMailboxName } from './dev-mocks.js'
import { platform, usingDevMocks } from './platform.js'
import { getSession, slideSessionExpiry } from './session.js'
import { OWNMAIL_USER_AGENT } from './usage-attribution.js'

let client: NylasV3Client | null = null

export async function nylas(): Promise<NylasV3Client> {
	if (!client) {
		const { env } = await platform()
		client = new NylasV3Client(
			env.NYLAS_API_KEY,
			env.NYLAS_REGION,
			fetch,
			env.NYLAS_API_BASE_URL,
			OWNMAIL_USER_AGENT,
		)
	}
	return client
}

/** Resolves the caller's mailbox from the session cookie — the only path to a grant id. */
export async function mailboxFromRequest(request: Request): Promise<{
	mailbox: GrantScopedClient | ReturnType<typeof createDevMailbox>
	grantId: string
	email: string
	displayName?: string
	/** Set-Cookie value the caller must send when activity slid the session deadline. */
	refreshCookie?: string
} | null> {
	const { env } = await platform()
	if (await usingDevMocks()) {
		const displayName = devMailboxName(env.INBOX_EMAIL)
		return {
			mailbox: createDevMailbox(),
			grantId: 'dev-grant',
			email: devMailboxEmail(env.INBOX_EMAIL),
			...(displayName ? { displayName } : {}),
		}
	}
	const session = await getSession(request)
	if (!session) return null
	const refreshCookie = await slideSessionExpiry(request, session)
	return {
		mailbox: (await nylas()).forGrant(session.grantId),
		grantId: session.grantId,
		email: session.email,
		...(refreshCookie ? { refreshCookie } : {}),
	}
}
