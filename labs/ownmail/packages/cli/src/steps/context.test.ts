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
	}
})

const { FakeDashboardAccountClient, FakeGatewayClient, FakeNylasV3Client } = hoisted

vi.mock('@nylas-labs/cli-kit', () => ({
	DpopKey: { fromStored: hoisted.fromStored },
	DashboardAccountClient: hoisted.FakeDashboardAccountClient,
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

import { loadAuth, saveAuth } from '../state/store.js'
import { createContext, requireDashboard, requireGateway, requireV3, setAuth, tokens } from './context.js'

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
	it('throws when not logged in', () => {
		mockLoadAuth.mockReturnValue(null)
		expect(() => tokens({ auth: null } as never)).toThrow('Not logged in')
	})

	it('returns only the user token when there is no org token', () => {
		expect(tokens({ auth } as never)).toEqual({ userToken: 'user-tok' })
	})

	it('includes the org token when present', () => {
		expect(tokens({ auth: { ...auth, orgToken: 'org-tok' } } as never)).toEqual({
			userToken: 'user-tok',
			orgToken: 'org-tok',
		})
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
