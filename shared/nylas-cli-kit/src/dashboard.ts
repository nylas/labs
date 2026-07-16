/**
 * Client for the Nylas dashboard-account service:
 * - CLI email/password and SSO device-authorization flows
 * - session management (current, switch-org, refresh, logout)
 * - inbox domains REST (/orgs/inbox/domains/*)
 *
 * All authenticated requests carry `Authorization: Bearer <userToken>`,
 * `X-Nylas-Org: <orgToken>`, and a per-request DPoP proof header.
 */

import type { DpopKey } from './dpop.js'
import { userAgentHeader } from './http.js'

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

export type PasswordLoginResponse =
	| ({ status: 'complete' } & AuthResponse)
	| {
			status: 'mfa_required'
			user: DashboardUser
			organizations: DashboardOrganization[]
	  }

export type OrgSwitchResponse = {
	orgToken: string
	orgSessionId: string
	org: DashboardOrganization
	previousOrgSessionRevoked: boolean
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
type JsonRecord = Record<string, unknown>
const DEFAULT_HTTP_TIMEOUT_MS = 30_000

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
	private readonly attributionHeaders: Record<string, string>

	constructor(
		private readonly dpop: DpopKey,
		private readonly baseUrl: string = DEFAULT_DASHBOARD_ACCOUNT_URL,
		private readonly fetchImpl: typeof fetch = fetch,
		userAgent?: string,
	) {
		this.attributionHeaders = userAgentHeader(userAgent)
	}

	// ---- CLI email/password flow ---------------------------------------------

	async loginWithPassword(input: {
		email: string
		password: string
		orgPublicId?: string
	}): Promise<PasswordLoginResponse> {
		const body: Record<string, unknown> = {
			email: input.email,
			password: input.password,
		}
		if (input.orgPublicId) body.orgPublicId = input.orgPublicId
		const data = await this.requestEnveloped<unknown>('POST', '/auth/cli/login', { body })
		return parsePasswordLoginResponse(data, '/auth/cli/login')
	}

	async completeMfaLogin(input: {
		userPublicId: string
		code: string
		orgPublicId?: string
	}): Promise<AuthResponse> {
		const body: Record<string, unknown> = {
			userPublicId: input.userPublicId,
			code: input.code,
		}
		if (input.orgPublicId) body.orgPublicId = input.orgPublicId
		const data = await this.requestEnveloped<unknown>('POST', '/auth/cli/login/mfa', { body })
		return parseAuthResponse(data, '/auth/cli/login/mfa')
	}

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
		const data = await this.requestEnveloped<unknown>('POST', '/auth/cli/sso/start', { body })
		return parseSsoStartResponse(data, '/auth/cli/sso/start')
	}

	async ssoPoll(input: { flowId: string; orgPublicId?: string }): Promise<SsoPollResponse> {
		const body: Record<string, unknown> = { flowId: input.flowId }
		if (input.orgPublicId) body.orgPublicId = input.orgPublicId
		const data = await this.requestEnveloped<unknown>('POST', '/auth/cli/sso/poll', { body })
		return parseSsoPollResponse(data, '/auth/cli/sso/poll')
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
		const data = await this.requestEnveloped<unknown>('POST', '/auth/cli/refresh', { tokens })
		return parseRefreshResponse(data, '/auth/cli/refresh')
	}

	async logout(tokens: DashboardTokens): Promise<void> {
		await this.requestEnveloped<unknown>('POST', '/auth/cli/logout', { tokens })
	}

	async currentSession(tokens: DashboardTokens): Promise<SessionResponse> {
		const data = await this.requestEnveloped<unknown>('GET', '/sessions/current', { tokens })
		return parseSessionResponse(data, '/sessions/current')
	}

	async switchOrg(tokens: DashboardTokens, orgPublicId: string): Promise<OrgSwitchResponse> {
		const data = await this.requestEnveloped<unknown>('POST', '/sessions/switch-org', {
			tokens,
			body: { orgPublicId },
		})
		return parseOrgSwitchResponse(data, '/sessions/switch-org')
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
			...this.attributionHeaders,
			DPoP: await this.dpop.proof(method, url, opts.tokens?.userToken),
		}
		if (opts.tokens) {
			headers.Authorization = `Bearer ${opts.tokens.userToken}`
			if (opts.tokens.orgToken) headers['X-Nylas-Org'] = opts.tokens.orgToken
		}

		const res = await fetchWithTimeout(
			this.fetchImpl,
			url,
			{
				method,
				headers,
				body: opts.body === undefined ? null : JSON.stringify(opts.body),
				redirect: 'error',
			},
			`dashboard-account ${method} ${path}`,
		)

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
		const envelope = unwrapEnvelope<T>(await this.request<unknown>(method, path, opts), path)
		return envelope.data
	}
}

