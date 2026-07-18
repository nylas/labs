/**
 * Edge-safe typed client for the Nylas v3 API (api.{us,eu}.nylas.com).
 *
 * Uses only fetch/WebCrypto globals — runs in Node >= 20, Cloudflare Workers,
 * and browsers. Covers what OwnMail needs:
 * - provisioning: connectors, agent-account grants (provider "nylas"),
 *   application redirect URIs
 * - mailbox data: messages, threads, folders, drafts, send, attachments
 * - calendar data: calendars, events, RSVP
 * - hosted auth: authorize URL builder + code/token exchange (PKCE)
 */

import { userAgentHeader } from './http.js'

export const V3_URLS = {
	us: 'https://api.us.nylas.com',
	eu: 'https://api.eu.nylas.com',
} as const
const DEFAULT_HTTP_TIMEOUT_MS = 30_000

export type V3Region = keyof typeof V3_URLS

/** JSON-serializable value — keeps API payload types transport-safe. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json | undefined }

// ---- Resource types ----------------------------------------------------------

export type Grant = {
	id: string
	provider: string
	email?: string
	name?: string
	grant_status?: string
	created_at?: number
	settings?: GrantSettings
}

export type GrantSettings = {
	has_app_password?: boolean
	app_password?: string
	[key: string]: Json | undefined
}

export type Connector = {
	provider: string
	settings?: { [key: string]: Json | undefined }
	scope?: string[]
}

export type RedirectUri = {
	id?: string
	url: string
	platform?: string
	settings?: { [key: string]: Json | undefined }
}

export type EmailParticipant = { email: string; name?: string }

export type MessageAttachment = {
	id: string
	filename?: string
	content_type?: string
	size?: number
	is_inline?: boolean
	content_id?: string
}

export type Message = {
	id: string
	grant_id: string
	thread_id?: string
	subject?: string
	snippet?: string
	body?: string
	from?: EmailParticipant[]
	to?: EmailParticipant[]
	cc?: EmailParticipant[]
	bcc?: EmailParticipant[]
	reply_to?: EmailParticipant[]
	date?: number
	unread?: boolean
	starred?: boolean
	folders?: string[]
	attachments?: MessageAttachment[]
}

export type Thread = {
	id: string
	grant_id: string
	subject?: string
	snippet?: string
	participants?: EmailParticipant[]
	message_ids?: string[]
	latest_draft_or_message?: Message
	earliest_message_date?: number
	latest_message_received_date?: number
	latest_message_sent_date?: number
	has_attachments?: boolean
	unread?: boolean
	starred?: boolean
	folders?: string[]
}

export type Folder = {
	id: string
	grant_id?: string
	name: string
	parent_id?: string
	system_folder?: boolean
	attributes?: string[]
	total_count?: number
	unread_count?: number
}

export type Draft = Message & { reply_to_message_id?: string }

export type SendMessageRequest = {
	to: EmailParticipant[]
	cc?: EmailParticipant[]
	bcc?: EmailParticipant[]
	reply_to?: EmailParticipant[]
	subject?: string
	body?: string
	reply_to_message_id?: string
	tracking_options?: { [key: string]: Json | undefined }
	attachments?: {
		filename: string
		content_type: string
		content: string
		is_inline?: boolean
		content_id?: string
	}[]
}

export type Calendar = {
	id: string
	grant_id?: string
	name: string
	timezone?: string
	is_primary?: boolean
	read_only?: boolean
	hex_color?: string
}

export type Contact = {
	id: string
	grant_id?: string
	given_name?: string
	surname?: string
	company_name?: string
	job_title?: string
	emails?: { email: string; type?: string }[]
	phone_numbers?: { number: string; type?: string }[]
	notes?: string
	picture_url?: string
}

export type EventParticipant = {
	email: string
	name?: string
	status?: 'yes' | 'no' | 'maybe' | 'noreply'
}

export type EventWhen =
	| {
			object?: 'timespan'
			start_time: number
			end_time: number
			start_timezone?: string
			end_timezone?: string
	  }
	| { object?: 'time'; time: number; timezone?: string }
	| { object?: 'date'; date: string }
	| { object?: 'datespan'; start_date: string; end_date: string }

export type Event = {
	id: string
	grant_id?: string
	calendar_id: string
	title?: string
	description?: string
	location?: string
	when: EventWhen
	participants?: EventParticipant[]
	organizer?: { email: string; name?: string }
	status?: string
	busy?: boolean
	read_only?: boolean
	conferencing?: { [key: string]: Json | undefined }
	recurrence?: string[]
}

export type Webhook = {
	id: string
	trigger_types: string[]
	callback_url?: string
	webhook_url?: string
	status?: string
	/** Returned once on create — used to verify X-Nylas-Signature. */
	webhook_secret?: string
}

