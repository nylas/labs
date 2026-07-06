import {
	DashboardAccountClient,
	type DashboardTokens,
	DpopKey,
	GatewayClient,
	NylasV3Client,
} from '@nylas-labs/cli-kit'
import type { AuthState, ProjectState } from '../state/schema.js'
import { loadAuth, saveAuth } from '../state/store.js'

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
		dashboard: dpop ? new DashboardAccountClient(dpop) : null,
		gateway: dpop ? new GatewayClient(dpop) : null,
		v3: null,
	}
	if (project.pendingSecrets.apiKey) {
		ctx.v3 = new NylasV3Client(project.pendingSecrets.apiKey, project.region)
	}
	return ctx
}

export function tokens(ctx: StepContext): DashboardTokens {
	if (!ctx.auth) throw new Error('Not logged in — dashboard auth step must run first')
	return ctx.auth.orgToken
		? { userToken: ctx.auth.userToken, orgToken: ctx.auth.orgToken }
		: { userToken: ctx.auth.userToken }
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