function unwrapEnvelope<T>(value: unknown, path: string): Envelope<T> {
	if (isRecord(value) && value.success === true && 'data' in value) {
		return value as Envelope<T>
	}
	throw new Error(`dashboard-account ${path} returned a malformed response`)
}

function parseSsoStartResponse(value: unknown, path: string): SsoStartResponse {
	if (!isRecord(value)) throw new Error(`dashboard-account ${path} returned a malformed response`)

	const flowId = readString(value, 'flowId', path)
	const verificationUri = readUrl(value, 'verificationUri', path)
	const verificationUriComplete = readOptionalUrl(value, 'verificationUriComplete', path)
	const userCode = readString(value, 'userCode', path)
	const expiresIn = readPositiveNumber(value, 'expiresIn', path)
	const interval = readPositiveNumber(value, 'interval', path)

	return {
		flowId,
		verificationUri,
		...(verificationUriComplete ? { verificationUriComplete } : {}),
		userCode,
		expiresIn,
		interval,
	}
}

function parseSsoPollResponse(value: unknown, path: string): SsoPollResponse {
	if (!isRecord(value)) throw new Error(`dashboard-account ${path} returned a malformed response`)

	const status = readString(value, 'status', path)
	if (status === 'authorization_pending') {
		const retryAfter = readOptionalPositiveNumber(value, 'retryAfter', path)
		return retryAfter ? { status, retryAfter } : { status }
	}
	if (status === 'access_denied' || status === 'expired_token') return { status }
	if (status === 'mfa_required') {
		return {
			status,
			user: parseDashboardUser(value.user, path),
			organizations: parseOrganizations(value.organizations, path),
		}
	}
	if (status === 'complete') {
		return { status, ...parseAuthResponse(value, path) }
	}

	throw new Error(`dashboard-account ${path} returned an unknown SSO status`)
}

function parsePasswordLoginResponse(value: unknown, path: string): PasswordLoginResponse {
	if (!isRecord(value)) throw new Error(`dashboard-account ${path} returned a malformed response`)
	if ('totpFactor' in value) {
		if (!isRecord(value.totpFactor)) {
			throw new Error(`dashboard-account ${path} returned a malformed response`)
		}
		return {
			status: 'mfa_required',
			user: parseDashboardUser(value.user, path),
			organizations: parseOrganizations(value.organizations, path),
		}
	}
	return { status: 'complete', ...parseAuthResponse(value, path) }
}

function parseAuthResponse(value: unknown, path: string): AuthResponse {
	if (!isRecord(value)) throw new Error(`dashboard-account ${path} returned a malformed response`)
	return {
		userToken: readString(value, 'userToken', path),
		orgToken: readString(value, 'orgToken', path),
		user: parseDashboardUser(value.user, path),
		organizations: parseOrganizations(value.organizations ?? value.relations, path),
	}
}

function parseRefreshResponse(value: unknown, path: string): { userToken: string; orgToken?: string } {
	if (!isRecord(value)) throw new Error(`dashboard-account ${path} returned a malformed response`)
	const orgToken = readOptionalString(value, 'orgToken')
	return {
		userToken: readString(value, 'userToken', path),
		...(orgToken ? { orgToken } : {}),
	}
}

function parseOrgSwitchResponse(value: unknown, path: string): OrgSwitchResponse {
	if (!isRecord(value)) throw new Error(`dashboard-account ${path} returned a malformed response`)
	return {
		orgToken: readString(value, 'orgToken', path),
		orgSessionId: readString(value, 'orgSessionId', path),
		org: parseOrganization(value.org, path),
		previousOrgSessionRevoked: readBoolean(value, 'previousOrgSessionRevoked', path),
	}
}

function parseSessionResponse(value: unknown, path: string): SessionResponse {
	if (!isRecord(value)) throw new Error(`dashboard-account ${path} returned a malformed response`)
	const organizations = parseOrganizations(value.organizations ?? value.relations ?? [], path)
	const currentOrg = typeof value.currentOrg === 'string' ? value.currentOrg : undefined
	const directOrganization = value.organization ? parseOrganization(value.organization, path) : undefined
	const organization =
		directOrganization ??
		organizations.find((org) => org.publicId === currentOrg) ??
		findCurrentRelationOrganization(value.relations, currentOrg, path)

	return {
		user: parseDashboardUser(value.user, path),
		...(organization ? { organization } : {}),
		...(organizations.length > 0 ? { organizations } : {}),
	}
}

