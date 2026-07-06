/**
 * Client for the Nylas dashboard-account service:
 * - CLI SSO device-authorization flow (login/register)
 * - session management (current, switch-org, refresh, logout)
 * - inbox domains REST (/orgs/inbox/domains/*)
 *
 * All authenticated requests carry `Authorization: Bearer <userToken>`,
 * `X-Nylas-Org: <orgToken>`, and a per-request DPoP proof header.
 */

import type { DpopKey } from './dpop.js'

export const DEFAULT_DASHBOARD_ACCOUNT_URL = 'https://dashboard-account.eu.nylas.com'

export type SsoLoginType = 'google_SSO' | 'microsoft_SSO' | 'github_SSO'
export type SsoMode = 'login' | 'register'

export type DashboardTokens = {
	userToken: string
	orgToken?: string
}

export type DashboardUser = {
	publicId: string
	emailAddress?: string
	firstName?: string
	lastName?: string
}

export type DashboardOrganization = {
	publicId: string
	name?: string
	region?: string
	role?: string
}

export type SsoStartResponse = {
	flowId: string
	verificationUri: string
	verificationUriComplete?: string
	userCode: string
	expiresIn: number
	interval: number
}

export type AuthResponse = {
	userToken: string
	orgToken: string
	user: DashboardUser
	organizations: DashboardOrganization[]
}

export type SsoPollResponse =
	| { status: 'authorization_pending' | 'access_denied' | 'expired_token'; retryAfter?: number }
	| ({ status: 'complete' } & AuthResponse)
	| { status: 'mfa_required'; user: DashboardUser; organizations: DashboardOrganization[] }

export type SessionResponse = {
	user: DashboardUser
	organization?: DashboardOrganization
	organizations?: DashboardOrganization[]
}

export type InboxDomain = {
	id: string
	name: string
	domainAddress: string
	organizationId: string
	region: 'us' | 'eu'
	branded: boolean
	verifiedOwnership: boolean
	verifiedMx: boolean
	verifiedSpf: boolean
	verifiedDkim: boolean
	verifiedDmarc: boolean
	verifiedArc: boolean
	verifiedFeedback: boolean
	createdAt: number
	updatedAt: number
}

export type DomainAvailability = {
	domainAddress: string
	available: boolean
	conflictsWith: 'us' | 'eu' | null
}

export type DomainVerificationResult = {
	domainId?: string
	attempt: {
		type?: string
		options: { host?: string; type?: string; value?: string }
	} | null
	status: string
	createdAt?: number
	expiresAt?: number
	message: string
}

type Envelope<T> = { request_id: string; success: boolean; data: T }

export class DashboardAccountError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly body: unknown,
	) {
		super(message)
		this.name = 'DashboardAccountError'
	}
}

export class DashboardAccountClient {
	constructor(
		private readonly dpop: DpopKey,
		private readonly baseUrl: string = DEFAULT_DASHBOARD_ACCOUNT_URL,
		private readonly fetchImpl: typeof fetch = fetch,
	) {}

	// ---- CLI SSO device flow -------------------------------------------------

	async ssoStart(input: {
		loginType: SsoLoginType
		mode: SsoMode
		privacyPolicyAccepted?: boolean
	}): Promise<SsoStartResponse> {
		const body: Record<string, unknown> = { loginType: input.loginType, mode: input.mode }
		if (input.mode === 'register') {
			body.privacyPolicyAccepted = input.privacyPolicyAccepted ?? true
		}
		return this.request('POST', '/auth/cli/sso/start', { body })
	}

	async ssoPoll(input: { flowId: string; orgPublicId?: string }): Promise<SsoPollResponse> {
		const body: Record<string, unknown> = { flowId: input.flowId }
		if (input.orgPublicId) body.orgPublicId = input.orgPublicId
		return this.request('POST', '/auth/cli/sso/poll', { body })
	}

	/**
	 * Runs the full device flow: start, hand the verification URL to the
	 * caller (open a browser, print the code), then poll until terminal.
	 */
	async ssoAuthorize(
		input: { loginType: SsoLoginType; mode: SsoMode; orgPublicId?: string },
		onStarted: (started: SsoStartResponse) => void | Promise<void>,
		signal?: AbortSignal,
	): Promise<SsoPollResponse> {
		const started = await this.ssoStart({ ...input, privacyPolicyAccepted: true })
		await onStarted(started)

		const deadline = Date.now() + started.expiresIn * 1000
		let intervalMs = Math.max(started.interval, 1) * 1000
		while (Date.now() < deadline) {
			if (signal?.aborted) throw new Error('SSO flow aborted')
			await new Promise((r) => setTimeout(r, intervalMs))
			const poll = await this.ssoPoll({
				flowId: started.flowId,
				...(input.orgPublicId ? { orgPublicId: input.orgPublicId } : {}),
			})
			if (poll.status !== 'authorization_pending') return poll
			if (poll.retryAfter) intervalMs = poll.retryAfter * 1000
		}
		return { status: 'expired_token' }
	}

