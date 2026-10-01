import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthState, ProjectState } from '../state/schema.js'

/**
 * createContext wires the persisted auth + per-project secrets into the client
 * objects every step depends on. The require* helpers are the guardrails that
 * turn "not logged in yet" into a clear error instead of a null dereference
 * deep inside a step, so both the wired and the missing paths are asserted.
 */

const hoisted = vi.hoisted(() => {
	class FakeDashboardAccountClient {
		constructor(
			public dpop: unknown,
			public url: unknown,
		) {}
	}
	class FakeGatewayClient {
		constructor(
			public dpop: unknown,
			public urls: unknown,
		) {}
	}
	class FakeNylasV3Client {
		constructor(
			public apiKey: string,
			public region: string,
			public fetchImpl: unknown,
			public baseUrl: unknown,
		) {}
	}
	return {
		dpopKey: { id: 'fake-dpop' },
		fromStored: vi.fn(),
		FakeDashboardAccountClient,
		FakeGatewayClient,
		FakeNylasV3Client,
		FakeDashboardAccountError: class FakeDashboardAccountError extends Error {
			constructor(public status: number) {
				super('dashboard-account failed')
			}
		},
	}
})

const { FakeDashboardAccountClient, FakeDashboardAccountError, FakeGatewayClient, FakeNylasV3Client } =
	hoisted

vi.mock('@nylas-labs/cli-kit', () => ({
	DpopKey: { fromStored: hoisted.fromStored },
	DashboardAccountClient: hoisted.FakeDashboardAccountClient,
	DashboardAccountError: hoisted.FakeDashboardAccountError,
	GatewayClient: hoisted.FakeGatewayClient,
	NylasV3Client: hoisted.FakeNylasV3Client,
	// nylas-env.ts (imported transitively) needs these constants.
	GATEWAY_URLS: { us: 'https://gw.us', eu: 'https://gw.eu' },
	V3_URLS: { us: 'https://v3.us', eu: 'https://v3.eu' },
}))

vi.mock('../state/store.js', () => ({
	loadAuth: vi.fn(),
	saveAuth: vi.fn(),
}))

import { OWNMAIL_OAUTH_CLIENT_ID } from '../nylas-env.js'
import { loadAuth, saveAuth } from '../state/store.js'
import {
	createContext,
	renewSession,
	requireDashboard,
	requireGateway,
	requireV3,
	setAuth,
	tokens,
} from './context.js'

const mockLoadAuth = vi.mocked(loadAuth)
const mockSaveAuth = vi.mocked(saveAuth)

function project(overrides: Partial<ProjectState> = {}): ProjectState {
	return {
		slug: 'inbox',
		createdAt: 1,
		updatedAt: 1,
		region: 'us',
		ejected: false,
		completedSteps: [],
		pendingSecrets: {},
		...overrides,
	}
}

const auth: AuthState = {
	userToken: 'user-tok',
	dpopPrivateJwk: { kty: 'EC' },
	updatedAt: 1,
}

beforeEach(() => {
	vi.clearAllMocks()
	hoisted.fromStored.mockResolvedValue(hoisted.dpopKey)
})

describe('createContext', () => {
	it('builds dashboard, gateway and v3 clients when auth and an api key exist', async () => {
		mockLoadAuth.mockReturnValue(auth)
		const ctx = await createContext(project({ pendingSecrets: { apiKey: 'k' } }))
		expect(hoisted.fromStored).toHaveBeenCalledWith({ privateJwk: auth.dpopPrivateJwk })
		expect(ctx.dpop).toBe(hoisted.dpopKey)
		expect(ctx.dashboard).toBeInstanceOf(FakeDashboardAccountClient)
		expect(ctx.gateway).toBeInstanceOf(FakeGatewayClient)
		expect(ctx.v3).toBeInstanceOf(FakeNylasV3Client)
		expect((ctx.v3 as FakeNylasV3Client).apiKey).toBe('k')
	})

	it('leaves clients null when there is no auth', async () => {
		mockLoadAuth.mockReturnValue(null)
		const ctx = await createContext(project())
		expect(hoisted.fromStored).not.toHaveBeenCalled()
		expect(ctx.auth).toBeNull()
		expect(ctx.dpop).toBeNull()
		expect(ctx.dashboard).toBeNull()
		expect(ctx.gateway).toBeNull()
		expect(ctx.v3).toBeNull()
	})

	it('leaves v3 null when no api key is pending', async () => {
		mockLoadAuth.mockReturnValue(auth)
		const ctx = await createContext(project())
		expect(ctx.v3).toBeNull()
	})
})

describe('tokens', () => {
	it('throws when not logged in', async () => {
		mockLoadAuth.mockReturnValue(null)
		await expect(tokens({ auth: null } as never)).rejects.toThrow('Not logged in')
	})

	it('returns only the user token when there is no org token', async () => {
		await expect(tokens({ auth } as never)).resolves.toEqual({ userToken: 'user-tok' })
	})

	it('includes the org token when present', async () => {
		await expect(tokens({ auth: { ...auth, orgToken: 'org-tok' } } as never)).resolves.toEqual({
			userToken: 'user-tok',
			orgToken: 'org-tok',
		})
	})
})