function parseDashboardUser(value: unknown, path: string): DashboardUser {
	if (!isRecord(value)) throw new Error(`dashboard-account ${path} returned a malformed response`)
	const user: DashboardUser = { publicId: readString(value, 'publicId', path) }
	if (typeof value.emailAddress === 'string') user.emailAddress = value.emailAddress
	if (typeof value.firstName === 'string') user.firstName = value.firstName
	if (typeof value.lastName === 'string') user.lastName = value.lastName
	return user
}

function parseOrganizations(value: unknown, path: string): DashboardOrganization[] {
	if (!Array.isArray(value)) throw new Error(`dashboard-account ${path} returned a malformed response`)
	return value.map((org) => parseOrganization(org, path))
}

function findCurrentRelationOrganization(
	value: unknown,
	currentOrg: string | undefined,
	path: string,
): DashboardOrganization | undefined {
	if (!currentOrg || !Array.isArray(value)) return undefined
	const relation = value.find((item) => {
		if (!isRecord(item)) return false
		return item.orgId === currentOrg || item.orgPublicId === currentOrg
	})
	return relation ? parseOrganization(relation, path) : undefined
}

function parseOrganization(value: unknown, path: string): DashboardOrganization {
	if (!isRecord(value)) throw new Error(`dashboard-account ${path} returned a malformed response`)
	const publicId =
		typeof value.publicId === 'string' && value.publicId.length > 0
			? value.publicId
			: typeof value.orgPublicId === 'string' && value.orgPublicId.length > 0
				? value.orgPublicId
				: undefined
	if (!publicId) throw new Error(`dashboard-account ${path} returned a malformed response`)

	const parsed: DashboardOrganization = { publicId }
	const name = readOptionalString(value, 'name') ?? readOptionalString(value, 'orgName')
	const region = readOptionalString(value, 'region') ?? readOptionalString(value, 'orgRegion')
	const role = readOptionalString(value, 'role')
	if (name) parsed.name = name
	if (region) parsed.region = region
	if (role) parsed.role = role
	return parsed
}

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(record: JsonRecord, field: string, path: string): string {
	const value = record[field]
	if (typeof value === 'string' && value.length > 0) return value
	throw new Error(`dashboard-account ${path} returned a malformed response`)
}

function readOptionalString(record: JsonRecord, field: string): string | undefined {
	const value = record[field]
	return typeof value === 'string' && value.length > 0 ? value : undefined
}

function readBoolean(record: JsonRecord, field: string, path: string): boolean {
	const value = record[field]
	if (typeof value === 'boolean') return value
	throw new Error(`dashboard-account ${path} returned a malformed response`)
}

function readPositiveNumber(record: JsonRecord, field: string, path: string): number {
	const value = record[field]
	if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
	throw new Error(`dashboard-account ${path} returned a malformed response`)
}

function readOptionalPositiveNumber(record: JsonRecord, field: string, path: string): number | undefined {
	if (!(field in record)) return undefined
	return readPositiveNumber(record, field, path)
}

function readUrl(record: JsonRecord, field: string, path: string): string {
	const value = readString(record, field, path)
	if (isHttpUrl(value)) return value
	throw new Error(`dashboard-account ${path} returned a malformed response`)
}

function readOptionalUrl(record: JsonRecord, field: string, path: string): string | undefined {
	if (!(field in record)) return undefined
	const value = record[field]
	if (typeof value !== 'string') throw new Error(`dashboard-account ${path} returned a malformed response`)
	if (value.length === 0) return undefined
	if (isHttpUrl(value)) return value
	throw new Error(`dashboard-account ${path} returned a malformed response`)
}

function isHttpUrl(value: string): boolean {
	try {
		const url = new URL(value)
		return url.protocol === 'https:' || url.protocol === 'http:'
	} catch {
		return false
	}
}

async function fetchWithTimeout(
	fetchImpl: typeof fetch,
	input: string,
	init: RequestInit,
	label: string,
): Promise<Response> {
	const controller = new AbortController()
	const timeout = setTimeout(() => controller.abort(), DEFAULT_HTTP_TIMEOUT_MS)
	try {
		return await fetchImpl(input, { ...init, signal: controller.signal })
	} catch (err) {
		if (err instanceof Error && err.name === 'AbortError') {
			throw new Error(`${label} timed out after ${DEFAULT_HTTP_TIMEOUT_MS / 1000}s`)
		}
		throw err
	} finally {
		clearTimeout(timeout)
	}
}