	// ---- Sessions --------------------------------------------------------------

	async refresh(tokens: DashboardTokens): Promise<{ userToken: string; orgToken?: string }> {
		return this.request('POST', '/auth/cli/refresh', { tokens })
	}

	async logout(tokens: DashboardTokens): Promise<void> {
		await this.request('POST', '/auth/cli/logout', { tokens })
	}

	async currentSession(tokens: DashboardTokens): Promise<SessionResponse> {
		return this.request('GET', '/sessions/current', { tokens })
	}

	async switchOrg(tokens: DashboardTokens, orgPublicId: string): Promise<AuthResponse> {
		return this.request('POST', '/sessions/switch-org', { tokens, body: { orgPublicId } })
	}

	// ---- Inbox domains (org-level, aggregated in dashboard-account) -----------

	async listInboxDomains(
		tokens: DashboardTokens,
		query?: { limit?: number; pageToken?: string },
	): Promise<InboxDomain[]> {
		const params = new URLSearchParams()
		if (query?.limit) params.set('limit', String(query.limit))
		if (query?.pageToken) params.set('pageToken', query.pageToken)
		const qs = params.size ? `?${params}` : ''
		return this.requestEnveloped('GET', `/orgs/inbox/domains${qs}`, { tokens })
	}

	async domainAvailability(tokens: DashboardTokens, domainAddress: string): Promise<DomainAvailability> {
		const qs = new URLSearchParams({ domainAddress })
		return this.requestEnveloped('GET', `/orgs/inbox/domains/availability?${qs}`, { tokens })
	}

	async createInboxDomain(
		tokens: DashboardTokens,
		input: { name: string; domainAddress: string; region: 'us' | 'eu' },
	): Promise<InboxDomain> {
		return this.requestEnveloped('POST', '/orgs/inbox/domains', { tokens, body: input })
	}

	async getInboxDomain(
		tokens: DashboardTokens,
		domainIdOrAddress: string,
		region?: 'us' | 'eu',
	): Promise<InboxDomain> {
		const qs = region ? `?${new URLSearchParams({ region })}` : ''
		return this.requestEnveloped('GET', `/orgs/inbox/domains/${encodeURIComponent(domainIdOrAddress)}${qs}`, {
			tokens,
		})
	}

	/** Returns the DNS record the customer must publish for one verification type. */
	async domainInfo(
		tokens: DashboardTokens,
		domainId: string,
		query: { region: 'us' | 'eu'; type: string },
	): Promise<DomainVerificationResult> {
		const qs = new URLSearchParams(query)
		return this.requestEnveloped('GET', `/orgs/inbox/domains/${encodeURIComponent(domainId)}/info?${qs}`, {
			tokens,
		})
	}

	/** Runs one verification attempt (type: ownership | mx | spf | dkim | feedback | dmarc). */
	async verifyDomain(
		tokens: DashboardTokens,
		domainId: string,
		input: { type: string },
		region: 'us' | 'eu',
	): Promise<DomainVerificationResult> {
		const qs = new URLSearchParams({ region })
		return this.requestEnveloped('POST', `/orgs/inbox/domains/${encodeURIComponent(domainId)}/verify?${qs}`, {
			tokens,
			body: input,
		})
	}

	async deleteInboxDomain(tokens: DashboardTokens, domainId: string, region: 'us' | 'eu'): Promise<void> {
		const qs = new URLSearchParams({ region })
		await this.requestEnveloped('DELETE', `/orgs/inbox/domains/${encodeURIComponent(domainId)}?${qs}`, {
			tokens,
		})
	}

	// ---- HTTP core -------------------------------------------------------------

	private async request<T>(
		method: string,
		path: string,
		opts: { tokens?: DashboardTokens; body?: unknown },
	): Promise<T> {
		const url = `${this.baseUrl}${path}`
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
			DPoP: await this.dpop.proof(method, url, opts.tokens?.userToken),
		}
		if (opts.tokens) {
			headers.Authorization = `Bearer ${opts.tokens.userToken}`
			if (opts.tokens.orgToken) headers['X-Nylas-Org'] = opts.tokens.orgToken
		}

		const res = await this.fetchImpl(url, {
			method,
			headers,
			body: opts.body === undefined ? null : JSON.stringify(opts.body),
			redirect: 'error',
		})

		const text = await res.text()
		let parsed: unknown = null
		try {
			parsed = text ? JSON.parse(text) : null
		} catch {
			parsed = text
		}
		if (!res.ok) {
			throw new DashboardAccountError(
				`dashboard-account ${method} ${path} failed with ${res.status}`,
				res.status,
				parsed,
			)
		}
		return parsed as T
	}

	/** Unwraps the `{request_id, success, data}` envelope used by REST routes. */
	private async requestEnveloped<T>(
		method: string,
		path: string,
		opts: { tokens?: DashboardTokens; body?: unknown },
	): Promise<T> {
		const envelope = await this.request<Envelope<T>>(method, path, opts)
		return envelope.data
	}
}