export type ListResponse<T> = { request_id: string; data: T[]; next_cursor?: string }
export type ItemResponse<T> = { request_id: string; data: T }

export type ListQuery = {
	limit?: number
	page_token?: string
	[key: string]: string | number | boolean | undefined
}

export class NylasApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly requestId?: string,
		readonly type?: string,
		readonly body?: unknown,
	) {
		super(message)
		this.name = 'NylasApiError'
	}
}

// ---- Hosted auth helpers (used by the deployed app) ---------------------------

export function buildAuthorizeUrl(input: {
	region: V3Region
	baseUrl?: string
	clientId: string
	redirectUri: string
	provider?: string
	state?: string
	loginHint?: string
	codeChallenge?: string
	accessType?: 'online' | 'offline'
}): string {
	if (!input.clientId.trim()) {
		throw new Error('clientId is required to build a Nylas Hosted Auth URL.')
	}
	const url = new URL(`${resolveV3BaseUrl(input.region, input.baseUrl)}/v3/connect/auth`)
	url.searchParams.set('client_id', input.clientId)
	url.searchParams.set('redirect_uri', input.redirectUri)
	url.searchParams.set('response_type', 'code')
	if (input.provider) url.searchParams.set('provider', input.provider)
	if (input.state) url.searchParams.set('state', input.state)
	if (input.loginHint) url.searchParams.set('login_hint', input.loginHint)
	if (input.accessType) url.searchParams.set('access_type', input.accessType)
	if (input.codeChallenge) {
		url.searchParams.set('code_challenge', input.codeChallenge)
		url.searchParams.set('code_challenge_method', 'S256')
	}
	return url.toString()
}

export type TokenResponse = {
	access_token?: string
	refresh_token?: string
	grant_id: string
	email?: string
	expires_in?: number
	id_token?: string
	provider?: string
	token_type?: string
	scope?: string
}

export async function exchangeCodeForToken(
	input: {
		region: V3Region
		baseUrl?: string
		clientId: string
		redirectUri: string
		code: string
		clientSecret: string
		codeVerifier?: string
		userAgent?: string
	},
	fetchImpl: typeof fetch = fetch,
): Promise<TokenResponse> {
	if (!input.clientId.trim()) {
		throw new Error('clientId is required to exchange a Nylas Hosted Auth code.')
	}
	if (!input.clientSecret.trim()) {
		throw new Error('clientSecret is required to exchange a Nylas Hosted Auth code.')
	}
	const body: Record<string, string> = {
		client_id: input.clientId.trim(),
		client_secret: input.clientSecret.trim(),
		redirect_uri: input.redirectUri,
		code: input.code,
		grant_type: 'authorization_code',
	}
	if (input.codeVerifier) body.code_verifier = input.codeVerifier

	const tokenUrl = `${resolveV3BaseUrl(input.region, input.baseUrl)}/v3/connect/token`
	const res = await fetchWithTimeout(
		fetchImpl,
		tokenUrl,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json', ...userAgentHeader(input.userAgent) },
			body: JSON.stringify(body),
		},
		'token exchange',
	)
	const parsed = (await res.json()) as TokenResponse & { error?: string; error_description?: string }
	if (!res.ok) {
		throw new NylasApiError(
			parsed.error_description ?? parsed.error ?? `token exchange failed with ${res.status}`,
			res.status,
			undefined,
			parsed.error,
			parsed,
		)
	}
	return parsed
}

