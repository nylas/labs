import {
	DashboardAccountClient,
	DashboardAccountError,
	type DashboardTokens,
	DpopKey,
	GatewayClient,
	NylasV3Client,
} from '@nylas-labs/cli-kit'
import { apiBaseUrl, dashboardAccountUrl, gatewayUrls, OWNMAIL_OAUTH_CLIENT_ID } from '../nylas-env.js'
import { readPendingSecret } from '../state/pending-secrets.js'
import type { AuthState, ProjectState } from '../state/schema.js'
import { loadAuth, saveAuth } from '../state/store.js'
import { OWNMAIL_USER_AGENT } from '../usage-attribution.js'

/** Mutable bag threaded through every step of one CLI run. */
export type StepContext = {
	project: ProjectState
	auth: AuthState | null
	dpop: DpopKey | null
	dashboard: DashboardAccountClient | null
	gateway: GatewayClient | null
	/** Set once an API key is available (from pendingSecrets on resume). */
	v3: NylasV3Client | null
}

export async function createContext(project: ProjectState): Promise<StepContext> {
	const auth = loadAuth()
	let dpop: DpopKey | null = null
	if (auth) {
		dpop = await DpopKey.fromStored({
			privateJwk: auth.dpopPrivateJwk as Parameters<typeof DpopKey.fromStored>[0]['privateJwk'],
		})
	}
	const ctx: StepContext = {
		project,
		auth,
		dpop,
		dashboard: dpop
			? new DashboardAccountClient(dpop, dashboardAccountUrl(), fetch, OWNMAIL_USER_AGENT)
			: null,
		gateway: dpop ? new GatewayClient(dpop, gatewayUrls(), fetch, OWNMAIL_USER_AGENT) : null,
		v3: null,
	}
	const apiKey = readPendingSecret(project, 'apiKey')
	if (apiKey) {
		ctx.v3 = new NylasV3Client(apiKey, project.region, fetch, apiBaseUrl(project.region), OWNMAIL_USER_AGENT)
	}
	return ctx
}

const SESSION_RENEWAL_MARGIN_MS = 60_000
const renewals = new WeakMap<StepContext, Promise<void>>()

/**
 * The session to send. An OAuth session lasts minutes and cannot be
 * refreshed, so it is renewed here, at the point of use, when it is about to
 * end — a setup run can wait on DNS for far longer than one session.
 */
export async function tokens(ctx: StepContext): Promise<DashboardTokens> {
	if (!ctx.auth) throw new Error('Not logged in — dashboard auth step must run first')
	const expiresAt = ctx.auth.oauth?.sessionExpiresAt
	if (expiresAt !== undefined && expiresAt - Date.now() < SESSION_RENEWAL_MARGIN_MS) {
		await renewSession(ctx)
	}
	return ctx.auth.orgToken
		? { userToken: ctx.auth.userToken, orgToken: ctx.auth.orgToken }
		: { userToken: ctx.auth.userToken }
}

/**
 * Exchanges a fresh access token for a new session. Concurrent callers share
 * one renewal: refresh tokens rotate, and presenting a spent one signs the
 * person out everywhere.
 */
export function renewSession(ctx: StepContext): Promise<void> {
	let renewal = renewals.get(ctx)
	if (!renewal) {
		renewal = exchangeFreshSession(ctx).finally(() => renewals.delete(ctx))
		renewals.set(ctx, renewal)
	}
	return renewal
}

async function exchangeFreshSession(ctx: StepContext): Promise<void> {
	const auth = ctx.auth
	if (!auth?.oauth) throw new Error('This Nylas session cannot be renewed.')
	const dashboard = requireDashboard(ctx)
	try {
		const refreshed = await dashboard.oauthRefresh({
			clientId: OWNMAIL_OAUTH_CLIENT_ID,
			refreshToken: auth.oauth.refreshToken,
		})
		const refreshToken = refreshed.refreshToken ?? auth.oauth.refreshToken
		// The presented token is spent now: store its successor before anything else can fail.
		setAuth(ctx, { ...auth, oauth: { ...auth.oauth, refreshToken }, updatedAt: Date.now() })
		const session = await dashboard.oauthExchange(refreshed.accessToken)
		setAuth(ctx, {
			...auth,
			userToken: session.userToken,
			orgToken: session.orgToken,
			userPublicId: session.user.publicId,
			orgPublicId: session.orgPublicId,
			oauth: { refreshToken, sessionExpiresAt: session.expiresAt },
			updatedAt: Date.now(),
		})
	} catch (err) {
		if (err instanceof DashboardAccountError && err.status < 500) {
			throw new Error('Your Nylas session expired. Run `npx ownmail auth login`, then retry.', {
				cause: err,
			})
		}
		throw err
	}
}

export function setAuth(ctx: StepContext, next: AuthState): void {
	ctx.auth = next
	saveAuth(next)
}

export function requireDashboard(ctx: StepContext): DashboardAccountClient {
	if (!ctx.dashboard) throw new Error('Dashboard client unavailable — not logged in')
	return ctx.dashboard
}

export function requireGateway(ctx: StepContext): GatewayClient {
	if (!ctx.gateway) throw new Error('Gateway client unavailable — not logged in')
	return ctx.gateway
}

export function requireV3(ctx: StepContext): NylasV3Client {
	if (!ctx.v3) throw new Error('Nylas API client unavailable — API key step must run first')
	return ctx.v3
}