describe('OAuth session renewal', () => {
	const exchanged = {
		userToken: 'user-2',
		orgToken: 'org-2',
		user: { publicId: 'user-pub' },
		orgPublicId: 'org-pub',
		expiresAt: Date.now() + 900_000,
	}

	function oauthCtx(sessionExpiresAt: number, dashboard: Record<string, unknown>) {
		return {
			auth: { ...auth, orgToken: 'org-1', oauth: { refreshToken: 'refresh-1', sessionExpiresAt } },
			dashboard,
		} as unknown as Parameters<typeof tokens>[0]
	}

	it('sends a session that still has time left without contacting the server', async () => {
		const oauthRefresh = vi.fn()
		const ctx = oauthCtx(Date.now() + 5 * 60_000, { oauthRefresh })

		await expect(tokens(ctx)).resolves.toEqual({ userToken: 'user-tok', orgToken: 'org-1' })
		expect(oauthRefresh).not.toHaveBeenCalled()
	})

	it('exchanges a fresh access token when the session is about to end', async () => {
		// An exchanged session cannot be refreshed, and a DNS wait outlives it: without
		// this every long setup would fail with an expired session.
		const oauthRefresh = vi.fn().mockResolvedValue({ accessToken: 'access-2', refreshToken: 'refresh-2' })
		const oauthExchange = vi.fn().mockResolvedValue(exchanged)
		const ctx = oauthCtx(Date.now() + 30_000, { oauthRefresh, oauthExchange })

		await expect(tokens(ctx)).resolves.toEqual({ userToken: 'user-2', orgToken: 'org-2' })

		expect(oauthRefresh).toHaveBeenCalledWith({
			clientId: OWNMAIL_OAUTH_CLIENT_ID,
			refreshToken: 'refresh-1',
		})
		expect(oauthExchange).toHaveBeenCalledWith('access-2')
		expect(mockSaveAuth).toHaveBeenLastCalledWith(
			expect.objectContaining({
				userToken: 'user-2',
				orgPublicId: 'org-pub',
				userPublicId: 'user-pub',
				oauth: { refreshToken: 'refresh-2', sessionExpiresAt: exchanged.expiresAt },
			}),
		)
	})

	it('stores the rotated refresh token before the exchange can fail', async () => {
		// The old token is spent once the server answers. Losing its successor would
		// sign the person out, and replaying the old one revokes the whole family.
		const oauthRefresh = vi.fn().mockResolvedValue({ accessToken: 'access-2', refreshToken: 'refresh-2' })
		const oauthExchange = vi.fn().mockRejectedValue(new Error('network down'))
		const ctx = oauthCtx(0, { oauthRefresh, oauthExchange })

		await expect(tokens(ctx)).rejects.toThrow('network down')

		expect(mockSaveAuth).toHaveBeenCalledTimes(1)
		expect(mockSaveAuth).toHaveBeenCalledWith(
			expect.objectContaining({
				userToken: 'user-tok',
				oauth: { refreshToken: 'refresh-2', sessionExpiresAt: 0 },
			}),
		)
	})

	it('keeps the current refresh token when the server does not rotate it', async () => {
		const oauthRefresh = vi.fn().mockResolvedValue({ accessToken: 'access-2' })
		const oauthExchange = vi.fn().mockResolvedValue(exchanged)
		const ctx = oauthCtx(0, { oauthRefresh, oauthExchange })

		await tokens(ctx)

		expect(ctx.auth?.oauth?.refreshToken).toBe('refresh-1')
	})

	it('shares one renewal between concurrent callers', async () => {
		// Two refreshes with the same token trip reuse detection and end the sign-in.
		const oauthRefresh = vi.fn().mockResolvedValue({ accessToken: 'access-2', refreshToken: 'refresh-2' })
		const oauthExchange = vi.fn().mockResolvedValue(exchanged)
		const ctx = oauthCtx(0, { oauthRefresh, oauthExchange })

		await Promise.all([tokens(ctx), tokens(ctx), renewSession(ctx)])

		expect(oauthRefresh).toHaveBeenCalledTimes(1)
	})

	it('tells the person to sign in again when the server refuses the refresh token', async () => {
		const oauthRefresh = vi.fn().mockRejectedValue(new FakeDashboardAccountError(400))
		const ctx = oauthCtx(0, { oauthRefresh })

		await expect(tokens(ctx)).rejects.toThrow(/npx ownmail auth login/)
	})

	it('reports a server outage as itself, not as an expired sign-in', async () => {
		const outage = new FakeDashboardAccountError(503)
		const ctx = oauthCtx(0, { oauthRefresh: vi.fn().mockRejectedValue(outage) })

		await expect(tokens(ctx)).rejects.toBe(outage)
	})

	it('refuses to renew a session that did not come from OAuth', async () => {
		await expect(renewSession({ auth, dashboard: {} } as never)).rejects.toThrow(/cannot be renewed/)
		await expect(renewSession({ auth: null, dashboard: {} } as never)).rejects.toThrow(/cannot be renewed/)
	})
})

describe('setAuth', () => {
	it('updates the context and persists the auth state', () => {
		const ctx = { auth: null } as never
		setAuth(ctx, auth)
		expect((ctx as { auth: AuthState }).auth).toBe(auth)
		expect(mockSaveAuth).toHaveBeenCalledWith(auth)
	})
})

describe('require* guards', () => {
	it('return the client when present', () => {
		const dashboard = {} as never
		const gateway = {} as never
		const v3 = {} as never
		expect(requireDashboard({ dashboard } as never)).toBe(dashboard)
		expect(requireGateway({ gateway } as never)).toBe(gateway)
		expect(requireV3({ v3 } as never)).toBe(v3)
	})

	it('throw a clear error when the client is missing', () => {
		expect(() => requireDashboard({ dashboard: null } as never)).toThrow('Dashboard client')
		expect(() => requireGateway({ gateway: null } as never)).toThrow('Gateway client')
		expect(() => requireV3({ v3: null } as never)).toThrow('Nylas API client')
	})
})