/** PKCE pair: verifier to keep server-side, S256 challenge for the authorize URL. */
export async function generatePkcePair(): Promise<{ verifier: string; challenge: string }> {
	const random = crypto.getRandomValues(new Uint8Array(32))
	const verifier = base64url(random)
	return { verifier, challenge: await nylasPkceS256Challenge(verifier) }
}

/**
 * Nylas Hosted Auth encodes the lowercase SHA-256 hex text before Base64URL
 * encoding it. This intentionally differs from RFC 7636's raw-digest form;
 * keep it aligned with Nylas's documented PKCE challenge example.
 */
export async function nylasPkceS256Challenge(verifier: string): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
	let hex = ''
	for (const byte of digest) hex += byte.toString(16).padStart(2, '0')
	return base64url(new TextEncoder().encode(hex))
}

function base64url(data: ArrayBuffer | Uint8Array): string {
	const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
	let bin = ''
	for (const b of bytes) bin += String.fromCharCode(b)
	return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

// ---- API-key client ------------------------------------------------------------

export class NylasV3Client {
	private readonly baseUrl: string
	private readonly attributionHeaders: Record<string, string>

	constructor(
		private readonly apiKey: string,
		region: V3Region = 'us',
		private readonly fetchImpl: typeof fetch = fetch,
		baseUrl?: string,
		userAgent?: string,
	) {
		this.baseUrl = resolveV3BaseUrl(region, baseUrl)
		this.attributionHeaders = userAgentHeader(userAgent)
	}

	// -- Provisioning ---------------------------------------------------------

	/** Creates an Agent Account mailbox grant (provider "nylas"). */
	async createAgentAccount(input: {
		email: string
		appPassword?: string
		name?: string
		workspaceId?: string
	}): Promise<Grant> {
		const body: Record<string, unknown> = {
			provider: 'nylas',
			settings: {
				email: input.email,
				...(input.appPassword ? { app_password: input.appPassword } : {}),
			},
		}
		if (input.name) body.name = input.name
		if (input.workspaceId) body.workspace_id = input.workspaceId
		const res = await this.request<ItemResponse<Grant>>('POST', '/v3/connect/custom', body)
		return res.data
	}

	async listGrants(query?: ListQuery): Promise<ListResponse<Grant>> {
		return this.request('GET', `/v3/grants${toQuery(query)}`)
	}

	async getGrant(grantId: string): Promise<ItemResponse<Grant>> {
		return this.request('GET', `/v3/grants/${encodeURIComponent(grantId)}`)
	}

	async updateGrant(
		grantId: string,
		input: { name?: string; settings?: { [key: string]: Json | undefined }; workspaceId?: string },
	): Promise<ItemResponse<Grant>> {
		const body: Record<string, unknown> = {}
		if (input.name !== undefined) body.name = input.name
		if (input.settings) body.settings = input.settings
		if (input.workspaceId) body.workspace_id = input.workspaceId
		return this.request('PATCH', `/v3/grants/${encodeURIComponent(grantId)}`, body)
	}

	async deleteGrant(grantId: string): Promise<void> {
		await this.request('DELETE', `/v3/grants/${encodeURIComponent(grantId)}`)
	}

	async listConnectors(): Promise<ListResponse<Connector>> {
		return this.request('GET', '/v3/connectors')
	}

	async createConnector(input: {
		provider: string
		settings?: { [key: string]: Json | undefined }
	}): Promise<ItemResponse<Connector>> {
		return this.request('POST', '/v3/connectors', input)
	}

	/** Ensures a connector for `provider` exists on the application (idempotent). */
	async ensureConnector(provider: string): Promise<Connector> {
		const existing = await this.listConnectors()
		const found = listData(existing).find((c) => c.provider === provider)
		if (found) return found
		try {
			const created = await this.createConnector({ provider })
			return created.data
		} catch (err) {
			// Lost a create race — "already exists" means someone ensured it for us.
			if (err instanceof NylasApiError && /already exists/i.test(err.message)) {
				const retry = await this.listConnectors()
				const winner = listData(retry).find((c) => c.provider === provider)
				if (winner) return winner
			}
			throw err
		}
	}

	// Webhooks
	async listWebhooks(): Promise<ListResponse<Webhook>> {
		return this.request('GET', '/v3/webhooks')
	}

	async createWebhook(input: {
		trigger_types: string[]
		webhook_url: string
		description?: string
	}): Promise<ItemResponse<Webhook>> {
		return this.request('POST', '/v3/webhooks', input)
	}

	async rotateWebhookSecret(webhookId: string): Promise<ItemResponse<Webhook>> {
		return this.request('POST', `/v3/webhooks/rotate-secret/${encodeURIComponent(webhookId)}`)
	}

	/** Creates the webhook if no active one exists for this URL; returns it either way. */
	async ensureWebhook(callbackUrl: string, triggerTypes: string[]): Promise<Webhook> {
		const existing = await this.listWebhooks()
		const found = listData(existing).find((w) => webhookUrl(w) === callbackUrl && w.status !== 'failed')
		if (found) return found
		const created = await this.createWebhook({
			trigger_types: triggerTypes,
			webhook_url: callbackUrl,
			description: 'ownmail realtime',
		})
		return created.data
	}

	async listRedirectUris(): Promise<ListResponse<RedirectUri>> {
		return this.request('GET', '/v3/applications/redirect-uris')
	}

	async createRedirectUri(input: { url: string; platform?: string }): Promise<ItemResponse<RedirectUri>> {
		return this.request('POST', '/v3/applications/redirect-uris', {
			url: input.url,
			platform: input.platform ?? 'web',
		})
	}

	/** Registers each URL if not already present (idempotent). */
	async ensureRedirectUris(urls: string[]): Promise<void> {
		const existing = await this.listRedirectUris()
		const have = new Set(listData(existing).map((r) => r.url))
		for (const url of urls) {
			if (!have.has(url)) await this.createRedirectUri({ url })
		}
	}

	// -- Grant-scoped mailbox data ---------------------------------------------

	forGrant(grantId: string): GrantScopedClient {
		return new GrantScopedClient(this, grantId)
	}

	async request<T>(method: string, path: string, body?: unknown): Promise<T> {
		const res = await fetchWithTimeout(
			this.fetchImpl,
			`${this.baseUrl}${path}`,
			{
				method,
				headers: {
					Authorization: `Bearer ${this.apiKey}`,
					Accept: 'application/json',
					...this.attributionHeaders,
					...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
				},
				body: body === undefined ? null : JSON.stringify(body),
			},
			`Nylas API ${method} ${path}`,
		)
		const text = await res.text()
		let parsed: unknown = null
		try {
			parsed = text ? JSON.parse(text) : null
		} catch {
			parsed = text
		}
		if (!res.ok) {
			const errBody = parsed as {
				request_id?: string
				error?: { type?: string; message?: string }
			} | null
			throw new NylasApiError(
				errBody?.error?.message ?? `Nylas API ${method} ${path} failed with ${res.status}`,
				res.status,
				errBody?.request_id,
				errBody?.error?.type,
				parsed,
			)
		}
		return sanitizeListResponse(parsed) as T
	}

	async rawRequest(method: string, path: string, body?: unknown): Promise<Response> {
		const res = await fetchWithTimeout(
			this.fetchImpl,
			`${this.baseUrl}${path}`,
			{
				method,
				headers: {
					Authorization: `Bearer ${this.apiKey}`,
					...this.attributionHeaders,
					...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
				},
				body: body === undefined ? null : JSON.stringify(body),
			},
			`Nylas API ${method} ${path}`,
		)
		if (!res.ok) {
			let parsed: unknown = null
			try {
				parsed = await res.clone().json()
			} catch {
				parsed = await res.text().catch(() => null)
			}
			const errBody = parsed as {
				request_id?: string
				error?: { type?: string; message?: string }
			} | null
			throw new NylasApiError(
				errBody?.error?.message ?? `Nylas API ${method} ${path} failed with ${res.status}`,
				res.status,
				errBody?.request_id,
				errBody?.error?.type,
				parsed,
			)
		}
		return res
	}
}

function listData<T>(response: { data?: T[] | null }): T[] {
	return Array.isArray(response.data) ? response.data : []
}

/**
 * List entries are external JSON. Keep only object records so one null or scalar
 * item cannot cause a consumer to dereference a property during list rendering.
 */
function sanitizeListResponse(value: unknown): unknown {
	if (!isRecord(value) || !Array.isArray(value.data)) return value
	return { ...value, data: value.data.filter(isRecord) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function webhookUrl(webhook: Webhook): string | undefined {
	return webhook.webhook_url ?? webhook.callback_url
}

function toQuery(query?: ListQuery): string {
	if (!query) return ''
	const params = new URLSearchParams()
	for (const [key, value] of Object.entries(query)) {
		if (value !== undefined) params.set(key, String(value))
	}
	return params.size ? `?${params}` : ''
}

export function resolveV3BaseUrl(region: V3Region, baseUrl?: string): string {
	let resolved = baseUrl?.trim() || V3_URLS[region]
	while (resolved.endsWith('/')) resolved = resolved.slice(0, -1)
	return resolved
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

export class GrantScopedClient {
	constructor(
		private readonly client: NylasV3Client,
		private readonly grantId: string,
	) {}

	private path(suffix: string): string {
		return `/v3/grants/${encodeURIComponent(this.grantId)}${suffix}`
	}

	// Messages / threads / folders
	listMessages(query?: ListQuery): Promise<ListResponse<Message>> {
		return this.client.request('GET', this.path(`/messages${toQuery(query)}`))
	}
	getMessage(messageId: string): Promise<ItemResponse<Message>> {
		return this.client.request('GET', this.path(`/messages/${encodeURIComponent(messageId)}`))
	}
	updateMessage(
		messageId: string,
		body: { unread?: boolean; starred?: boolean; folders?: string[] },
	): Promise<ItemResponse<Message>> {
		return this.client.request('PUT', this.path(`/messages/${encodeURIComponent(messageId)}`), body)
	}
	deleteMessage(messageId: string): Promise<void> {
		return this.client.request('DELETE', this.path(`/messages/${encodeURIComponent(messageId)}`))
	}
	send(body: SendMessageRequest): Promise<ItemResponse<Message>> {
		return this.client.request('POST', this.path('/messages/send'), body)
	}

	listThreads(query?: ListQuery): Promise<ListResponse<Thread>> {
		return this.client.request('GET', this.path(`/threads${toQuery(query)}`))
	}
	getThread(threadId: string): Promise<ItemResponse<Thread>> {
		return this.client.request('GET', this.path(`/threads/${encodeURIComponent(threadId)}`))
	}
	updateThread(
		threadId: string,
		body: { unread?: boolean; starred?: boolean; folders?: string[] },
	): Promise<ItemResponse<Thread>> {
		return this.client.request('PUT', this.path(`/threads/${encodeURIComponent(threadId)}`), body)
	}

	listFolders(query?: ListQuery): Promise<ListResponse<Folder>> {
		return this.client.request('GET', this.path(`/folders${toQuery(query)}`))
	}
	createFolder(body: { name: string; parent_id?: string }): Promise<ItemResponse<Folder>> {
		return this.client.request('POST', this.path('/folders'), body)
	}

	// Drafts
	listDrafts(query?: ListQuery): Promise<ListResponse<Draft>> {
		return this.client.request('GET', this.path(`/drafts${toQuery(query)}`))
	}
	getDraft(draftId: string): Promise<ItemResponse<Draft>> {
		return this.client.request('GET', this.path(`/drafts/${encodeURIComponent(draftId)}`))
	}
	createDraft(body: SendMessageRequest): Promise<ItemResponse<Draft>> {
		return this.client.request('POST', this.path('/drafts'), body)
	}
	updateDraft(draftId: string, body: SendMessageRequest): Promise<ItemResponse<Draft>> {
		return this.client.request('PUT', this.path(`/drafts/${encodeURIComponent(draftId)}`), body)
	}
	deleteDraft(draftId: string): Promise<void> {
		return this.client.request('DELETE', this.path(`/drafts/${encodeURIComponent(draftId)}`))
	}
	sendDraft(draftId: string): Promise<ItemResponse<Message>> {
		return this.client.request('POST', this.path(`/drafts/${encodeURIComponent(draftId)}`))
	}

	// Attachments
	attachmentDownloadUrl(attachmentId: string, messageId: string): string {
		return this.path(
			`/attachments/${encodeURIComponent(attachmentId)}/download?message_id=${encodeURIComponent(messageId)}`,
		)
	}
	downloadAttachment(attachmentId: string, messageId: string): Promise<Response> {
		return this.client.rawRequest('GET', this.attachmentDownloadUrl(attachmentId, messageId))
	}

	// Calendars / events
	// Contacts
	listContacts(query?: ListQuery): Promise<ListResponse<Contact>> {
		return this.client.request('GET', this.path(`/contacts${toQuery(query)}`))
	}
	getContact(contactId: string): Promise<ItemResponse<Contact>> {
		return this.client.request('GET', this.path(`/contacts/${encodeURIComponent(contactId)}`))
	}
	createContact(body: Partial<Contact>): Promise<ItemResponse<Contact>> {
		return this.client.request('POST', this.path('/contacts'), body)
	}
	updateContact(contactId: string, body: Partial<Contact>): Promise<ItemResponse<Contact>> {
		return this.client.request('PUT', this.path(`/contacts/${encodeURIComponent(contactId)}`), body)
	}
	deleteContact(contactId: string): Promise<void> {
		return this.client.request('DELETE', this.path(`/contacts/${encodeURIComponent(contactId)}`))
	}

	listCalendars(query?: ListQuery): Promise<ListResponse<Calendar>> {
		return this.client.request('GET', this.path(`/calendars${toQuery(query)}`))
	}
	listEvents(query: ListQuery & { calendar_id: string }): Promise<ListResponse<Event>> {
		return this.client.request('GET', this.path(`/events${toQuery(query)}`))
	}
	getEvent(eventId: string, calendarId: string): Promise<ItemResponse<Event>> {
		return this.client.request(
			'GET',
			this.path(`/events/${encodeURIComponent(eventId)}?calendar_id=${encodeURIComponent(calendarId)}`),
		)
	}
	createEvent(body: Partial<Event>, calendarId: string): Promise<ItemResponse<Event>> {
		return this.client.request(
			'POST',
			this.path(`/events?calendar_id=${encodeURIComponent(calendarId)}`),
			body,
		)
	}
	updateEvent(eventId: string, body: Partial<Event>, calendarId: string): Promise<ItemResponse<Event>> {
		return this.client.request(
			'PUT',
			this.path(`/events/${encodeURIComponent(eventId)}?calendar_id=${encodeURIComponent(calendarId)}`),
			body,
		)
	}
	deleteEvent(eventId: string, calendarId: string): Promise<void> {
		return this.client.request(
			'DELETE',
			this.path(`/events/${encodeURIComponent(eventId)}?calendar_id=${encodeURIComponent(calendarId)}`),
		)
	}
	sendRsvp(
		eventId: string,
		calendarId: string,
		status: 'yes' | 'no' | 'maybe',
	): Promise<ItemResponse<unknown>> {
		return this.client.request(
			'POST',
			this.path(
				`/events/${encodeURIComponent(eventId)}/send-rsvp?calendar_id=${encodeURIComponent(calendarId)}`,
			),
			{ status },
		)
	}
}
