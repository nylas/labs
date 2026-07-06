/**
 * Client for the Nylas dashboard-api-gateway GraphQL API.
 *
 * Scope: applications, API keys, and (agent-account) grants only. Org-level
 * surfaces such as inbox domains live on dashboard-account — see dashboard.ts.
 *
 * Operations and shapes mirror the official Go CLI
 * (cli/internal/adapters/dashboard/gateway_client.go).
 */

import type { DashboardTokens } from './dashboard.js'
import type { DpopKey } from './dpop.js'

export const GATEWAY_URLS = {
	us: 'https://dashboard-api-gateway.us.nylas.com/graphql',
	eu: 'https://dashboard-api-gateway.eu.nylas.com/graphql',
} as const

export type Region = keyof typeof GATEWAY_URLS

export type GatewayApplication = {
	applicationId: string
	organizationId: string
	region: string
	environment?: string
	branding?: { name?: string; description?: string }
}

export type GatewayCreatedApplication = GatewayApplication & { clientSecret: string }

export type GatewayApiKey = {
	id: string
	name: string
	status: string
	permissions?: string[]
	expiresAt?: number
	createdAt?: number
}

export type GatewayCreatedApiKey = GatewayApiKey & { apiKey: string }

export class GatewayError extends Error {
	constructor(
		message: string,
		readonly errors: { message?: string }[] = [],
	) {
		super(message)
		this.name = 'GatewayError'
	}
}

export class GatewayClient {
	constructor(
		private readonly dpop: DpopKey,
		private readonly urls: Record<Region, string> = GATEWAY_URLS,
		private readonly fetchImpl: typeof fetch = fetch,
	) {}

	async listApplications(tokens: DashboardTokens, region: Region, orgPublicId: string) {
		const data = await this.query<{
			applications: { applications: GatewayApplication[] | null } | null
		}>(tokens, region, {
			operationName: 'V3_GetApplications',
			query: `query V3_GetApplications($filter: ApplicationFilter!) {
				applications(filter: $filter) {
					applications { applicationId organizationId region environment branding { name description } }
				}
			}`,
			variables: { filter: { orgPublicId } },
		})
		return data.applications?.applications ?? []
	}

	async createApplication(
		tokens: DashboardTokens,
		region: Region,
		orgPublicId: string,
		options: {
			region: Region
			environment?: string
			branding?: { name?: string; description?: string }
		},
	): Promise<GatewayCreatedApplication> {
		const data = await this.query<{ createApplication: GatewayCreatedApplication }>(tokens, region, {
			operationName: 'V3_CreateApplication',
			query: `mutation V3_CreateApplication($orgPublicId: String!, $options: ApplicationOptions!) {
				createApplication(orgPublicId: $orgPublicId, options: $options) {
					applicationId clientSecret organizationId region environment branding { name }
				}
			}`,
			variables: { orgPublicId, options },
		})
		return data.createApplication
	}

	async listApiKeys(tokens: DashboardTokens, region: Region, appId: string): Promise<GatewayApiKey[]> {
		const data = await this.query<{ apiKeys: GatewayApiKey[] | null }>(tokens, region, {
			operationName: 'V3_ApiKeys',
			query: `query V3_ApiKeys($appId: String!) {
				apiKeys(appId: $appId) { id name status permissions expiresAt createdAt }
			}`,
			variables: { appId },
		})
		return data.apiKeys ?? []
	}

	async createApiKey(
		tokens: DashboardTokens,
		region: Region,
		appId: string,
		options?: { name?: string; expiresIn?: number },
	): Promise<GatewayCreatedApiKey> {
		const data = await this.query<{ createApiKey: GatewayCreatedApiKey }>(tokens, region, {
			operationName: 'V3_CreateApiKey',
			query: `mutation V3_CreateApiKey($appId: String!, $options: ApiKeyOptions) {
				createApiKey(appId: $appId, options: $options) {
					id name apiKey status permissions expiresAt createdAt
				}
			}`,
			variables: { appId, options: options ?? {} },
		})
		return data.createApiKey
	}

	async revokeApiKey(
		tokens: DashboardTokens,
		region: Region,
		appId: string,
		apiKeyId: string,
	): Promise<void> {
		await this.query<{ revokeApiKey: { id: string } | null }>(tokens, region, {
			operationName: 'V3_RevokeApiKey',
			query: `mutation V3_RevokeApiKey($appId: String!, $apiKeyId: String!) {
				revokeApiKey(appId: $appId, apiKeyId: $apiKeyId) { id }
			}`,
			variables: { appId, apiKeyId },
		})
	}

	private async query<T>(
		tokens: DashboardTokens,
		region: Region,
		body: { operationName: string; query: string; variables: Record<string, unknown> },
	): Promise<T> {
		const url = this.urls[region]
		const res = await this.fetchImpl(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${tokens.userToken}`,
				...(tokens.orgToken ? { 'X-Nylas-Org': tokens.orgToken } : {}),
				DPoP: await this.dpop.proof('POST', url, tokens.userToken),
			},
			body: JSON.stringify(body),
		})
		if (!res.ok) {
			throw new GatewayError(`gateway ${body.operationName} failed with ${res.status}`)
		}
		const result = (await res.json()) as { data?: T; errors?: { message?: string }[] }
		if (result.errors?.length) {
			throw new GatewayError(
				`gateway ${body.operationName} errors: ${result.errors.map((e) => e.message).join('; ')}`,
				result.errors,
			)
		}
		if (!result.data) {
			throw new GatewayError(`gateway ${body.operationName} returned no data`)
		}
		return result.data
	}
}
